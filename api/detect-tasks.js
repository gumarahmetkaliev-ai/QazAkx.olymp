/**
 * Endpoint to Extract PDF and Detect Tasks with Solution Mapping
 * POST /api/detect-tasks
 */

const fs = require("fs");
const path = require("path");
const { detectTasks } = require("./task-detector");
const { extractPdfText, safeOlympiadPath } = require("./extract-tasks");

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

/**
 * Attempt to locate a matching solutions PDF in the same directory
 */
function findMatchingSolutionFile(taskFilePath) {
  const dir = path.dirname(taskFilePath);
  const base = path.basename(taskFilePath);

  // Common naming conventions:
  // tasks -> sol, tasks -> solutions, zadachi -> resheniya, zad -> resh
  const candidates = [
    base.replace(/tasks/i, "sol"),
    base.replace(/tasks/i, "solutions"),
    base.replace(/task/i, "sol"),
    base.replace(/zadachi/i, "resheniya"),
    base.replace(/zad/i, "resh"),
    base.replace(/-tasks/i, "-sol"),
    base.replace(/_tasks/i, "_sol"),
    base.replace(/tasks-/i, "sol-"),
  ];

  for (const cand of candidates) {
    if (cand !== base) {
      const fullCandPath = path.join(dir, cand);
      if (fs.existsSync(fullCandPath)) {
        return fullCandPath;
      }
    }
  }

  // Also check all files in directory for matching solution
  try {
    const files = fs.readdirSync(dir);
    const solFile = files.find((f) => {
      if (f === base) return false;
      if (!/\.pdf$/i.test(f)) return false;
      const cleanBase = base.replace(/tasks|task|zad/i, "").toLowerCase();
      const cleanF = f.replace(/solutions|solution|sol|resh/i, "").toLowerCase();
      return /sol|solution|resh/i.test(f) && cleanBase === cleanF;
    });
    if (solFile) {
      return path.join(dir, solFile);
    }
  } catch {}

  return null;
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
    return res.end(JSON.stringify({ success: false, error: "POST only" }));
  }

  try {
    const body = await getBody(req);
    const resolvedPath = safeOlympiadPath(body.file);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({ success: false, error: "FILE_NOT_FOUND", message: "PDF file not found or forbidden" })
      );
    }

    // 1. Extract Task PDF
    const { text, pages } = await extractPdfText(resolvedPath);
    const detection = detectTasks(text);

    // 2. Try to locate and parse matching Solution PDF
    let solutionsMapped = false;
    let solutionFilePath = null;
    const solPath = findMatchingSolutionFile(resolvedPath);

    if (solPath && fs.existsSync(solPath)) {
      try {
        const solExtracted = await extractPdfText(solPath);
        const solDetection = detectTasks(solExtracted.text || "");

        if (solDetection.success && solDetection.tasks.length > 0) {
          const solMap = new Map();
          solDetection.tasks.forEach((st) => {
            if (st.text && st.text.trim().length > 20) {
              solMap.set(st.number, st.text);
            }
          });

          let mappedCount = 0;
          detection.tasks.forEach((t) => {
            if (solMap.has(t.number)) {
              t.officialSolution = solMap.get(t.number);
              t.hasOfficialSolution = true;
              mappedCount++;
            } else {
              t.officialSolution = null;
              t.hasOfficialSolution = false;
            }
          });

          if (mappedCount > 0) {
            solutionsMapped = true;
            solutionFilePath = solPath;
          }
        }
      } catch (solErr) {
        console.warn("Could not map solution file:", solErr.message);
      }
    }

    // If no solutions mapped, ensure all tasks have officialSolution = null
    if (!solutionsMapped) {
      detection.tasks.forEach((t) => {
        t.officialSolution = null;
        t.hasOfficialSolution = false;
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        file: body.file,
        solutionsMapped,
        pages,
        ...detection,
      })
    );
  } catch (err) {
    console.error("Detection error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ success: false, error: "INTERNAL_ERROR", message: "Error during task detection" })
    );
  }
};
