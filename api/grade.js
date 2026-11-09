/**
 * POST /api/grade  { setId, taskNumber, answers: { "3.1": "...", "3.2": "..." }, lang }
 * ИИ-жюри: баллы по каждому пункту + комментарии + темы для видеоуроков.
 */
const { gradeTask } = require("../lib/jury");

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 200000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });
  try {
    const body = await readBody(req);
    const out = await gradeTask({
      setId: body.setId,
      taskNumber: body.taskNumber,
      answers: body.answers || {},
      lang: body.lang === "kz" ? "kz" : "ru",
    });
    if (!out.success) return send(res, out.status || 400, out);
    return send(res, 200, out);
  } catch (err) {
    console.error("grade error:", err);
    return send(res, 500, { success: false, error: "INTERNAL", message: "Ошибка проверки. Попробуйте ещё раз." });
  }
};
