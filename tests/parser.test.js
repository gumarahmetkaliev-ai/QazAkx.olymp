/* Регрессионный тест парсера и каталога на реальном комплекте (Республиканская 2024, 9 класс) */
const assert = require("assert");
const { loadSet } = require("../lib/jury");
const { classifyFile, buildOlympiad } = require("../lib/chem-catalog");

const set = loadSet("chem-national-2024-9--chem9-1-tasks-rus");
assert(set, "комплект собран");
assert.strictEqual(set.tasks.length, 7);
const t3 = set.tasks.find((t) => t.number === 3);
assert.deepStrictEqual(t3.parts.map((p) => [p.id, p.points]), [["3.1", 26], ["3.2", 22], ["3.3", 2]]);
assert(t3.parts.every((p) => p.reference.length > 50), "у каждого пункта есть эталон");

assert.strictEqual(classifyFile("chem10-1-sol_kaz.pdf").kind, "sol");
assert.strictEqual(classifyFile("chem10-1-sol_kaz.pdf").lang, "kz");
const o = buildOlympiad("https://olympiads.bc-pf.org/chemistry/oblast/2023/10", ["chem10-1-tasks.pdf", "chem10-1-sol.pdf", "chem10-2-tasks.pdf"]);
assert.strictEqual(o.materials[0].label, "1 тур (Задачи)");
assert.strictEqual(o.materials[0].solutionId, "chem10-1-sol");
assert.strictEqual(o.materials.find((m) => m.title === "chem10-2-tasks.pdf").label, "2 тур (Практика)");
console.log("parser/catalog tests: OK");

// ── Форматы, добавленные при разборе всего архива (синтетические фрагменты в стиле реальных PDF)
const { parseOlympiad, matchTaskHeader } = require("../lib/task-parser");

// Казахский комплект: «№2 Есеп.», «Барлығы / Үлесі(%)», решения «2.1 (8 ұпай)»
{
  const tasks = `№2 Есеп. Интерметаллидтер\n 2.1        2.2        Барлығы     Үлесі(%)\n 8          2          10          12\n\n   Мәтін.\n  1. Барлық белгісіз заттарды анықтаңыз.\n  2. Сапалық реакцияны атаңыз.\n`;
  const sol = `№2 Есеп. Интерметаллидтер\n 2.1 (8 ұпай)\n Z — магний (2 ұпай). Y — мыс (1 ұпай).\n 2.2 (2 ұпай)\n Сілті қосқанда Al(OH)3 тұнбасы түзіледі (1 ұпай).\n`;
  const [t] = parseOlympiad(tasks, sol);
  assert.strictEqual(t.number, 2);
  assert.strictEqual(t.weight, 12);
  assert.deepStrictEqual(t.parts.map((p) => [p.id, p.points]), [["2.1", 8], ["2.2", 2]]);
  assert(t.parts[0].reference.includes("магний"));
}

// Всеросс: задачи 9-1 и 10-1 в одном файле, «Решение задачи 9-1», система оценивания без заголовка
{
  const tasks = `    Задача 9-1\n Текст.\n    1. Определите X.\n    2. Напишите уравнения.\n    Задача 10-1\n Текст.\n    1. Определите Y.\n`;
  const sol = `    Решение задачи 9-1 (автор: Иванов И.И.)\n    1. X — NaCl.\n    2. Уравнения.\n1 Определение X с расчётом                          4 балла\n2 Уравнения реакций по 1 баллу                     6 баллов\n                                              ИТОГО: 10 баллов\n    Решение задачи 10-1 (автор: Петров П.П.)\n    1. Y — KCl, расчёт.\n`;
  const out = parseOlympiad(tasks, sol);
  assert.strictEqual(out.length, 2);
  assert(out[0].title.startsWith("9-1"));
  assert.strictEqual(out[0].total, 10);
  assert.deepStrictEqual(out[0].parts.map((p) => [p.id, p.points]), [["1.1", 4], ["1.2", 6]]);
  assert(out[1].title.startsWith("10-1"));
}

// Заголовки разных форматов
assert.strictEqual(matchTaskHeader("Задача 1 (7 баллов)").total, 7);
assert.strictEqual(matchTaskHeader("№9-3-2006 обл. Имеется 3,15 г смеси серы и фосфора").number, 3);
assert.strictEqual(matchTaskHeader("                                     Q4-1").number, 4);
assert.strictEqual(matchTaskHeader("Задача №1. Олеум (10%)                    4"), null, "строка оглавления — не заголовок");

// Пункты без официальных баллов получают оценку из итога задачи и пометку pointsEstimated
{
  const [t] = parseOlympiad(`Задача 1 (10 баллов)\n Текст.\n  1. Вопрос один.\n  2. Вопрос два.\n`, `Задача 1 (10 баллов)\n  1. Ответ один подробно.\n  2. Ответ два подробно.\n`);
  assert.deepStrictEqual(t.parts.map((p) => [p.points, Boolean(p.pointsEstimated)]), [[5, true], [5, true]]);
}
console.log("format tests: OK");

// Страховка регламента: голые ответы без хода решения
{
  const { isBareAnswer } = require("../lib/jury");
  assert(isBareAnswer("89,11%; 9,77% и 90,23%; 328,77 г; 58,5%"));
  assert(isBareAnswer("0,7 моль"));
  assert(!isBareAnswer("n(KOH) = 39,2/56 = 0,7 моль"));
  assert(!isBareAnswer("2KOH + H2SO4 → K2SO4 + 2H2O"));
  console.log("jury guard tests: OK");
}

// Прогресс в стиле Codeforces
{
  const P = require("../public/js/progress.js");
  const DAY = 86400000;
  const now = new Date(2026, 10, 9, 15).getTime();
  const at = (daysAgo) => now - daysAgo * DAY;
  const data = {
    setA: {
      1: { history: [{ at: at(10), score: 2, max: 10 }, { at: at(9), score: 10, max: 10 }] }, // решена 9 дней назад
      2: { history: [{ at: at(1), score: 7, max: 10 }] }, // почти
      3: { history: [{ at: at(0), score: 0, max: 5 }] }, // ноль
    },
    setB: {
      1: { result: { score: 1, max: 4, percent: 25 }, checkedAt: at(400) }, // старая запись без history
      2: { answers: { "2.1": "черновик" } }, // не проверялась
    },
  };
  assert.strictEqual(P.level(100), "solved");
  assert.strictEqual(P.level(70), "strong");
  assert.strictEqual(P.level(1), "partial");
  assert.strictEqual(P.level(0), "zero");
  const s = P.summarize(data, now);
  assert.deepStrictEqual(s.byLevel, { solved: 1, strong: 1, partial: 1, zero: 1 });
  assert.strictEqual(s.solvedTotal, 1);
  assert.strictEqual(s.solvedMonth, 1);
  assert.strictEqual(s.totalChecks, 5);
  assert.strictEqual(s.streak.current, 2, "сегодня и вчера");
  assert.strictEqual(s.streak.max, 2);
  const tl = P.scoreTimeline(data);
  assert.strictEqual(tl[tl.length - 1].total, 1 + 10 + 7, "сумма лучших баллов");
  const grid = P.yearGrid(2026, s.activity);
  const cells = grid.weeks.flat().filter(Boolean);
  assert.strictEqual(cells.length, 365);
  assert.strictEqual(cells.find((c) => c.key === P.dayKey(at(9))).solved, 1);
  console.log("progress tests: OK");
}
