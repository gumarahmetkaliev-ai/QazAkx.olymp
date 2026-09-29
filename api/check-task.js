/**
 * Endpoint to Check a Single Olympiad Task with AI
 * POST /api/check-task
 */

const { checkOlympiadTask } = require("./lib/ai-service");

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED", message: "Only POST allowed" }));
  }

  try {
    const body = await getBody(req);
    const { olympiad, task, answers, answer, language = "ru" } = body;

    if (!task) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          success: false,
          error: "MISSING_TASK",
          message: "Пожалуйста, выберите задачу для проверки.",
        })
      );
    }

    if (!answer && (!answers || Object.keys(answers).length === 0 || !Object.values(answers).some((v) => v && String(v).trim()))) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          success: false,
          error: "MISSING_ANSWER",
          message: "Пожалуйста, введите ответ хотя бы на один пункт задачи.",
        })
      );
    }

    const result = await checkOlympiadTask({
      olympiad,
      task,
      answers,
      answer,
      language,
    });

    res.statusCode = result.success ? 200 : 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("Check task error:", err.message);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message: "Ошибка сервера при проверке задачи. Пожалуйста, повторите попытку.",
      })
    );
  }
};
