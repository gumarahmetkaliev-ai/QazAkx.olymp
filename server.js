/**
 * Local Development Server for QazAkx.olymp
 * Serves static files and maps /api/* to serverless handlers.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// Load AI service & handlers
const aiHandler = require("./api/ai");
const chatHandler = require("./api/chat");
const checkSolutionHandler = require("./api/check-solution");
const extractTasksHandler = require("./api/extract-tasks");
const detectTasksHandler = require("./api/detect-tasks");
const checkTaskHandler = require("./api/check-task");
const { loadEnv, getAIHealth } = require("./api/lib/ai-service");

loadEnv();

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const rawPathname = String(req.url || "").split("?", 1)[0];
  let decodedRawPathname = rawPathname;
  try { decodedRawPathname = decodeURIComponent(rawPathname); } catch {}
  if (rawPathname.includes("..") || decodedRawPathname.includes("..") || rawPathname.includes("\\") || decodedRawPathname.includes("\\")) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(parsedUrl.pathname.replace(/\\/g, "/"));

  // Attach query params
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());

  // 1. API Route matching
  if (pathname === "/api/health" || (pathname === "/api/ai" && req.method === "GET")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify(getAIHealth()));
    return;
  }

  if (pathname === "/api/chat") {
    return chatHandler(req, res);
  }

  if (pathname === "/api/check-solution" || pathname === "/api/check") {
    return checkSolutionHandler(req, res);
  }

  if (pathname === "/api/ai") {
    return aiHandler(req, res);
  }

  if (pathname === "/api/extract-tasks") {
    return extractTasksHandler(req, res);
  }

  if (pathname === "/api/detect-tasks") {
    return detectTasksHandler(req, res);
  }

  if (pathname === "/api/check-task") {
    return checkTaskHandler(req, res);
  }

  // 2. Static File Serving
  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }

  let filePath;
  if (pathname === "/olympiads.json") {
    filePath = path.join(ROOT_DIR, "olympiads.json");
  } else if (pathname.startsWith("/olympiads/")) {
    const relative = pathname.replace(/^\/+/, "");
    if (relative.includes("..") || path.normalize(relative).includes("..") || !relative.startsWith("olympiads/")) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    filePath = path.join(PUBLIC_DIR, relative);
  } else {
    filePath = path.join(ROOT_DIR, pathname);
  }

  const resolvedPath = path.resolve(filePath);
  const allowedRoot = pathname.startsWith("/olympiads/") ? PUBLIC_DIR : ROOT_DIR;
  if (resolvedPath !== allowedRoot && !resolvedPath.startsWith(allowedRoot + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback for clean URLs or 404
      const htmlPath = resolvedPath + ".html";
      if (fs.existsSync(htmlPath)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        fs.createReadStream(htmlPath).pipe(res);
        return;
      }

      // Check index.html fallback for SPA/client routing
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<h1>404 Not Found</h1><p>The requested file <code>${pathname}</code> was not found.</p><p><a href="/">Go to Home</a></p>`);
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    if (ext === ".pdf") {
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    fs.createReadStream(resolvedPath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🧪 QazAkx.olymp server running at: http://localhost:${PORT}`);
    const health = getAIHealth();
    console.log(`🤖 AI Status: ${health.configured ? "✓ Configured" : "⚠ API Key Not Set (create .env with GEMINI_API_KEY)"}`);
    console.log(`==============================================\n`);
  });
}

module.exports = server;
