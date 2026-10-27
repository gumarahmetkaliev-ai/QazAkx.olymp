/**
 * PDF Proxy API Endpoint
 * GET /api/pdf-proxy?page=<sourcePage>&title=<filename>&download=1
 * Resolves CDN URL by scraping the olympiads.bc-pf.org source page,
 * then proxies the PDF to the client.
 * Memory-caches page->CDN URL mappings.
 */

const pageCache = new Map();
const CDN_ORIGIN = "https://cdn.bc-pf.org";
const PAGE_ORIGIN = "https://olympiads.bc-pf.org";
const CACHE_TTL_MS = 30 * 60 * 1000;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Disposition");
}

function isSafeSourcePage(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === PAGE_ORIGIN && !parsed.pathname.includes("..");
  } catch {
    return false;
  }
}

function isSafeCdnUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === CDN_ORIGIN && parsed.pathname.toLowerCase().endsWith(".pdf") && !parsed.pathname.includes("..");
  } catch {
    return false;
  }
}

async function fetchPagePdfLinks(pageUrl) {
  const cached = pageCache.get(pageUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.links;

  const response = await fetch(pageUrl, {
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "QazAkx-olymp/1.0 (educational platform)" },
  });
  if (!response.ok) throw new Error(`Page fetch failed: ${response.status}`);
  const html = await response.text();

  const links = new Map();
  const re = /href=["']([^"']*\.pdf[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      const abs = new URL(href, pageUrl).toString();
      if (isSafeCdnUrl(abs)) {
        const filename = abs.split("/").pop().split("?")[0];
        links.set(filename.toLowerCase(), abs);
      }
    } catch {}
  }
  pageCache.set(pageUrl, { links, ts: Date.now() });
  return links;
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const params = req.query || Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  const pageUrl = String(params.page || "").trim();
  const title = String(params.title || "").trim();
  const wantDownload = String(params.download || "0") === "1";

  if (!pageUrl || !title) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing required params: page, title" }));
    return;
  }

  if (!isSafeSourcePage(pageUrl)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid source page URL" }));
    return;
  }

  const safeTitle = title.replace(/[^a-zA-Z0-9._\-а-яА-ЯёЁ]/gu, "_");
  if (!safeTitle.toLowerCase().endsWith(".pdf")) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Title must be a PDF filename" }));
    return;
  }

  let cdnUrl;
  try {
    const links = await fetchPagePdfLinks(pageUrl);
    cdnUrl = links.get(title.toLowerCase());
    if (!cdnUrl) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `PDF '${title}' not found on source page` }));
      return;
    }
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `Could not load source page: ${err.message}` }));
    return;
  }

  try {
    const rangeHeader = req.headers && req.headers["range"];
    const cdnRes = await fetch(cdnUrl, {
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent": "QazAkx-olymp/1.0 (educational platform)",
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });

    if (!cdnRes.ok && cdnRes.status !== 206) {
      res.statusCode = cdnRes.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `CDN returned ${cdnRes.status}` }));
      return;
    }

    res.statusCode = cdnRes.status || 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const disposition = wantDownload
      ? `attachment; filename="${safeTitle}"`
      : `inline; filename="${safeTitle}"`;
    res.setHeader("Content-Disposition", disposition);

    const contentLength = cdnRes.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const contentRange = cdnRes.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    res.setHeader("Accept-Ranges", "bytes");

    const buf = Buffer.from(await cdnRes.arrayBuffer());
    res.end(buf);
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `PDF proxy error: ${err.message}` }));
    }
  }
};
