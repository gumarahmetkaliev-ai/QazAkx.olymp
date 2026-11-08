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
