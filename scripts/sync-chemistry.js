#!/usr/bin/env node
/**
 * Синхронизация материалов по химии с olympiads.bc-pf.org.
 *
 *   npm run sync-chemistry                 – обновить список PDF на всех страницах (быстро, без скачивания)
 *   npm run sync-chemistry -- --subject=biology   – то же для биологии (npm run sync-biology)
 *   npm run sync-chemistry -- --download   – + скачать PDF в public/olympiads/chemistry/...
 *   ... --crawl                            – обойти сайт и найти новые страницы
 *   ... --stage=oblast --year=2023         – только часть каталога
 *
 * Результат:
 *   data/chemistry-sources.json  – полный список PDF по каждой странице (+ прямые ссылки на CDN)
 *   public/olympiads/chemistry/<этап>/<год>/<класс>/<файл>.pdf  – локальные копии (с --download)
 *   data/catalog/chemistry.json  – пересобирается автоматически
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parseSourcePage, PAGE_ORIGIN } = require("../lib/chem-catalog");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const CDN_ORIGIN = "https://cdn.bc-pf.org";
const UA = "QazAkx-olymp/1.0 (educational platform)";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const CONCURRENCY = Number(args.concurrency || 4);
const SUBJECT = String(args.subject || "chemistry");
const SOURCES_PATH = path.join(ROOT, "data", `${SUBJECT}-sources.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, asBuffer = false, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (i === tries) throw err;
      await sleep(1000 * i);
    }
  }
}

function extractPdfLinks(html, pageUrl) {
  const links = {};
  const re = /href=["']([^"']+?\.pdf)(?:\?[^"']*)?["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], pageUrl).toString();
      if (!abs.startsWith(CDN_ORIGIN) && !abs.startsWith(PAGE_ORIGIN)) continue;
      const filename = decodeURIComponent(abs.split("/").pop());
      if (!links[filename]) links[filename] = abs;
    } catch {}
  }
  return links;
}

function listPages(extra = []) {
  const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, "olympiads.json"), "utf8"));
  const pages = new Set(extra);
  for (const e of legacy) {
    if (e.subject_en === SUBJECT && String(e.sourcePage || "").startsWith(PAGE_ORIGIN)) pages.add(e.sourcePage);
  }
  if (fs.existsSync(SOURCES_PATH)) {
    const prev = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
    Object.keys(prev.pages || {}).forEach((p) => pages.add(p));
  }
  return [...pages].filter((p) => {
    const info = parseSourcePage(p);
    if (!info) return false;
    if (args.stage && info.stageKey !== args.stage) return false;
    if (args.year && String(info.year) !== String(args.year)) return false;
    return true;
  });
}

/** Обход сайта: /<предмет> → этапы → годы → классы; собираем все страницы раздела */
async function crawlPages() {
  const start = `${PAGE_ORIGIN}/${SUBJECT}`;
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next = [];
    await runPool(frontier, async (url) => {
      let html;
      try { html = await fetchWithRetry(url); } catch { return; }
      const re = new RegExp(`href=["'](?:${PAGE_ORIGIN})?(/${SUBJECT}/[^"'#?]+)["']`, "g");
      let m;
      while ((m = re.exec(html)) !== null) {
        const abs = PAGE_ORIGIN + m[1].replace(/\/+$/, "");
        if (!seen.has(abs) && abs.length > url.length - 1) { seen.add(abs); next.push(abs); }
      }
    });
    frontier = next;
    process.stdout.write(`\rОбход сайта: глубина ${depth + 1}, страниц ${seen.size}      `);
  }
  console.log("");
  return [...seen];
}

async function runPool(items, worker) {
  let index = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const prev = fs.existsSync(SOURCES_PATH) ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8")) : { pages: {}, urls: {} };
  const out = { updatedAt: new Date().toISOString(), pages: { ...prev.pages }, urls: { ...prev.urls } };
  const pages = listPages(args.crawl ? await crawlPages() : []);
  console.log(`Страниц для обработки: ${pages.length}`);

  let failed = 0;
  await runPool(pages, async (pageUrl, i) => {
    try {
      const html = await fetchWithRetry(pageUrl);
      const links = extractPdfLinks(html, pageUrl);
      const files = Object.keys(links);
      if (files.length) {
        out.pages[pageUrl] = files;
        out.urls[pageUrl] = links;
      }
      process.stdout.write(`\r[${i + 1}/${pages.length}] ${pageUrl.replace(PAGE_ORIGIN, "")} — ${files.length} PDF        `);
    } catch (err) {
      failed++;
      console.warn(`\n⚠ ${pageUrl}: ${err.message}`);
    }
  });
  console.log(`\nСписки PDF обновлены (ошибок: ${failed}).`);
  fs.mkdirSync(path.dirname(SOURCES_PATH), { recursive: true });
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(out, null, 1) + "\n");

  if (args.download) {
    const jobs = [];
    for (const pageUrl of pages) {
      const info = parseSourcePage(pageUrl);
      for (const [filename, url] of Object.entries(out.urls[pageUrl] || {})) {
        const dest = path.join(PUBLIC_DIR, "olympiads", ...info.pagePath.split("/"), filename);
        if (!fs.existsSync(dest)) jobs.push({ url, dest });
      }
    }
    console.log(`Скачиваю ${jobs.length} PDF…`);
    let done = 0;
    let errors = 0;
    await runPool(jobs, async ({ url, dest }) => {
      try {
        const buf = await fetchWithRetry(url, true);
        if (buf.slice(0, 4).toString() !== "%PDF") throw new Error("не PDF");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      } catch (err) {
        errors++;
        console.warn(`\n⚠ ${url}: ${err.message}`);
      }
      done++;
      process.stdout.write(`\r  ${done}/${jobs.length}`);
    });
    console.log(`\nГотово. Ошибок: ${errors}.`);
  }

  execFileSync(process.execPath, [path.join(__dirname, "build-catalog.js"), `--subject=${SUBJECT}`], { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
