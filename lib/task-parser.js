/**
 * Парсер комплектов олимпиад по химии: РК (qazcho.kz, рус/каз), Всеросс (все этапы),
 * Менделеевская, IChO, Junior, сборы и похожие форматы.
 *
 * На вход — текст PDF заданий и PDF решений (pdftotext -layout или pdf-parse).
 * На выход — задачи с пунктами, баллами за каждый пункт, текстом вопроса
 * и эталонным решением жюри с критериями оценивания.
 *
 * Поддерживаемые заголовки задач:
 *   Задача №3. Название | Задача 10-1 | Задание 2 | ЗАДАЧА 4 (7 баллов)
 *   №1 Есеп. Атауы | 1-есеп | Есеп №2 | Тапсырма 3
 *   Problem 1. Title | Task 2
 *   №9-1-2006 обл. Текст задачи…
 *
 * Источники баллов за пункт (по приоритету):
 *   1) таблица под заголовком:   3.1  3.2  Всего  Вес(%) / Барлығы Үлесі(%) / Total
 *   2) пометки в решениях:       3.1 (26 баллов) | 1.1 (14.0 pt) | 2.1 (8 ұпай)
 *   3) «Система оценивания»:     1. Вещества А–H по 1 баллу      9 баллов
 *   4) баллы в строке вопроса:   1. Определите … (1,5 балла)  |  2.5  Определите L.  5.0pt
 *
 * Эталон пункта: блок решения «N.k (X баллов)», иначе блок решения под номером k,
 * иначе полное решение задачи (с пометкой, какой пункт оценивать) + критерий из схемы оценивания.
 */

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const POINT_WORD = String.raw`(?:балл[а-яё]*|б\.|ұпай[а-яәіңғүұқөһ]*|упай[а-яё]*|pts?\.?|points?|point)`;
const TOTAL_WORD = /(Всего|Итого|Барлығы|Барлыгы|Жалпы|Total)/i;
const WEIGHT_WORD = /(Вес|Weight|Салмағы|Үлесі|Улесі|% of)/i;
const SOL_PART = new RegExp(String.raw`^\s*(\d{1,2})\.(\d{1,2})\.?\s*\(\s*(${NUM})\s*${POINT_WORD}`, "i");
const SCHEME_HEADER = /(Система\s+оценивания|Критерии\s+оценивания|Схема\s+оценивания|Разбалловка|Распределение\s+баллов|Оценивание|Бағалау\s+(жүйесі|критерийлері)|Grading\s+scheme|Marking\s+scheme)\s*[:.]?\s*$/i;
const TOTAL_LINE = new RegExp(String.raw`^\s*(?:ИТОГО|Итого|Всего|Барлығы|Total)\s*[:\-–]?\s*(${NUM})\s*${POINT_WORD}?`, "i");

function num(s) {
  return s == null ? null : Number(String(s).replace(",", "."));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[–—]/g, "–")
    .replace(/\f/g, "\n");
}

/**
 * Task header → { number, title, total } or null.
 * A header starts the line (≤6 spaces indent) and is short.
 */
function matchTaskHeader(line) {
  const raw = line.replace(/\s+$/, "");
  // IChO official translations: right-aligned page marker "Q3-1" = first page of problem 3
  const q = raw.match(/^\s*Q(\d{1,2})-1$/);
  if (q) return { number: Number(q[1]), key: q[1], title: "", total: null, inlineText: "", pageMarker: true };
  if (!/^\s{0,6}\S/.test(raw)) return null;
  const s = raw.trim();
  if (s.length > 140) return null;
  if (/\.{4,}/.test(s) || /\S\s{3,}\d{1,3}$/.test(s)) return null; // table of contents
  let m;
  let number = null;
  let key = null;
  let rest = "";
  // Задача №3. / Задача 10-1 / Problem 2 / Есеп №1 / Решение задачи 9-1 / Solution to Problem 4
  if ((m = s.match(/^(?:Решени[ея]\s+(?:[Зз]адачи|[Зз]адания)|Ответы?\s+(?:к|на)\s+задач[уеи]|Solutions?\s+(?:to\s+|of\s+)?(?:Problem|Task)|Задача|ЗАДАЧА|Задание|ЗАДАНИЕ|Problem|PROBLEM|Task|TASK|Есеп|ЕСЕП|Тапсырма|ТАПСЫРМА)\s*№?\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(?![\d.,]\d)\s*(.*)$/))) {
    if (m[2]) {
      number = Number(m[2]);
      key = `${Number(m[1])}-${Number(m[2])}`;
    } else number = Number(m[1]);
    rest = m[3];
  } else if ((m = s.match(/^№\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[-–]\s*\d{4}\s*(.*)$/))) {
    // №9-1-2006 обл. Текст…
    number = Number(m[2]);
    rest = m[3].replace(/^(обл|респ|рай)[а-я]*\.?\s*/i, "");
  } else if ((m = s.match(/^№\s*(\d{1,2})\s*[.)]?\s*(?:Есеп|есеп|ЕСЕП|Задача|задача|Тапсырма|тапсырма)(?![а-яёәіңғүұқөһ])\.?\s*(.*)$/))) {
    number = Number(m[1]);
    rest = m[2];
  } else if ((m = s.match(/^(\d{1,2})\s*[-–]\s*(?:есеп|ЕСЕП|Есеп|тапсырма|Тапсырма)(?![а-яёәіңғүұқөһ])\.?\s*(.*)$/))) {
    number = Number(m[1]);
    rest = m[2];
  } else {
    return null;
  }
  if (!number || number > 40) return null;
  // Header must not be a sentence that merely mentions a task ("Задача 2 решается…" is rare; "Задача 1 (7 баллов)" is fine)
  rest = rest.replace(/^[.:)\s]+/, "");
  let total = null;
  const pm = rest.match(new RegExp(String.raw`\(\s*(${NUM})\s*${POINT_WORD}\s*\)`, "i"));
  if (pm) total = num(pm[1]);
  const title = rest
    .replace(new RegExp(String.raw`\(\s*${NUM}\s*${POINT_WORD}\s*\)`, "ig"), "")
    .replace(/\((автор|авторы|author)[^)]*\)/gi, "")
    .replace(/\(\s*\d+\s*%\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  return { number, key: key || String(number), title, total, inlineText: /^№/.test(s) && title.length > 60 ? title : "" };
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
      if (/^Q\d{1,2}-\d{1,2}$/.test(key) && !/^Q\d{1,2}-1$/.test(key)) return false;
      if (/^(Страница|Page|Бет)\s*\d+(\s*(из|of)\s*\d+)?$/i.test(key)) return false;
      if (key.length > 8 && counts.get(key) >= 3 && !matchTaskHeader(line) && !TOTAL_WORD.test(key)) return false;
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

/**
 * Split document into tasks by headers. Blocks are keyed by "9-1"-style keys when present
 * (all-grades documents of Vseros), otherwise by task number.
 * For repeated keys keeps the longest block (skips table of contents).
 */
function splitTasks(text) {
  const lines = stripRepeatedLines(text).split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const h = matchTaskHeader(line);
    if (h) {
      current = { number: h.number, key: h.key, title: h.inlineText ? "" : h.title, total: h.total, pageMarker: Boolean(h.pageMarker), lines: h.inlineText ? [h.inlineText] : [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const b of blocks) {
    if (b.title || !b.pageMarker) continue;
    const first = b.lines.map((l) => l.trim()).find((l) => l && l.length < 100 && !/(Kazakhstan|Russian|English|Kazakh|Theory|IChO)/i.test(l) && !/^\d/.test(l));
    if (first && !/^\d+\.\d+/.test(first)) b.title = first.replace(/\.$/, "");
  }
  const best = new Map();
  const order = [];
  for (const b of blocks) {
    const body = b.lines.join("\n");
    const prev = best.get(b.key);
    if (!prev) order.push(b.key);
    if (!prev || body.trim().length > prev.body.trim().length) {
      best.set(b.key, { number: b.number, key: b.key, title: b.title || prev?.title || "", total: b.total ?? prev?.total ?? null, body });
    } else if (prev.total == null && b.total != null) {
      prev.total = b.total;
    }
  }
  const out = order.map((k) => best.get(k));
  const multiGrade = new Set(out.filter((t) => /-/.test(t.key)).map((t) => t.key.split("-")[0])).size > 1;
  if (multiGrade) {
    // "9-1", "10-1", "11-1" in one document: renumber sequentially, keep the original label in the title
    out.forEach((t, i) => {
      t.label = t.key;
      t.number = i + 1;
      t.title = `${t.key}${t.title ? ". " + t.title : ""}`;
    });
    return out;
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Read the points table under the task header (values are matched to headers by column position) */
function parsePointsTable(body, taskNumber) {
  const lines = body.split("\n");
  const HEADER_TOKEN = /\d{1,2}\.\d{1,2}(?![\d.])|Всего|Итого|Барлығы|Барлыгы|Жалпы|Total|Вес|Weight|Салмағы|Үлесі|Улесі|% of|За каждый|Әр(?:бір)? дұрыс|Each correct/gi;
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    if (!TOTAL_WORD.test(lines[i]) && !/^\s*(\d{1,2}\.\d{1,2}\s+){2,}/.test(lines[i])) continue;
    const headers = [...lines[i].matchAll(HEADER_TOKEN)].map((m) => ({ h: m[0], col: m.index + m[0].length / 2 }));
    if (!headers.some((x) => /^\d/.test(x.h)) && !headers.some((x) => TOTAL_WORD.test(x.h))) continue;
    // A table header row, not a sentence: at least two columns and little other text
    const leftover = lines[i].replace(HEADER_TOKEN, "").replace(/\((%|балл\S*|ұпай)\)|[()%]/gi, "");
    if (headers.length < 2 || (leftover.match(/[A-Za-zА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ]/g) || []).length > 12) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const vline = (lines[j] || "").replace(/^(\s*)(Points|Баллы|Балл|Ұпай)/i, (m0, sp, w) => sp + " ".repeat(w.length));
    const values = [...vline.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => ({ v: num(m[0]), col: m.index + m[0].length / 2 }));
    if (values.length < Math.min(headers.length, 2) && headers.length > 1) continue;
    if (taskNumber != null && headers.some((x) => /^\d/.test(x.h)) && !headers.some((x) => /^\d/.test(x.h) && Number(x.h.split(".")[0]) === taskNumber) && !headers.some((x) => TOTAL_WORD.test(x.h))) continue;
    // Assign each value to the nearest header column; if counts match, plain order is as good
    const assigned = new Map();
    if (values.length === headers.length) headers.forEach((x, idx) => assigned.set(idx, values[idx].v));
    else
      for (const val of values) {
        let best = -1;
        let dist = Infinity;
        headers.forEach((x, idx) => {
          const d = Math.abs(x.col - val.col);
          if (d < dist && !assigned.has(idx)) (dist = d), (best = idx);
        });
        if (best >= 0) assigned.set(best, val.v);
      }
    const parts = [];
    let total = null;
    let weight = null;
    let perItem = null;
    headers.forEach((x, idx) => {
      const v = assigned.has(idx) ? assigned.get(idx) : null;
      if (/^\d/.test(x.h)) {
        if (taskNumber == null || Number(x.h.split(".")[0]) === taskNumber) parts.push({ id: x.h, points: v });
      } else if (TOTAL_WORD.test(x.h)) total = v;
      else if (/каждый|дұрыс|each/i.test(x.h)) perItem = v;
      else weight = v;
    });
    const rest = lines.slice(0, i).concat(lines.slice(j + 1)).join("\n");
    return { parts, total, weight, perItem, rest };
  }
  return { parts: [], total: null, weight: null, perItem: null, rest: body };
}

const QUESTION_LINE = /^\s{0,10}(?:(\d{1,2})\.(\d{1,2})\.?\s+|(\d{1,2})(\.\s*|\)\s+))(?![\d.,])(\S.*)$/;

/** Numbering style of a list: "dot" (1. / 1.1) when present, else "paren" (1)) */
function listStyle(lines, taskNumber) {
  let dot = false;
  for (const line of lines) {
    const m = line.match(QUESTION_LINE);
    if (!m) continue;
    if (m[1] != null ? Number(m[1]) === taskNumber || taskNumber == null : /\./.test(m[4]) && Number(m[3]) === 1) dot = true;
  }
  return dot ? "dot" : "paren";
}
function styleOk(m, style) {
  if (m[1] != null) return true;
  return style === "dot" ? /\./.test(m[4]) : true;
}

/**
 * Numbered questions "  1. Определите …" / "1.2  Draw …" / "3) …" with continuation lines.
 * Returns [{ k, text, points }] in order k = 1..n.
 */
function parseQuestionItems(body, taskNumber) {
  const lines = body.split("\n");
  const style = listStyle(lines, taskNumber);
  const items = [];
  let current = null;
  let expected = 1;
  for (const line of lines) {
    const m = line.match(QUESTION_LINE);
    if (m) {
      const isDotted = m[1] != null;
      const k = isDotted ? Number(m[2]) : Number(m[3]);
      const okTask = !isDotted || taskNumber == null || Number(m[1]) === taskNumber;
      if (okTask && k === expected && styleOk(m, style) && !/^\d+(\s|$)/.test(m[5])) {
        current = { k, text: m[5].trim(), textCol: line.indexOf(m[5]), points: null };
        const col = m[5].match(new RegExp(String.raw`\s{2,}(${NUM})\s*${POINT_WORD}\s*$`, "i"));
        if (col) {
          current.points = num(col[1]);
          current.text = m[5].slice(0, col.index).trim();
        }
        items.push(current);
        expected++;
        continue;
      }
    }
    if (current) {
      const indent = line.search(/\S/);
      if (line.trim() && indent >= current.textCol - 1) current.text += " " + line.trim();
      else if (line.trim()) current = null;
    }
  }
  return items.map((q) => {
    let text = q.text.replace(/\s+/g, " ").replace(/(\S)- (\S)/g, "$1$2").trim();
    let points = q.points;
    const pm = points != null ? null : text.match(new RegExp(String.raw`\(?\s*(${NUM})\s*${POINT_WORD}\s*\)?\s*$`, "i"));
    if (pm && !/по\s*$/i.test(text.slice(0, pm.index))) {
      points = num(pm[1]);
      text = text.slice(0, pm.index).trim();
    }
    return { k: q.k, text, points };
  });
}

/** Backwards-compatible: just the question texts */
function parseQuestions(body, taskNumber) {
  return parseQuestionItems(body, taskNumber).map((q) => q.text);
}

/** Split a solution body into "N.M (X баллов)" blocks */
function parseSolutionParts(body) {
  const lines = body.split("\n");
  const parts = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(SOL_PART);
    if (m) {
      const id = `${m[1]}.${m[2]}`;
      const existing = parts.find((p) => p.id === id);
      current = existing || { id, points: num(m[3]), lines: [] };
      if (!existing) parts.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return parts.map((p) => ({ id: p.id, points: p.points, reference: collapseBlankLines(p.lines.join("\n")) }));
}

/** Split the grading scheme off the solution body: { solution, scheme: [{k, text, points}], total } */
function parseGradingScheme(body) {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SCHEME_HEADER.test(lines[i].trim())) start = i;
  }
  // Task total from the grading scheme: "ИТОГО: 20 баллов" (upper case or right-aligned), or "Итого за задачу"
  let total = null;
  for (const l of lines) {
    const tm = l.match(TOTAL_LINE);
    if (tm && (/ИТОГО|ВСЕГО|за задачу|Total/.test(l) || /^\s{10,}/.test(l))) total = num(tm[1]);
  }
  if (start < 0) {
    // No explicit header: a numbered list with right-aligned points right before "ИТОГО: 20 баллов"
    let totalIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (TOTAL_LINE.test(lines[i]) || /^\s{10,}(ИТОГО|Итого|Всего)\b/i.test(lines[i])) { totalIdx = i; break; }
    if (totalIdx > 0) {
      const colItem = new RegExp(String.raw`^\s{0,6}1(?:[.)]\s*|\s+)[^\d\s].*\s(${NUM})\s*(${POINT_WORD})\s*$`, "i");
      for (let i = totalIdx - 1; i >= Math.max(0, totalIdx - 80); i--) {
        if (colItem.test(lines[i])) {
          start = i - 1;
          break;
        }
      }
    }
    if (start < 0) return { solution: body, scheme: [], total };
  }
  const schemeLines = lines.slice(start + 1);
  const items = [];
  let cur = null;
  let expected = 1;
  for (const line of schemeLines) {
    const m = line.match(/^\s{0,10}(?:(\d{1,2})\.(\d{1,2})\.?\s+|(\d{1,2})(?:[.)]\s*|\s+))([^\d\s.,].*)$/);
    const k = m ? Number(m[2] || m[3]) : null;
    if (m && k === expected) {
      cur = { k, lines: [m[4].replace(/^\s+/, "")] };
      items.push(cur);
      expected++;
      continue;
    }
    if (TOTAL_LINE.test(line)) {
      cur = null;
      continue;
    }
    if (cur && line.trim()) cur.lines.push(line.replace(/^\s+/, ""));
  }
  const pointsRe = new RegExp(String.raw`(${NUM})\s*${POINT_WORD}\s*$`, "i");
  const colRe = new RegExp(String.raw`\s{3,}(${NUM})\s*(?:${POINT_WORD})?\s*$`, "i");
  const scheme = items.map((it) => {
    let points = null;
    // Prefer a right-aligned column value on any line of the item
    for (const l of it.lines) {
      const c = (" " + l).match(colRe);
      if (c) {
        points = num(c[1]);
        break;
      }
    }
    if (points == null) {
      const first = it.lines[0];
      const m = first.match(pointsRe);
      if (m && !/по\s*$/i.test(first.slice(0, m.index))) points = num(m[1]);
    }
    return { k: it.k, text: it.lines.map((l) => l.replace(/\s{3,}/g, "   ")).join("\n"), points };
  });
  return { solution: lines.slice(0, start).join("\n"), scheme, total };
}

/** Split a solution text into numbered answer blocks k = 1..n (same numbering as the questions). */
function splitSolutionByItems(body, taskNumber) {
  const lines = body.split("\n");
  const style = listStyle(lines, taskNumber);
  const blocks = new Map();
  let current = null;
  let expected = 1;
  for (const line of lines) {
    const m = line.match(QUESTION_LINE);
    if (m) {
      const isDotted = m[1] != null;
      const k = isDotted ? Number(m[2]) : Number(m[3]);
      const okTask = !isDotted || taskNumber == null || Number(m[1]) === taskNumber;
      if (okTask && styleOk(m, style) && (k === expected || (isDotted && blocks.has(k)))) {
        current = { k, lines: [line.trim()] };
        const prev = blocks.get(k);
        if (!prev || prev.lines.join("").length < 40) blocks.set(k, current);
        else prev.lines.push(...current.lines), (current = prev);
        if (k === expected) expected++;
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  const out = new Map();
  for (const [k, b] of blocks) out.set(k, collapseBlankLines(b.lines.join("\n")));
  return out;
}

/** Points written inside a solution block: last "всего X баллов", else a single "(X балла)" mark, else the sum of marks. */
function pointsFromReference(ref) {
  if (!ref) return null;
  const all = [...ref.matchAll(new RegExp(String.raw`(?:всего|итого|барлығы|total)\s*[:\-–]?\s*(${NUM})\s*${POINT_WORD}`, "gi"))];
  if (all.length) return num(all[all.length - 1][1]);
  const marks = [...ref.matchAll(new RegExp(String.raw`(^|[^а-яёa-z])(по\s+)?(${NUM})\s*${POINT_WORD}(?![а-яё])`, "gi"))].filter((m) => !m[2]);
  if (!marks.length) return null;
  const sum = marks.reduce((acc, m) => acc + num(m[3]), 0);
  return Math.round(sum * 100) / 100;
}

function findSolutionTask(solTasks, task, idx, count) {
  return (
    solTasks.find((s) => s.key === task.key) ||
    (!/-/.test(task.key) && solTasks.find((s) => s.number === task.number)) ||
    (solTasks.length === count ? solTasks[idx] : null)
  );
}

/**
 * Build structured task list.
 * @param {string} tasksText text of the tasks PDF
 * @param {string} [solText] text of the solutions PDF
 */
/** Whole document as one task (practical rounds: a single "Задание" without a number) */
function wholeDocumentTask(text, isSolution) {
  const cleaned = stripRepeatedLines(text);
  if (cleaned.replace(/\s/g, "").length < 200) return [];
  const lines = cleaned.split("\n");
  const startRe = isSolution ? /^\s*(Решени[ея]|Система оценивания|Критерии|Шешуі|Жауабы|Solution)/i : /^\s*(Задание|Задача|Тапсырма|Есеп|Экспериментальн|Практическ|Problem|Task)/i;
  let start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) start = 0;
  const titleLine = (lines[start] || "").trim();
  return [{ number: 1, key: "1", title: /^(Задание|Задача|Тапсырма|Есеп)\s*$/i.test(titleLine) || !titleLine ? "Экспериментальное задание" : titleLine.slice(0, 80), total: null, body: lines.slice(start + 1).join("\n"), whole: true }];
}

function parseOlympiad(tasksText, solText = "") {
  let rawTasks = splitTasks(tasksText);
  let solTasks = solText ? splitTasks(solText) : [];
  if (!rawTasks.length && solText) {
    rawTasks = wholeDocumentTask(tasksText, false);
    if (rawTasks.length && solTasks.length !== 1) solTasks = wholeDocumentTask(solText, true);
  }

  return rawTasks.map((t, tIdx) => {
    const localNo = Number(String(t.key || t.number).split("-").pop());
    const table = parsePointsTable(t.body, localNo);
    const qItems = parseQuestionItems(table.rest, localNo);
    const sol = findSolutionTask(solTasks, t, tIdx, rawTasks.length);
    const solTable = sol ? parsePointsTable(sol.body, localNo) : { rest: "", parts: [] };
    const graded = sol ? parseGradingScheme(solTable.rest) : { solution: "", scheme: [], total: null };
    const markerParts = sol
      ? parseSolutionParts(graded.solution)
          .filter((p) => p.id.startsWith(`${localNo}.`))
          .map((p) => ({ ...p, id: `${t.number}.${p.id.split(".")[1]}` }))
      : [];
    const solBlocks = sol && !markerParts.length ? splitSolutionByItems(graded.solution, localNo) : new Map();
    const fullSolution = sol ? collapseBlankLines(graded.solution) : "";

    // Part ids: markers in solutions → points table (tasks or solutions) → numbered questions → grading scheme → single part
    const tableParts = table.parts.length ? table.parts : solTable.parts || [];
    let ids = markerParts.map((p) => p.id);
    if (!ids.length) ids = tableParts.map((p) => `${t.number}.${p.id.split(".")[1]}`);
    if (!ids.length && qItems.length > 1) ids = qItems.map((q) => `${t.number}.${q.k}`);
    if (!ids.length && graded.scheme.length > 1) ids = graded.scheme.map((s) => `${t.number}.${s.k}`);
    if (!ids.length) ids = [`${t.number}.1`];

    const strongTotal = table.total ?? solTable.total ?? t.total ?? sol?.total ?? null;
    let total = strongTotal ?? graded.total ?? null;
    const singlePart = ids.length === 1;
    let parts = ids.map((id, idx) => {
      const k = Number(id.split(".")[1]);
      const mp = markerParts.find((p) => p.id === id);
      const tp = tableParts.find((p) => p.id.split(".")[1] === id.split(".")[1]);
      const q = qItems.find((x) => x.k === k) || (qItems.length === ids.length ? qItems[idx] : null);
      const sc = graded.scheme.find((x) => x.k === k);
      const block = mp?.reference || solBlocks.get(k) || "";
      let points = tp?.points ?? mp?.points ?? sc?.points ?? q?.points ?? (singlePart ? null : table.perItem ?? solTable.perItem) ?? null;
      if (points == null && singlePart) points = total;
      if (points == null && !singlePart && block) {
        const fromText = pointsFromReference(block);
        if (fromText != null && fromText > 0 && (total == null || fromText < total)) points = fromText;
      }

      let reference = block;
      // No separate block for this part: the whole task solution is the reference (stored once in task.solution)
      const useTaskSolution = !reference && Boolean(fullSolution) && !singlePart;
      if (!reference && fullSolution && singlePart) reference = fullSolution;
      if (sc?.text) reference = `${reference}\n\nКритерии оценивания пункта (из схемы жюри):\n${sc.text}`.trim();

      let question = q?.text || "";
      if (!question && singlePart) question = "Решите задачу полностью и запишите ответ.";
      const part = { id, points, question, reference };
      if (useTaskSolution) part.useTaskSolution = true;
      return part;
    });

    // Parts without official points get an estimate, always marked pointsEstimated:
    //  – task total known → the remainder is split between them;
    //  – otherwise → the average of the task's known parts; a lone part → points written in the solution; else 10.
    const missing = parts.filter((p) => p.points == null);
    if (missing.length) {
      const known = parts.filter((p) => p.points != null);
      const knownSum = known.reduce((s, p) => s + p.points, 0);
      const rest = total != null ? total - knownSum : 0;
      let each;
      if (total != null && rest > 0) each = rest / missing.length;
      else if (known.length) each = knownSum / known.length;
      else if (singlePart) each = pointsFromReference(fullSolution) || 10;
      else each = Math.max(1, Math.round((10 / parts.length) * 2) / 2);
      const rounded = Math.max(0.5, Math.round(each * 2) / 2);
      missing.forEach((p, i) => {
        p.points = total != null && rest > 0 && i === missing.length - 1 ? Math.max(0.5, Math.round((rest - rounded * (missing.length - 1)) * 100) / 100) : rounded;
        p.pointsEstimated = true;
      });
    }

    // Weak total (from the solution text) that contradicts complete official part points → trust the parts
    const official = parts.every((p) => p.points != null && !p.pointsEstimated);
    if (strongTotal == null && official) total = Math.round(parts.reduce((s, p) => s + p.points, 0) * 100) / 100;

    const sum = parts.every((p) => p.points != null) ? Math.round(parts.reduce((s, p) => s + p.points, 0) * 100) / 100 : null;
    const out = {
      number: t.number,
      title: t.title || `Задача №${t.number}`,
      weight: table.weight ?? solTable.weight ?? null,
      total: total ?? sum,
      statement: collapseBlankLines(table.rest),
      parts,
    };
    if (parts.some((p) => p.useTaskSolution)) out.solution = fullSolution;
    return out;
  });
}

/** Quick quality report used by scripts/build-tasks.js */
function qualityReport(tasks) {
  const parts = tasks.flatMap((t) => t.parts);
  return {
    tasks: tasks.length,
    parts: parts.length,
    withPoints: parts.filter((p) => p.points != null).length,
    withReference: parts.filter((p) => (p.reference && p.reference.length > 20) || p.useTaskSolution).length,
    withQuestion: parts.filter((p) => p.question).length,
    estimatedPoints: parts.filter((p) => p.pointsEstimated).length,
  };
}

module.exports = {
  normalizeText,
  matchTaskHeader,
  stripRepeatedLines,
  splitTasks,
  parsePointsTable,
  parseQuestions,
  parseQuestionItems,
  parseSolutionParts,
  parseGradingScheme,
  splitSolutionByItems,
  parseOlympiad,
  qualityReport,
};
