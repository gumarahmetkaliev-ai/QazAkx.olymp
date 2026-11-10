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
      if (raw.length > 600000) req.destroy();
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
    // Служебный режим для scripts/build-tasks.js --ai=prod: разбор комплекта ключом Gemini с сервера.
    // Доступен только с секретом ADMIN_TOKEN (переменная окружения Vercel).
    if (body.mode === "structure") {
      const token = process.env.ADMIN_TOKEN;
      if (!token || req.headers["x-admin-token"] !== token) return send(res, 403, { success: false, error: "FORBIDDEN" });
      const { callGemini, callOmniRoute, getApiKeys } = require("./_lib/ai-service");
      const keys = getApiKeys();
      const errors = [];
      // 1) OmniRoute — лучшие модели по очереди (если туннель включён)
      if (keys.omniRouteKey && keys.omniRouteEndpoint && body.provider !== "gemini") {
        try {
          const r = await callOmniRoute(keys.omniRouteKey, String(body.system || ""), String(body.prompt || ""), null, 32000, {
            json: true,
            timeoutMs: 200000,
            totalTimeoutMs: 230000,
            models: process.env.OMNIROUTE_PARSE_MODELS ? process.env.OMNIROUTE_PARSE_MODELS.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
          });
          return send(res, 200, { success: true, text: r.text, model: `omniroute:${r.model}` });
        } catch (err) {
          errors.push(String(err.message).slice(0, 600));
          if (body.provider === "omniroute") return send(res, 502, { success: false, error: errors.join(" | ") });
        }
      }
      const key = keys.geminiKey;
      if (!key) return send(res, 503, { success: false, error: "NO_GEMINI_KEY " + errors.join(" | ") });
      try {
        const r = await callGemini(key, String(body.system || ""), String(body.prompt || ""), body.model || null, {
          models: Array.isArray(body.models) ? body.models : undefined,
          maxOutputTokens: Number(body.maxOutputTokens) || 65536,
          json: true,
          timeoutMs: 280000,
        });
        return send(res, 200, { success: true, text: r.text, model: r.model });
      } catch (err) {
        return send(res, 502, { success: false, error: String(err.message).slice(0, 1500) });
      }
    }
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
