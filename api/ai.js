/**
 * Unified AI API Endpoint for QazAkx.olymp
 * Handles /api/ai, health checks, chat requests, and solution checks.
 */

const {
  handleChat,
  checkChemistrySolution,
  getAIHealth,
} = require("./lib/ai-service");

// Helper to parse JSON body across different server environments
async function getParsedBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  // GET: Health / Status check
  if (req.method === "GET") {
    const health = getAIHealth();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(health));
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED", message: "Only POST and GET allowed" }));
    return;
  }

  try {
    const body = await getParsedBody(req);
    const action = body.action || req.query?.action || (body.problem ? "check_solution" : "chat");

    let result;
    if (action === "check_solution" || action === "check" || action === "solution") {
      result = await checkChemistrySolution({
        problem: body.problem,
        solution: body.solution,
        mode: body.mode || "analyze",
        language: body.language || "ru",
        grade: body.grade,
        topic: body.topic,
        question: body.question,
      });
    } else {
      result = await handleChat({
        message: body.message || body.prompt || body.text,
        history: body.history || [],
        language: body.language || "ru",
        grade: body.grade,
      });
    }

    res.statusCode = result.success ? 200 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("Handler error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message: error.message || "Произошла непредвиденная ошибка на сервере.",
      }),
    );
  }
};
