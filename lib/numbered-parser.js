/**
 * Разбор олимпиад, где задачи просто пронумерованы: «1. …», «Problem 1.», «Задача 1.», «1-есеп».
 * Так устроены математика (областная/республиканская РК, IMO, EGMO…) и многие туры физики.
 *
 * Каждая задача — один пункт (ответ целиком), баллы — «Каждая задача оценивается в N баллов»
 * (по умолчанию 7, помечаются как оценочные). Решение — из PDF решений по тому же номеру,
 * для нужного класса и тура, на русском, если есть.
 */

const { linearize, langOf } = require("./columns");

const START_RE = /^[ \t]{0,6}(?:(?:Problem|Задача|Task|Question)\s*(?:№\s*)?(\d{1,2})\s*[.:)]?|(\d{1,2})\s*[-–]\s*есеп\s*[.:)]?|(\d{1,2})\s*[.)](?!\d))\s*(?=\S|$)/i;
const SOL_HEAD_RE = /^\s*(?:Solution|Решение|Шешуi|Шешуі|Шешімі)\s*[.:]/i;

/** Найти все начала задач: [{num, line}] */
function findStarts(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const m = l.match(START_RE);
    if (!m) return;
    const num = Number(m[1] || m[2] || m[3]);
    if (!num || num > 30) return;
    // «1.» внутри текста решения обычно с отступом или после короткой строки; пропускаем нумерацию дробей «0.5»
    if (/^\s*\d+\.\d/.test(l)) return;
    out.push({ num, line: i, named: Boolean(m[1] || m[2]) });
  });
  return out;
}

/**
 * Выделить «серии» 1,2,3… (по одной на язык или день) и вернуть лучшую.
 * Серия: возрастающие номера с шагом 1, начиная с 1 (или продолжая предыдущий день).
 */
function runsOf(lines) {
  const starts = findStarts(lines);
  const named = starts.filter((s) => s.named);
  const use = named.length >= 2 ? named : starts;
  const runs = [];
  let cur = null;
  for (const s of use) {
    if (cur && s.num === cur.items[cur.items.length - 1].num + 1) cur.items.push(s);
    else if (s.num === 1 || (cur == null && s.num <= 4)) {
      cur = { items: [s] };
      runs.push(cur);
    }
  }
  return runs
    .filter((r) => r.items.length >= 1)
    .map((r, idx) => {
      const next = runs[idx + 1];
      const end = next ? next.items[0].line : lines.length;
      const items = r.items.map((s, i) => {
        const to = i + 1 < r.items.length ? r.items[i + 1].line : end;
        const body = lines.slice(s.line, to).join("\n");
        return { num: s.num, text: cleanBlock(body) };
      });
      const all = items.map((x) => x.text).join("\n");
      return { items, lang: langOf(all), size: all.length };
    });
}

function cleanBlock(text) {
  return String(text)
    .replace(START_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const LANG_PREF = { ru: 0, en: 1, kz: 2 };

/** Лучшая серия: самая длинная, при равенстве — русский, потом английский */
function pickRun(runs, want = "ru") {
  if (!runs.length) return null;
  const maxLen = Math.max(...runs.map((r) => r.items.length));
  const full = runs.filter((r) => r.items.length >= Math.max(2, maxLen - 1) || r.items.length === maxLen);
  full.sort((a, b) => (a.lang === want ? -1 : 0) - (b.lang === want ? -1 : 0) || LANG_PREF[a.lang] - LANG_PREF[b.lang] || b.items.length - a.items.length);
  return full[0];
}

/** Все дни/серии подряд (IMO: день 1 — задачи 1–3, день 2 — 4–6) */
function mergeDays(runs, lang) {
  const same = runs.filter((r) => r.lang === lang);
  const byNum = new Map();
  for (const r of same) for (const it of r.items) if (!byNum.has(it.num)) byNum.set(it.num, it);
  return [...byNum.values()].sort((a, b) => a.num - b.num);
}

/** Кусок решений для класса/тура, если в одном PDF решения нескольких классов */
function sliceForGrade(text, grade, round) {
  if (grade == null) return text;
  const g = String(grade).split("-")[0];
  const lines = text.split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/(\d{1,2})\s*[-–]?\s*(?:сынып|класс|кл\.|grade)/i);
    if (m) heads.push({ i, g: m[1], round: (l.match(/(\d)\s*[-–]?\s*(?:тур|күн|день|day)/i) || [])[1] });
  });
  const distinct = new Set(heads.map((h) => h.g));
  if (distinct.size < 2) return text;
  const parts = [];
  heads.forEach((h, k) => {
    if (h.g !== g) return;
    if (round && h.round && Number(h.round) !== Number(round)) return;
    const next = heads.slice(k + 1).find((x) => x.g !== g || (round && x.round && Number(x.round) !== Number(round)));
    parts.push(lines.slice(h.i, next ? next.i : lines.length).join("\n"));
  });
  return parts.length ? parts.join("\n") : text;
}

function pointsPerTask(text) {
  const m =
    String(text).match(/(?:Каждая задача|каждой задачи)[^.\n]{0,30}?(\d{1,2})\s*балл/i) ||
    String(text).match(/Әр есеп\s*(\d{1,2})\s*ұпай/i) ||
    String(text).match(/each (?:problem|question)[^.\n]{0,30}?(\d{1,2})\s*points/i);
  return m ? Number(m[1]) : null;
}

const BLOCK_RE = /^[ \t]{0,8}(?:(?:Problem|Задача|Task|Question)\s*(?:№\s*)?)?(?:[ACGN]\d{1,2}|\d{1,2}(?:\.\d{1,2})?|\d{1,2}\s*[-–]\s*есеп)\s*[.):]\s*\S/i;

/** Разрезать решения на блоки по любым заголовкам задач */
function solBlocks(text) {
  const lines = text.split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    if (BLOCK_RE.test(l) && !/^\s*\d+\.\d+\s*$/.test(l)) heads.push(i);
  });
  return heads.map((h, k) => {
    const body = lines.slice(h, heads[k + 1] ?? lines.length).join("\n");
    return { head: body.slice(0, 700), text: body.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() };
  });
}

function tokens(text) {
  const out = new Set();
  const s = String(text).toLowerCase();
  for (const m of s.matchAll(/[a-z]{1,4}\d*|\d+|[а-яёәғқңөұүһі]{4,}/g)) {
    const t = m[0];
    out.add(/^[а-я]/.test(t) ? t.slice(0, 5) : t);
  }
  return out;
}

function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

function matchBySimilarity(problems, blocks) {
  const map = new Map();
  if (!blocks.length) return map;
  const used = new Set();
  for (const p of problems) {
    const pt = tokens(p.text.slice(0, 500));
    if (pt.size < 4) continue;
    let best = null;
    blocks.forEach((b, i) => {
      if (used.has(i)) return;
      const sc = similarity(pt, tokens(b.head));
      const lb = langOf(b.head) === langOf(p.text) ? 0.05 : 0;
      if (!best || sc + lb > best.sc) best = { i, sc: sc + lb };
    });
    if (best && best.sc >= 0.45) {
      used.add(best.i);
      map.set(p.num, blocks[best.i].text);
    }
  }
  return map;
}

/** Разобрать комплект. Возвращает массив задач в формате task-parser или [] */
function parseNumbered(tasksText, solText, opts = {}) {
  const tasksLin = linearize(tasksText).text;
  const tRuns = runsOf(tasksLin.replace(/\f/g, "\n").split("\n"));
  const best = pickRun(tRuns, opts.lang || "ru");
  if (!best) return [];
  const problems = mergeDays(tRuns, best.lang);
  if (!problems.length || problems.length > 25) return [];

  let solMap = new Map();
  if (solText && solText.trim()) {
    const full = linearize(solText).text.replace(/\f/g, "\n");
    // 1) решения обычно повторяют условие — ищем блок, начало которого похоже на условие задачи
    solMap = matchBySimilarity(problems, solBlocks(full));
    // 2) иначе — по номеру в разделе нужного класса/тура
    if (solMap.size < Math.ceil(problems.length / 2)) {
      const solLin = sliceForGrade(full, opts.grade, opts.round);
      const sRuns = runsOf(solLin.split("\n"));
      for (const lang of [best.lang, "ru", "en", "kz"]) {
        const merged = mergeDays(sRuns, lang);
        if (merged.length >= Math.min(problems.length, 2) || (problems.length === 1 && merged.length)) {
          const byNum = new Map(merged.map((x) => [x.num, x.text]));
          for (const [k, v] of byNum) if (!solMap.has(k)) solMap.set(k, v);
          break;
        }
      }
    }
  }

  const pts = pointsPerTask(tasksText) || pointsPerTask(solText);
  return problems.map((p) => {
    const reference = solMap.get(p.num) || "";
    const points = pts || 7;
    return {
      number: p.num,
      title: `Задача ${p.num}`,
      statement: p.text,
      total: points,
      parts: [
        {
          id: String(p.num),
          question: "Приведите полное решение (с доказательством или выводом).",
          points,
          ...(pts ? {} : { pointsEstimated: true }),
          reference: reference ? reference.slice(0, 12000) : "",
        },
      ],
    };
  });
}

module.exports = { parseNumbered, solBlocks, matchBySimilarity, runsOf, sliceForGrade, pointsPerTask };
