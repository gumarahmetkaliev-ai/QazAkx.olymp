/**
 * Chemistry Olympiad Solution Checker API Endpoint
 */

const { checkChemistrySolution } = require("./lib/ai-service");

async function getParsedBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED" }));
    return;
  }

  try {
    const body = await getParsedBody(req);
    const result = await checkChemistrySolution({
      problem: body.problem,
      solution: body.solution,
      mode: body.mode || "analyze",
      language: body.language || "ru",
      grade: body.grade,
      topic: body.topic,
      question: body.question,
    });

    res.statusCode = result.success ? 200 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("Solution checker handler error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message: error.message || "Ошибка сервера при проверке олимпиадного решения.",
      }),
    );
  }
};
