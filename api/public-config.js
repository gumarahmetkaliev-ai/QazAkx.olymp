/**
 * Public non-secret frontend config.
 * Never returns service-role keys.
 */

const { loadEnv } = require("./lib/ai-service");
const { publicSupabaseConfig } = require("../lib/auth");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED" }));
  }

  loadEnv();
  const supabase = publicSupabaseConfig(process.env);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify({
      success: true,
      supabase: {
        configured: supabase.configured,
        url: supabase.url,
        publishableKey: supabase.publishableKey,
        redirectPath: supabase.redirectPath,
        resetPath: supabase.resetPath,
      },
    })
  );
};
