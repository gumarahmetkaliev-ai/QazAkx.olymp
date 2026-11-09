// npm run test:jury [номер задачи] [вариант] — прогон ИИ-жюри по тестовым ответам (нужен ключ OmniRoute/OpenRouter в .env).
// Ожидаемые баллы (expected) — как поставило бы жюри по официальной схеме.
const path = require("path");
process.chdir(path.join(__dirname, "..", ".."));
const fs = require("fs");
const { gradeTask } = require("../../lib/jury.js");
const cases = require("./cases.js");
const onlyCase = process.argv[2] != null && process.argv[2] !== "all" ? Number(process.argv[2]) : null;
const onlyVar = process.argv[3] || null;
const OUT = path.join(require("os").tmpdir(), "qazakx-jury-results.json");
const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

(async () => {
  for (const [ci, c] of cases.entries()) {
    if (onlyCase != null && ci !== onlyCase) continue;
    for (const [vname, v] of Object.entries(c.variants)) {
      if (onlyVar && vname !== onlyVar) continue;
      const t0 = Date.now();
      const r = await gradeTask({ setId: c.setId, taskNumber: c.task, answers: v.answers, lang: c.lang });
      const key = `${ci}:${vname}`;
      if (!r.success) {
        console.log(key, "ОШИБКА", r.error, r.message);
        results[key] = { error: r.message };
        continue;
      }
      const s = r.result.score;
      const ok = s >= v.expected[0] && s <= v.expected[1];
      results[key] = { setId: c.setId, task: c.task, variant: vname, score: s, max: r.result.max, expected: v.expected, ok, provider: r.provider, parts: r.result.parts.map((p) => ({ id: p.id, score: p.score, max: p.max, feedback: p.feedback })), summary: r.result.summary, sec: Math.round((Date.now() - t0) / 1000) };
      console.log(`${ok ? "✓" : "✗"} ${key} ${c.setId}#${c.task} ${vname}: ${s}/${r.result.max} (ожидали ${v.expected.join("–")}) [${r.provider}, ${results[key].sec} с] ${r.result.parts.map((p) => p.id + "=" + p.score).join(" ")}`);
      fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    }
  }
})();
