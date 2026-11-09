/**
 * GET /api/task-set?id=<setId>  → задачи и пункты комплекта (без эталонных решений)
 */
const { loadSet, publicSet } = require("../lib/jury");

module.exports = async function handler(req, res) {
  const params = req.query || Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  const set = loadSet(String(params.id || ""));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!set) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ success: false, error: "SET_NOT_FOUND" }));
  }
  res.statusCode = 200;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(JSON.stringify({ success: true, set: publicSet(set) }));
};
