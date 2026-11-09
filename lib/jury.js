/**
 * ИИ-жюри: проверяет ответы ученика по пунктам задачи строго по официальному
 * решению и схеме оценивания, возвращает баллы, комментарии и темы ошибок
 * (по темам подбираются видеоуроки из data/videos.json).
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TASKS_DIR = path.join(DATA_DIR, "tasks");

const cache = new Map();
function readJson(file) {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit.data;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  cache.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

function isValidSetId(setId) {
  return typeof setId === "string" && /^[a-z0-9-]+$/.test(setId) && setId.length < 200;
}

function loadSet(setId) {
  if (!isValidSetId(setId)) return null;
  const file = path.join(TASKS_DIR, `${setId}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

/** Version for the browser: statement, parts, points — без эталона */
function publicSet(set) {
  return {
    setId: set.setId,
    olympiadId: set.olympiadId,
    title: set.title,
    materialLabel: set.materialLabel,
    lang: set.lang,
    tasks: set.tasks.map((t) => ({
      number: t.number,
      title: t.title,
      weight: t.weight,
      total: t.total,
      statement: t.statement,
      parts: t.parts.map((p) => ({ id: p.id, points: p.points, question: p.question, ...(p.pointsEstimated ? { pointsEstimated: true } : {}) })),
    })),
  };
}

function loadTopics() {
  return readJson(path.join(DATA_DIR, "topics.json")).chemistry || [];
}

function loadVideos() {
  try {
    return readJson(path.join(DATA_DIR, "videos.json"));
  } catch {
    return {};
  }
}

function buildPrompt({ set, task, answers, lang }) {
  const topics = loadTopics();
  const feedbackLang = lang === "kz" ? "казахском" : "русском";
  const system = `Ты — член жюри олимпиады школьников по химии (${set.title}). Ты проверяешь работу ученика СТРОГО по официальному решению и схеме оценивания жюри, как на настоящей олимпиаде.

Правила:
- Оценивай каждый пункт отдельно: от 0 до максимума пункта, шаг 0.5 балла. Распределяй баллы по критериям из официального решения («за … — N балла»).
- Другой путь решения засчитывается, если он химически верен и приводит к верному результату.
- РЕГЛАМЕНТ ОЛИМПИАДЫ: любой ответ без пояснений, даже верный, оценивается в 0 баллов. Если в пункте только перечислены итоговые ответы (вещества, числа, формулы) без расчётов, уравнений или рассуждений, которые к ним ведут, ставь 0 за все критерии, где официальное решение требует расчёта или вывода. Баллы без обоснования допустимы только в тестовых вопросах с выбором ответа и там, где по официальному решению ответ не требует вывода (например, вещество прямо названо по описанию в условии), — и только за этот критерий. Одинаково строго для ответов на любом языке.
- Не давай баллы «за попытку», «за идею» или «за структуру расчёта»: балл ставится только за критерий схемы, выполненный верно (верное значение, верное уравнение, верный вывод). Неверный шаг — 0 за этот критерий.
- НЕЗАКОНЧЕННОЕ РЕШЕНИЕ: верно выполненные шаги засчитываются, даже если ученик не дошёл до ответа. Если в схеме есть баллы за шаги — дай их; если схема даёт только общий балл за пункт, оцени пропорционально доле верно пройденных ключевых шагов официального решения (например, половина верного хода ≈ половина баллов, без итогового ответа). Ставить 0 за незаконченное, но верное начало нельзя.
- Текст ученика может быть скопирован из PDF: индексы и дроби разорваны по строкам (H2 / SO4 / ), m / ρ). Читай его по смыслу, это не ошибка. Перенос ошибки: если дальше ученик верно действует с собственным неверным числом, баллы за эти шаги можно дать, только если ход химически верен.
- Неверные или отсутствующие единицы измерения — снижай по критерию.
- Небольшие расхождения из-за округления допустимы.
- Не придумывай критерии, которых нет в решении; если критериев нет — оценивай пропорционально правильности.
- Пустой пункт = 0 баллов.
- Если у пункта нет отдельного эталона и дано официальное решение задачи целиком, оценивай только ту его часть, которая относится к этому пункту.
- Если максимум пункта помечен как оценочный, распределяй его пропорционально критериям официального решения.
- Ответ, где только итог без хода решения, не получает баллы за расчёт/обоснование; если в критериях есть отдельный балл за верный итоговый ответ — его можно дать.
- Комментарии пиши на ${feedbackLang} языке, кратко и по делу: что верно, где ошибка, какой правильный ход (без полного переписывания решения).
- Для каждой ошибки укажи тему из списка (поле topic — id):
${topics.map((t) => `  ${t.id} — ${t.label}`).join("\n")}

Отвечай ТОЛЬКО валидным JSON без markdown:
{"parts":[{"id":"3.1","score":12.5,"verdict":"correct|partial|wrong|empty","feedback":"…","mistakes":[{"topic":"stoichiometry","text":"что именно не так"}]}],"summary":"общий вывод жюри в 1-2 предложения"}`;

  let user = `Олимпиада: ${set.title} · ${set.materialLabel}\n`;
  user += `Задача №${task.number}. ${task.title}\n\nУСЛОВИЕ:\n${task.statement}\n\n`;
  if (task.solution && task.parts.some((p) => p.useTaskSolution)) {
    user += `ОФИЦИАЛЬНОЕ РЕШЕНИЕ ЗАДАЧИ ЦЕЛИКОМ (для пунктов без отдельного эталона — бери из него только то, что относится к пункту):\n${task.solution}\n\n`;
  }
  for (const part of task.parts) {
    const answer = String(answers[part.id] || "").trim();
    user += `──────── ПУНКТ ${part.id} (максимум ${part.points ?? "?"} баллов${part.pointsEstimated ? ", оценочно — в официальной схеме баллы за пункт не указаны" : ""})\n`;
    if (part.question) user += `Вопрос: ${part.question}\n`;
    const ref = part.useTaskSolution
      ? `(см. официальное решение задачи целиком выше — оценивай только пункт ${part.id})${part.reference ? "\n" + part.reference : ""}`
      : part.reference || "(нет эталона — оценивай по существу)";
    user += `ОФИЦИАЛЬНОЕ РЕШЕНИЕ И КРИТЕРИИ ЖЮРИ:\n${ref}\n`;
    user += `ОТВЕТ УЧЕНИКА:\n${answer || "(пусто)"}\n\n`;
  }
  return { system, user };
}

function extractJson(text) {
  const raw = String(text || "").replace(/```json|```/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ИИ вернул не JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function roundHalf(x) {
  return Math.round(x * 2) / 2;
}

/** Ответ без единого шага решения: короткий и без знаков вычислений/преобразований */
function isBareAnswer(answer) {
  const a = String(answer).trim();
  if (a.length > 160) return false;
  return !/[=→⇒⟶·×*\/÷^]|\bmol\b.*\bmol\b/i.test(a);
}

/** В официальном решении пункта есть расчёты (формулы с «=» и числами) */
function needsCalculation(part, task) {
  const ref = part.useTaskSolution ? `${part.reference || ""}\n${task.solution || ""}` : String(part.reference || "");
  return (ref.match(/=\s*[-−]?\d/g) || []).length >= 1;
}

/** Clamp scores, fill missing parts, attach topic labels and videos */
function normalizeResult(task, answers, ai) {
  const topics = loadTopics();
  const topicLabel = Object.fromEntries(topics.map((t) => [t.id, t.label]));
  const videos = loadVideos();
  const aiParts = Array.isArray(ai.parts) ? ai.parts : [];

  const parts = task.parts.map((p) => {
    const max = Number(p.points) || 0;
    const answer = String(answers[p.id] || "").trim();
    // ИИ иногда пишет id иначе («2.1.», «Пункт 2.1») — сравниваем по номеру, а если не нашли и число пунктов совпадает — по порядку
    const normId = (x) => String(x ?? "").replace(/[^\d.]/g, "").replace(/\.$/, "");
    const r =
      aiParts.find((x) => String(x.id) === p.id) ||
      aiParts.find((x) => normId(x.id) === p.id) ||
      (aiParts.length === task.parts.length ? aiParts[task.parts.indexOf(p)] : null) ||
      {};
    let score = answer ? Number(r.score) : 0;
    if (!Number.isFinite(score)) score = 0;
    score = Math.min(max, Math.max(0, roundHalf(score)));
    // Страховка регламента «ответ без пояснений, даже верный, — 0»: слабые модели иногда ставят баллы за голые числа
    const bare = answer && isBareAnswer(answer) && needsCalculation(p, task);
    if (bare && score > 0) score = 0;
    let verdict = !answer ? "empty" : score >= max && max > 0 ? "correct" : score > 0 ? "partial" : "wrong";
    const mistakes = (Array.isArray(r.mistakes) ? r.mistakes : [])
      .filter((m) => m && m.text)
      .map((m) => ({ topic: topicLabel[m.topic] ? m.topic : "reasoning", text: String(m.text).slice(0, 600) }));
    return {
      id: p.id,
      max,
      score,
      verdict,
      feedback: !answer
        ? "Пункт не решён."
        : bare
          ? "Приведены только итоговые ответы без расчётов и обоснования — по регламенту олимпиады такой ответ оценивается в 0 баллов, даже если он верный. Покажите ход решения."
          : String(r.feedback || "").slice(0, 2000),
      mistakes,
    };
  });

  const score = parts.reduce((s, p) => s + p.score, 0);
  const max = parts.reduce((s, p) => s + p.max, 0);

  // Topics to review: from mistakes in parts that lost points
  const topicCount = new Map();
  for (const p of parts) {
    if (p.verdict === "correct" || p.verdict === "empty") continue;
    for (const m of p.mistakes) topicCount.set(m.topic, (topicCount.get(m.topic) || 0) + 1);
  }
  const review = [...topicCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, label: topicLabel[id], count, videos: Array.isArray(videos[id]) ? videos[id] : [] }));

  return {
    taskNumber: task.number,
    score: roundHalf(score),
    max,
    percent: max ? Math.round((score / max) * 100) : 0,
    summary: String(ai.summary || "").slice(0, 1000),
    parts,
    review,
  };
}

/** Deterministic fake jury for local UI testing (QAZAKX_FAKE_AI=1). Never used in production. */
function fakeJury(task, answers) {
  return {
    parts: task.parts.map((p, i) => {
      const a = String(answers[p.id] || "").trim();
      const max = Number(p.points) || 0;
      if (!a) return { id: p.id, score: 0 };
      const ratio = a.length > 120 ? 1 : a.length > 30 ? 0.5 : 0;
      return {
        id: p.id,
        score: max * ratio,
        feedback: ratio === 1 ? "Решение полное, ход верный." : ratio ? "Ход решения верный, но не хватает расчётов и обоснования итогового ответа." : "Ответ без обоснования — по регламенту 0 баллов.",
        mistakes: ratio === 1 ? [] : [{ topic: i % 2 ? "stoichiometry" : "inorganic-identification", text: "Не приведён расчёт, подтверждающий ответ." }],
      };
    }),
    summary: "Тестовый режим проверки (QAZAKX_FAKE_AI=1).",
  };
}

async function gradeTask({ setId, taskNumber, answers = {}, lang = "ru" }) {
  const set = loadSet(setId);
  if (!set) return { success: false, status: 404, error: "SET_NOT_FOUND", message: "Комплект задач не найден." };
  const task = set.tasks.find((t) => Number(t.number) === Number(taskNumber));
  if (!task) return { success: false, status: 404, error: "TASK_NOT_FOUND", message: "Задача не найдена." };

  const clean = {};
  for (const p of task.parts) {
    const v = answers && typeof answers === "object" ? answers[p.id] : "";
    clean[p.id] = String(v || "").slice(0, 8000);
  }
  if (!Object.values(clean).some((v) => v.trim())) {
    return { success: false, status: 400, error: "EMPTY", message: "Напишите ответ хотя бы на один пункт." };
  }

  let ai;
  let provider = null;
  if (process.env.QAZAKX_FAKE_AI === "1") {
    ai = fakeJury(task, clean);
    provider = "fake";
  } else {
    const { processAIRequest } = require("../api/_lib/ai-service");
    const { system, user } = buildPrompt({ set, task, answers: clean, lang });
    const res = await processAIRequest({ prompt: user, systemPrompt: system, options: { maxTokens: 6000 } });
    if (!res.success) return { success: false, status: 503, error: res.error, message: res.message, details: res.details };
    try {
      ai = extractJson(res.data.text);
    } catch (err) {
      return { success: false, status: 502, error: "BAD_AI_RESPONSE", message: "ИИ ответил в неверном формате. Попробуйте ещё раз." };
    }
    provider = res.data.provider;
  }

  return { success: true, provider, result: normalizeResult(task, clean, ai) };
}

module.exports = { loadSet, publicSet, gradeTask, buildPrompt, normalizeResult, isValidSetId, isBareAnswer };
