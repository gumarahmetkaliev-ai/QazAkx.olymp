/**
 * Парсер тестовых туров (биология и др.): вопросы с вариантами ответа + ключ из PDF «решений».
 *
 *   1. Что из перечисленного ниже относится к категории "стероидов"?
 *   A) фосфолипид
 *   B) глицерин ...
 *
 * Ключ: «1 D», «1. D», «1) A, C», «1 – Б», в несколько колонок в строке.
 * Проверка — детерминированная, без ИИ (lib/test-grader.js).
 */

const { classifyBio } = require("./bio-topics");

const LETTERS_LAT = "ABCDEFGH";
const CYR_TO_LAT = { А: "A", Б: "B", В: "C", Г: "D", Д: "E", Е: "F", а: "A", б: "B", в: "C", г: "D", д: "E", е: "F" };

/** Буква варианта → латиница A..H (А→A, Б→B, В→C, Г→D …; латинские a–h → A–H) */
function normLetter(ch) {
  if (CYR_TO_LAT[ch]) return CYR_TO_LAT[ch];
  const up = String(ch).toUpperCase();
  return LETTERS_LAT.includes(up) ? up : null;
}

function cleanLines(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/ /g, " ")
    .split("\n");
}

const Q_LINE = /^\s{0,8}(\d{1,3})\s*[.)]\s+(\S.*)$/;
const OPT_LINE = /^\s{0,12}\(?([A-Ha-hА-Еа-е])\s*[).]\s+(\S.*)$/;

/**
 * Вопросы теста: номер, текст, варианты. Номера идут по порядку (1, 2, 3 …) — это отсекает
 * нумерованные списки внутри вопросов («i) …», «1) …» внутри условия).
 */
function parseTestQuestions(tasksText) {
  const lines = cleanLines(tasksText);
  const questions = [];
  let cur = null;
  let expected = 1;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const q = line.match(Q_LINE);
    const n = q ? Number(q[1]) : 0;
    // следующий номер; допускаем пропуск 1–2 вопросов (вопрос целиком картинкой и т.п.)
    if (q && n >= expected && n <= expected + 2 && (n === expected || /^\s{0,3}\d/.test(line))) {
      for (let miss = expected; miss < n; miss++) questions.push({ n: miss, text: "", options: [], missing: true });
      cur = { n, text: q[2].trim(), options: [] };
      questions.push(cur);
      expected = n + 1;
      continue;
    }
    if (!cur) continue;
    const o = line.match(OPT_LINE);
    if (o) {
      const key = normLetter(o[1]);
      // варианты идут по алфавиту: A, B, C … (иначе это не вариант, а текст)
      if (key && key === LETTERS_LAT[cur.options.length]) {
        cur.options.push({ key, text: o[2].trim() });
        continue;
      }
    }
    if (line.trim()) {
      if (cur.options.length) cur.options[cur.options.length - 1].text += " " + line.trim();
      else cur.text += " " + line.trim();
    }
  }
  for (const q of questions) {
    q.text = q.text.replace(/\s+/g, " ").replace(/(\S)- (\S)/g, "$1$2").trim();
    for (const o of q.options) o.text = o.text.replace(/\s+/g, " ").trim();
    // варианты-картинки в две колонки («a)   d)») — текста у вариантов нет, показываем только буквы
    if (q.options.some((o) => /^[A-Ha-hА-Еа-е]\)?\s*[A-Ha-hА-Еа-е]?\)?$/.test(o.text) || !o.text)) q.options = [];
  }
  return questions;
}

/**
 * Ключ ответов: { [номер]: "D" | "AC" }. Берём все пары «номер буква(ы)» в тексте решений.
 * Колонки «1 D   21 C   41 A» тоже разбираются.
 */
function parseAnswerKey(solText) {
  const key = {};
  // Таблица: строка номеров «1 2 3 … 10», под ней строка букв «C B A …»
  const lines = cleanLines(solText).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i + 1 < lines.length; i++) {
    const nums = lines[i].split(/\s+/);
    if (nums.length < 4 || !nums.every((x) => /^\d{1,3}$/.test(x))) continue;
    const letters = lines[i + 1].split(/\s+/);
    if (letters.length !== nums.length || !letters.every((x) => /^[A-Ha-hА-Еа-е]{1,3}$/.test(x))) continue;
    nums.forEach((n, j) => {
      const v = letters[j].split("").map(normLetter).filter(Boolean);
      if (v.length && key[Number(n)] == null) key[Number(n)] = [...new Set(v)].sort().join("");
    });
    i++;
  }
  // «1 D», «1. D», «1.A», «1) A, C», «1 – Б»
  const re = /(?:^|\s)(\d{1,3})(?:\s*[.)\-–:]\s*|\s+)([A-Ha-hА-Еа-е](?:\s*[,;+]\s*[A-Ha-hА-Еа-е])*)(?=\s|$)/g;
  for (const raw of cleanLines(solText)) {
    const line = raw.replace(/\s+$/, "");
    // строка ключа: короткая, без длинных слов
    if (/[A-Za-zА-Яа-яЁё]{3,}/.test(line.replace(/\b(Ответ|Ответы|Жауап|Answer|Key|Вопрос|№)\b/gi, ""))) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const n = Number(m[1]);
      const letters = m[2]
        .split(/[\s,;+]+/)
        .map(normLetter)
        .filter(Boolean);
      if (n >= 1 && n <= 300 && letters.length && key[n] == null) key[n] = [...new Set(letters)].sort().join("");
    }
  }
  return key;
}

/** Баллы за вопрос из шапки: «оценивается в 1 балл» */
function pointsPerQuestion(tasksText) {
  const m = String(tasksText).match(/оценива\S*\s+в\s+(\d+(?:[.,]\d+)?)\s*балл/i) || String(tasksText).match(/(\d+(?:[.,]\d+)?)\s*(?:балл|ұпай|point)\S*\s+(?:за|for)\s+(?:каждый|each)/i);
  return m ? Number(m[1].replace(",", ".")) : 1;
}

/**
 * Тестовый комплект или null, если это не тест.
 * Тест — если найдено ≥ 10 вопросов и для ≥ 80% из них есть ответ в ключе.
 */
function parseTestSet(tasksText, solText) {
  const questions = parseTestQuestions(tasksText);
  const key = parseAnswerKey(solText);
  if (questions.length < 10) return null;
  // хвост без ключа (например, лишний нумерованный список в конце) отрезаем
  while (questions.length && !key[questions[questions.length - 1].n]) questions.pop();
  const withKey = questions.filter((q) => key[q.n]);
  if (withKey.length < Math.max(10, Math.ceil(questions.length * 0.8))) return null;
  const points = pointsPerQuestion(tasksText);
  return {
    type: "test",
    pointsPerQuestion: points,
    questions: questions.map((q) => ({
      n: q.n,
      text: q.missing ? "Условие этого вопроса — в PDF (рисунок или таблица)." : q.text,
      options: q.options,
      // если варианты не распознались (картинки) — показываем кнопки A–D/E по ключу
      choices: q.options.length >= 2 ? q.options.map((o) => o.key) : LETTERS_LAT.slice(0, Math.max(5, ...(key[q.n] || "A").split("").map((l) => LETTERS_LAT.indexOf(l) + 1))).split(""),
      multi: (key[q.n] || "").length > 1,
      answer: key[q.n] || null,
      points,
    })),
  };
}

/** Тест → «задачи» по 10 вопросов: каждая задача — блок, каждый вопрос — пункт с выбором варианта */
function testToTasks(test, blockSize = 10) {
  const tasks = [];
  for (let i = 0; i < test.questions.length; i += blockSize) {
    const block = test.questions.slice(i, i + blockSize);
    const number = tasks.length + 1;
    tasks.push({
      number,
      title: `Тест: вопросы ${block[0].n}–${block[block.length - 1].n}`,
      weight: null,
      total: block.reduce((s, q) => s + q.points, 0),
      statement: "",
      kind: "test",
      parts: block.map((q) => ({
        id: `q${q.n}`,
        kind: "choice",
        points: q.points,
        question: `${q.n}. ${q.text}`,
        options: q.options,
        choices: q.choices,
        multi: q.multi,
        answer: q.answer,
        topic: classifyBio(`${q.text} ${q.options.map((o) => o.text).join(" ")}`) || undefined,
        reference: `Правильный ответ: ${q.answer}`,
      })),
    });
  }
  return tasks;
}

module.exports = { testToTasks, normLetter, parseTestQuestions, parseAnswerKey, parseTestSet, pointsPerQuestion };
