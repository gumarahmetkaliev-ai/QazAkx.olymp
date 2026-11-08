/**
 * Парсер комплектов олимпиад (формат qazcho.kz / республиканские олимпиады РК и похожие).
 *
 * На вход — текст PDF заданий и PDF решений (pdftotext -layout или pdf-parse).
 * На выход — задачи с пунктами, баллами за каждый пункт, текстом вопроса
 * и эталонным решением жюри с критериями оценивания.
 *
 *   Задача №3. Неизвестные кристаллогидраты
 *    3.1   3.2   3.3   Всего   Вес(%)
 *    26    22    2     50      14
 *   ...
 *   3.1 (26 баллов)  ← в решениях: начало эталона пункта
 */

const TASK_HEADER = /^\s*(?:Задача|Задание|Есеп|Тапсырма|Problem|Task)\s*№?\s*(\d{1,2})\s*[.:]?\s*(.*)$/i;
const TOTAL_WORD = /(Всего|Барлығы|Барлыгы|Жалпы|Total)/i;
const SOL_PART = /^\s*(\d{1,2})\.(\d{1,2})\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:балл|ұпай|упай|pt|point)/i;

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[–—]/g, "–")
    .replace(/\f/g, "\n");
}

/** Remove page headers/footers: lines repeated on many pages and "3/7  chem9-1-tasks" footers */
function stripRepeatedLines(text) {
  const lines = normalizeText(text).split("\n");
  const counts = new Map();
  for (const line of lines) {
    const key = line.trim();
    if (key.length > 8) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return lines
    .filter((line) => {
      const key = line.trim();
      if (/^\d{1,3}\s*\/\s*\d{1,3}(\s|$)/.test(key)) return false;
      if (key.length > 8 && counts.get(key) >= 3 && !TASK_HEADER.test(key)) return false;
      return true;
    })
    .join("\n");
}

function collapseBlankLines(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split document into tasks by "Задача №N." headers. For repeated numbers keeps the longest block (skips table of contents). */
function splitTasks(text) {
  const lines = stripRepeatedLines(text).split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(TASK_HEADER);
    const isToc = /\s{3,}\d{1,3}\s*$/.test(line) || /\.{4,}/.test(line);
    // A real header starts the line and is short (not a sentence that mentions "задача №2")
    if (m && !isToc && line.trim().length < 120 && /^\s{0,4}\S/.test(line)) {
      current = { number: Number(m[1]), title: m[2].trim().replace(/\.$/, ""), lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  const best = new Map();
  for (const b of blocks) {
    const body = b.lines.join("\n");
    const prev = best.get(b.number);
    if (!prev || body.trim().length > prev.body.trim().length) best.set(b.number, { number: b.number, title: b.title, body });
  }
  return [...best.values()].sort((a, b) => a.number - b.number);
}

/** Read the points table under the task header */
function parsePointsTable(body) {
  const lines = body.split("\n");
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    if (!TOTAL_WORD.test(lines[i])) continue;
    const headers = lines[i].match(/\d{1,2}\.\d{1,2}|Всего|Барлығы|Барлыгы|Жалпы|Total|Вес|Weight|Салмағы/gi) || [];
    let valuesLine = "";
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    valuesLine = lines[j] || "";
    const values = valuesLine.match(/\d+(?:[.,]\d+)?/g) || [];
    const parts = [];
    let total = null;
    let weight = null;
    headers.forEach((h, idx) => {
      const v = values[idx] != null ? Number(String(values[idx]).replace(",", ".")) : null;
      if (/^\d/.test(h)) parts.push({ id: h, points: v });
      else if (TOTAL_WORD.test(h)) total = v;
      else weight = v;
    });
    const rest = lines.slice(0, i).concat(lines.slice(j + 1)).join("\n");
    return { parts, total, weight, rest };
  }
  return { parts: [], total: null, weight: null, rest: body };
}

/** Numbered questions "  1. Определите ..." with indented continuation lines */
function parseQuestions(body) {
  const lines = body.split("\n");
  const questions = [];
  let current = null;
  let expected = 1;
  for (const line of lines) {
    const m = line.match(/^\s{0,8}(\d{1,2})\.\s+(\S.*)$/);
    if (m && Number(m[1]) === expected) {
      current = { n: expected, text: m[2].trim(), textCol: line.indexOf(m[2]) };
      questions.push(current);
      expected++;
      continue;
    }
    if (current) {
      const indent = line.search(/\S/);
      if (line.trim() && indent >= current.textCol - 1) current.text += " " + line.trim();
      else if (line.trim()) current = null;
    }
  }
  return questions.map((q) => q.text.replace(/\s+/g, " ").replace(/(\S)- (\S)/g, "$1$2"));
}

/** Split a solution body into "N.M (X баллов)" blocks */
function parseSolutionParts(body) {
  const lines = body.split("\n");
  const parts = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(SOL_PART);
    if (m) {
      current = { id: `${m[1]}.${m[2]}`, points: Number(m[3].replace(",", ".")), lines: [] };
      if (!parts.some((p) => p.id === current.id)) parts.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return parts.map((p) => ({ id: p.id, points: p.points, reference: collapseBlankLines(p.lines.join("\n")) }));
}

/**
 * Build structured task list.
 * @param {string} tasksText text of the tasks PDF
 * @param {string} [solText] text of the solutions PDF
 */
function parseOlympiad(tasksText, solText = "") {
  const rawTasks = splitTasks(tasksText);
  const solTasks = solText ? splitTasks(solText) : [];

  return rawTasks.map((t) => {
    const table = parsePointsTable(t.body);
    const questions = parseQuestions(table.rest);
    const sol = solTasks.find((s) => s.number === t.number);
    const solTable = sol ? parsePointsTable(sol.body) : { rest: "" };
    const solParts = sol ? parseSolutionParts(solTable.rest).filter((p) => p.id.startsWith(`${t.number}.`)) : [];

    // Parts: solutions are authoritative (they carry points + reference), then the table, then questions
    let ids = solParts.map((p) => p.id);
    if (!ids.length) ids = table.parts.map((p) => p.id);
    if (!ids.length) ids = questions.length > 1 ? questions.map((_, i) => `${t.number}.${i + 1}`) : [`${t.number}.1`];

    const singlePart = ids.length === 1;
    const parts = ids.map((id, idx) => {
      const sp = solParts.find((p) => p.id === id);
      const tp = table.parts.find((p) => p.id === id);
      let points = tp?.points ?? sp?.points ?? null;
      if (points == null && singlePart) points = table.total;
      return {
        id,
        points,
        question: questions[idx] || (singlePart ? "Решите задачу полностью и запишите ответ." : ""),
        reference: sp?.reference || (singlePart && sol ? collapseBlankLines(solTable.rest) : ""),
      };
    });

    const total = table.total ?? (parts.every((p) => p.points != null) ? parts.reduce((s, p) => s + p.points, 0) : null);
    return {
      number: t.number,
      title: t.title || `Задача №${t.number}`,
      weight: table.weight,
      total,
      statement: collapseBlankLines(table.rest),
      parts,
    };
  });
}

/** Quick quality report used by scripts/build-tasks.js */
function qualityReport(tasks) {
  const parts = tasks.flatMap((t) => t.parts);
  return {
    tasks: tasks.length,
    parts: parts.length,
    withPoints: parts.filter((p) => p.points != null).length,
    withReference: parts.filter((p) => p.reference && p.reference.length > 20).length,
    withQuestion: parts.filter((p) => p.question).length,
  };
}

module.exports = {
  normalizeText,
  stripRepeatedLines,
  splitTasks,
  parsePointsTable,
  parseQuestions,
  parseSolutionParts,
  parseOlympiad,
  qualityReport,
};
