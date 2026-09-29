/**
 * PDF Text Extraction API Endpoint
 * POST /api/extract-tasks
 * Safely extracts and caches text from local olympiad PDFs
 */

const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

// Fast in-memory cache for extracted PDFs
const extractionCache = new Map();

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function getParsedBody(req) {
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
    req.on("data", (chunk) => {
      raw += chunk;
    });
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

function safeOlympiadPath(file) {
  if (!file || typeof file !== "string") return null;
  let cleaned = String(file).replace(/\\/g, "/").trim();
  if (cleaned.includes("..") || cleaned.includes("~")) return null;
  if (cleaned.startsWith("/")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("public/")) cleaned = cleaned.slice("public/".length);
  if (!cleaned.startsWith("olympiads/")) return null;
  if (!/\.pdf$/i.test(cleaned)) return null;
  const resolved = path.resolve(process.cwd(), "public", cleaned);
  const allowedBase = path.resolve(process.cwd(), "public", "olympiads");
  if (!resolved.startsWith(allowedBase + path.sep)) return null;
  return resolved;
}

async function extractPdfText(filePath) {
  if (extractionCache.has(filePath)) {
    return extractionCache.get(filePath);
  }

  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  await parser.destroy();

  const text = result.text || "";
  const pages = (Array.isArray(result.pages) ? result.pages.length : 0) || result.numpages || 0;

  const payload = { pages, text, textLength: text.length };
  extractionCache.set(filePath, payload);
  return payload;
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
    res.end(
      JSON.stringify({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Only POST allowed",
      }),
    );
    return;
  }

  try {
    const body = await getParsedBody(req);
    const { file } = body;

    if (!file) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: "MISSING_FILE",
          message: "Request must include 'file' parameter",
        }),
      );
      return;
    }

    const safePath = safeOlympiadPath(file);
    if (!safePath) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: "FORBIDDEN",
          message: "File path not allowed or invalid",
        }),
      );
      return;
    }

    if (!fs.existsSync(safePath)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: "FILE_NOT_FOUND",
          message: "PDF file not found",
        }),
      );
      return;
    }

    const extracted = await extractPdfText(safePath);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        pages: extracted.pages,
        textLength: extracted.textLength,
        text: extracted.text,
      }),
    );
  } catch (error) {
    console.error("PDF extraction error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "EXTRACTION_FAILED",
        message: "Failed to extract PDF text",
      }),
    );
  }
};

module.exports.extractPdfText = extractPdfText;
module.exports.safeOlympiadPath = safeOlympiadPath;
