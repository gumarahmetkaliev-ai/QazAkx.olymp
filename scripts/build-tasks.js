#!/usr/bin/env node
/**
 * Разбирает PDF заданий + PDF решений в JSON с задачами, пунктами, баллами и эталоном жюри.
 * Именно эти JSON включают поля ответа и ИИ-проверку на сайте.
 *
 *   npm run build-tasks                     – все комплекты, у которых PDF уже скачаны
 *   npm run build-tasks -- --stage=oblast   – только областные
 *   npm run build-tasks -- --ai             – если парсер не справился, структурировать через OmniRoute / OpenRouter
 *   npm run build-tasks -- --force          – пересобрать уже готовые
 *   npm run build-tasks -- --set=<setId>    – только указанные комплекты (через запятую)
 *   npm run build-tasks -- --ai --concurrency=3  – параллельные запросы к ИИ
 *
 * Текст из PDF берётся через `pdftotext -layout` (poppler, лучше всего) или pdf-parse.
 * Сканы без текста распознаются через tesseract (нужны языки rus, kaz, eng), кеш — .cache/ocr.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parseOlympiad, qualityReport } = require("../lib/task-parser");
const { parseTestSet, testToTasks } = require("../lib/test-parser");
const { parseNumbered } = require("../lib/numbered-parser");
const { linearize } = require("../lib/columns");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const CATALOG_PATH = path.join(ROOT, "data", "catalog", `${(process.argv.find((a) => a.startsWith("--subject=")) || "--subject=chemistry").split("=")[1]}.json`);
const TASKS_DIR = path.join(ROOT, "data", "tasks");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Сканы без текстового слоя распознаём через tesseract (rus+kaz+eng), результат кешируем в .cache/ocr
const OCR_DIR = path.join(ROOT, ".cache", "ocr");
let hasTesseract = null;
function ocrPdf(file) {
  if (hasTesseract === null) {
    try {
      execFileSync("tesseract", ["--version"], { stdio: "ignore" });
      hasTesseract = true;
    } catch {
      hasTesseract = false;
    }
  }
  if (!hasTesseract) return "";
  const cacheFile = path.join(OCR_DIR, path.relative(PUBLIC_DIR, file).replace(/[\\/]/g, "__") + ".txt");
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, "utf8");
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "ocr-"));
  try {
    execFileSync("pdftoppm", ["-r", "300", "-gray", "-png", file, path.join(tmp, "p")], { stdio: "ignore" });
    const langs = /kaz|qaz/i.test(file) ? "kaz+rus+eng" : "rus+eng";
    const pages = fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
    const text = pages
      .map((pg) => execFileSync("tesseract", [path.join(tmp, pg), "-", "-l", langs, "--psm", "6", "-c", "preserve_interword_spaces=1"], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString("utf8"))
      .join("\f");
    fs.mkdirSync(OCR_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, text);
    console.log(`  OCR: ${path.relative(PUBLIC_DIR, file)} (${pages.length} стр.)`);
    return text;
  } catch (err) {
    console.warn(`  ⚠ OCR ${file}: ${err.message}`);
    return "";
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

let hasPdftotext = null;
async function pdfText(file) {
  const text = await pdfTextLayer(file);
  // скан = почти нет текста на страницу (короткий ключ ответов «1 D 2 C …» сканом не считаем)
  let pages = 1;
  try {
    pages = Number((execFileSync("pdfinfo", [file]).toString().match(/Pages:\s+(\d+)/) || [])[1]) || 1;
  } catch {}
  if (text.replace(/\s/g, "").length >= Math.min(300, 40 * pages)) return text;
  const ocr = ocrPdf(file);
  return ocr.replace(/\s/g, "").length > text.replace(/\s/g, "").length ? ocr : text;
}

async function pdfTextLayer(file) {
  if (hasPdftotext === null) {
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
      hasPdftotext = true;
    } catch {
      hasPdftotext = false;
      console.log("ℹ pdftotext не найден — использую pdf-parse (для лучшего качества установите poppler).");
    }
  }
  if (hasPdftotext) {
    return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  }
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text || "";
}

const AI_SCHEMA_HINT = `{
  "tasks": [
    {
      "number": 1,
      "title": "Название задачи",
      "weight": 10,
      "total": 20,
      "statement": "полное условие задачи",
      "parts": [
        { "id": "1.1", "points": 8, "pointsEstimated": false, "question": "что требуется в пункте", "reference": "эталонное решение жюри для пункта + критерии баллов дословно из решений" }
      ]
    }
  ]
}`;

async function structureWithAI(tasksText, solText) {
  // OmniRoute (OpenAI-совместимый) или OpenRouter
  const omniKey = process.env.OMNIROUTE_API_KEY;
  const omniEndpoint = (process.env.OMNIROUTE_ENDPOINT || "").trim().replace(/\/+$/, "");
  const useOmni = Boolean(omniKey && omniEndpoint);
  const key = useOmni ? omniKey : process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OMNIROUTE_API_KEY/OMNIROUTE_ENDPOINT или OPENROUTER_API_KEY");
  const model = useOmni
    ? process.env.OMNIROUTE_PARSE_MODEL || process.env.OMNIROUTE_MODEL || "auto"
    : process.env.OPENROUTER_PARSE_MODEL || process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  let url = "https://openrouter.ai/api/v1/chat/completions";
  if (useOmni) {
    url = omniEndpoint;
    if (!/\/chat\/completions$/i.test(url)) url += /\/v1$/i.test(url) ? "/chat/completions" : "/v1/chat/completions";
  }
  const prompt = `Ниже текст PDF с заданиями олимпиады по химии и текст PDF с официальными решениями жюри.
Разбей комплект на задачи и пункты. Для каждого пункта укажи баллы (из таблиц баллов / решений), формулировку вопроса и эталонное решение с критериями оценивания (максимально близко к тексту решений).
Если в задаче нет явных пунктов — сделай один пункт "N.1" с полными баллами за задачу.
Баллы бери только из официальной разбалловки (таблицы, «Система оценивания», пометки «(N баллов)» в решениях). Если официальных баллов за пункт нет — оцени их пропорционально сложности и поставь "pointsEstimated": true. Ничего не выдумывай в эталоне: только текст официального решения.
Ответь ТОЛЬКО JSON по схеме:
${AI_SCHEMA_HINT}

=== ЗАДАНИЯ ===
${tasksText.slice(0, 60000)}

=== РЕШЕНИЯ ===
${solText.slice(0, 90000)}`;

  // Квоты/«cooldown» у провайдеров OmniRoute: ждём и повторяем до 4 раз
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestStructure(url, key, model, prompt);
    } catch (err) {
      const retriable = /quota|cooldown|cooling|rate.?limit|429|timed? ?out|tunnel|502|503|530/i.test(err.message);
      if (!retriable || attempt >= 4) throw err;
      console.warn(`  … ${err.message.slice(0, 120)} — повтор через ${attempt * 90} с`);
      await new Promise((r) => setTimeout(r, attempt * 90000));
    }
  }
}

async function requestStructure(url, key, model, prompt) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "QazAkx.olymp" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 32000,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(300000),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`HTTP ${res.status}: ответ не JSON (${raw.slice(0, 80).replace(/\s+/g, " ")})`);
  }
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const text = data.choices?.[0]?.message?.content || "";
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return { tasks: json.tasks || [], model };
}

function isGood(q) {
  return (
    q.tasks > 0 &&
    q.withPoints === q.parts &&
    q.withReference >= Math.ceil(q.parts * 0.6) &&
    (q.estimatedPoints || 0) <= Math.floor(q.parts * 0.25)
  );
}

const SUBJECT = args.subject || "chemistry";
const NEW_SUBJECT = !["chemistry", "biology"].includes(SUBJECT);

/** Оценка разбора: задачи с эталоном и правдоподобное число задач */
function score(tasks) {
  const q = qualityReport(tasks);
  if (!q.tasks) return -1;
  const blob = q.tasks === 1 && q.parts <= 1 ? 0.5 : 1;
  return (q.withReference * 2 + q.parts + q.tasks) * blob;
}

/** Физика, математика, информатика, астрономия, география */
function parseNewSubject(tasksText, solText, olymp, mat) {
  const lt = linearize(tasksText).text;
  const ls = linearize(solText).text;
  const test = parseTestSet(lt, ls) || parseTestSet(tasksText, solText);
  if (test) return { tasks: testToTasks(test, 10, null), test, generatedBy: "test-parser" };
  const opts = { grade: mat.grade ?? olymp.grade, round: mat.round, lang: mat.lang === "kz" ? "kz" : mat.lang === "en" ? "en" : "ru" };
  const numbered = parseNumbered(tasksText, solText, opts);
  if (SUBJECT === "informatics") for (const t of numbered) t.parts[0].question = "Опишите алгоритм и приложите код (на любом языке). Укажите сложность.";
  if (SUBJECT === "math" || SUBJECT === "informatics") {
    if (numbered.length) return { tasks: numbered, generatedBy: "numbered-parser" };
  }
  const variants = [
    { tasks: parseOlympiad(lt, ls), generatedBy: "parser" },
    { tasks: parseOlympiad(tasksText, solText), generatedBy: "parser" },
    { tasks: numbered, generatedBy: "numbered-parser" },
  ];
  variants.sort((a, b) => score(b.tasks) - score(a.tasks));
  return variants[0];
}

function wholeTask(tasksText, solText) {
  const clean = (t) => linearize(t).text.replace(/\f/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const ref = solText ? clean(solText).slice(0, 15000) : "";
  return {
    number: 1,
    title: "Задания тура",
    statement: clean(tasksText).slice(0, 15000),
    total: 10,
    parts: [
      {
        id: "1",
        question: "Решите задания тура. Подпишите номер задачи перед каждым решением.",
        points: 10,
        pointsEstimated: true,
        reference: ref,
      },
    ],
  };
}

async function main() {
  loadEnv();
  if (!fs.existsSync(CATALOG_PATH)) execFileSync(process.execPath, [path.join(__dirname, "build-catalog.js"), `--subject=${args.subject || "chemistry"}`], { stdio: "inherit" });
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  fs.mkdirSync(TASKS_DIR, { recursive: true });

  let built = 0;
  let skipped = 0;
  let weak = 0;
  const jobs = [];
  for (const olymp of catalog.olympiads) {
    if (args.stage && olymp.stage !== args.stage) continue;
    if (args.year && String(olymp.year) !== String(args.year)) continue;
    for (const mat of olymp.materials) {
      // химия/биология — только с официальным решением; новые предметы — и без него (ИИ оценивает по существу)
      // без официального решения ИИ оценивает по существу
      if (!(mat.kind === "tasks" || ((mat.asTasks || mat.selfSolution) && mat.setId))) continue;
      if (args.set && !String(args.set).split(",").includes(mat.setId)) continue;
      let sol = mat.solutionId ? olymp.materials.find((m) => m.id === mat.solutionId) : null;
      if (mat.selfSolution) sol = mat; // условие и решение в одном файле
      if (!sol && mat.kind === "tasks") {
        // одно общее «Решения» на оба дня (EGMO, IZhO): задачи найдутся в нём по тексту условия
        const sols = olymp.materials.filter((m) => m.kind === "sol" && (m.round == null || m.round === mat.round));
        if (sols.length === 1) sol = sols[0];
      }
      const exists = (m) => m && fs.existsSync(path.join(PUBLIC_DIR, m.localPath));
      if (!exists(mat) || (sol && !exists(sol))) continue;
      const outPath = path.join(TASKS_DIR, `${mat.setId}.json`);
      if (fs.existsSync(outPath) && !args.force) {
        // --ai без --force: перепроверить только слабые комплекты, собранные парсером
        const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
        if (!(args.ai && !isGood(prev.quality) && !String(prev.generatedBy).startsWith("ai:"))) {
          skipped++;
          continue;
        }
      }
      jobs.push({ olymp, mat, sol, outPath });
    }
  }

  async function runJob({ olymp, mat, sol, outPath }) {
    const tasksText = await pdfText(path.join(PUBLIC_DIR, mat.localPath));
    const solText = sol ? await pdfText(path.join(PUBLIC_DIR, sol.localPath)) : "";
    let tasks;
    let test = null;
    let generatedBy;
    if (NEW_SUBJECT) {
      ({ tasks, test, generatedBy } = parseNewSubject(tasksText, solText, olymp, mat));
    } else {
      // Тест с ключом (биология: «80 вопросов с одним правильным ответом») — проверяется без ИИ
      test = parseTestSet(tasksText, solText);
      tasks = test ? testToTasks(test) : parseOlympiad(tasksText, solText);
      generatedBy = test ? "test-parser" : "parser";
    }
    let q = qualityReport(tasks);
    const label = `${olymp.title} · ${mat.label}`;

    if (!test && !isGood(q) && args.ai && tasksText.replace(/\s/g, "").length > 300) {
      try {
        const t0 = Date.now();
        const ai = await structureWithAI(tasksText, solText);
        const aq = qualityReport(ai.tasks);
        // ИИ-разбор берём, если у него есть баллы у всех пунктов и эталонов не меньше, чем у парсера
        if (aq.tasks && aq.withPoints === aq.parts && aq.withReference >= Math.min(q.withReference, aq.parts * 0.6)) {
          tasks = ai.tasks;
          q = aq;
          generatedBy = `ai:${ai.model}`;
        }
        console.log(`  ИИ ${mat.setId}: ${Math.round((Date.now() - t0) / 1000)} с, ${aq.tasks} задач / ${aq.parts} пунктов${generatedBy === "parser" ? " — оставлен разбор парсера" : ""}`);
      } catch (err) {
        console.warn(`  ⚠ ИИ-разбор ${mat.setId}: ${err.message}`);
      }
    }

    if (!q.tasks && tasksText.replace(/\s/g, "").length > 80) {
      // Последний вариант: весь тур — одна задача с одним полем ответа
      tasks = [wholeTask(tasksText, solText)];
      q = qualityReport(tasks);
      generatedBy = "whole-document";
    }
    if (!q.tasks) {
      console.log(`✗ ${label}: задачи не найдены`);
      weak++;
      return;
    }
    if (!isGood(q)) weak++;

    const out = {
      setId: mat.setId,
      olympiadId: olymp.id,
      title: olymp.title,
      materialLabel: mat.label,
      lang: mat.lang,
      tasksFile: mat.localPath,
      solutionFile: sol ? sol.localPath : null,
      ...(sol ? {} : { noSolution: true }),
      generatedBy,
      ...(test ? { type: "test" } : {}),
      generatedAt: new Date().toISOString(),
      quality: q,
      tasks,
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
    built++;
    const est = q.estimatedPoints ? `, оценочные баллы у ${q.estimatedPoints}` : "";
    console.log(`${isGood(q) ? "✓" : "~"} ${label}: ${q.tasks} задач, ${q.parts} пунктов, эталон у ${q.withReference}${est}`);
  }

  const concurrency = args.ai ? Number(args.concurrency || 3) : 1;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          await runJob(job);
        } catch (err) {
          weak++;
          console.warn(`✗ ${job.mat.setId}: ${String(err.message).split("\n")[0]}`);
        }
      }
    })
  );
  console.log(`\nГотово: собрано ${built}, пропущено (уже есть) ${skipped}, требуют проверки ${weak}.`);
  if (weak && !args.ai) console.log("Подсказка: запустите с --ai, чтобы слабые комплекты структурировал ИИ (нужен ключ OmniRoute или OpenRouter).");
  execFileSync(process.execPath, [path.join(__dirname, "build-catalog.js"), `--subject=${args.subject || "chemistry"}`], { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
