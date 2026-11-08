#!/usr/bin/env node
/**
 * Builds data/catalog/chemistry.json — the catalog the site actually uses.
 *
 * Source of file lists (first that exists):
 *   1. data/chemistry-sources.json  (written by `npm run sync-chemistry`, full and fresh)
 *   2. olympiads.json               (old manifest, may be incomplete)
 *
 * Usage: node scripts/build-catalog.js
 */

const fs = require("fs");
const path = require("path");
const { buildOlympiad, sortOlympiads, PAGE_ORIGIN } = require("../lib/chem-catalog");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SOURCES_PATH = path.join(ROOT, "data", "chemistry-sources.json");
const LEGACY_PATH = path.join(ROOT, "olympiads.json");
const OUT_PATH = path.join(ROOT, "data", "catalog", "chemistry.json");
const TASKS_DIR = path.join(ROOT, "data", "tasks");

function loadSources() {
  if (fs.existsSync(SOURCES_PATH)) {
    const data = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
    return { from: "data/chemistry-sources.json", pages: data.pages || {} };
  }
  const legacy = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf8"));
  const pages = {};
  for (const entry of legacy) {
    if (entry.subject_en !== "chemistry") continue;
    if (!String(entry.sourcePage || "").startsWith(PAGE_ORIGIN)) continue;
    pages[entry.sourcePage] = pages[entry.sourcePage] || [];
    for (const m of entry.materials || []) pages[entry.sourcePage].push(m.title);
  }
  return { from: "olympiads.json", pages };
}

// "local" = PDF лежит в репозитории (git), т.е. будет и на Vercel.
// Скачанные, но не закоммиченные PDF локальный сервер всё равно отдаёт через /api/pdf-proxy без интернета.
let tracked = null;
try {
  const out = require("child_process").execFileSync("git", ["ls-files", "public/olympiads"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString();
  tracked = new Set(out.split("\n").filter(Boolean));
} catch {}

function isLocal(relPath) {
  if (tracked) return tracked.has(`public/${relPath}`);
  const full = path.join(PUBLIC_DIR, ...relPath.split("/"));
  return fs.existsSync(full) && fs.statSync(full).isFile();
}

function main() {
  const { from, pages } = loadSources();
  const olympiads = [];
  for (const [sourcePage, files] of Object.entries(pages)) {
    const item = buildOlympiad(sourcePage, files, isLocal);
    if (item && item.materials.length) olympiads.push(item);
  }
  sortOlympiads(olympiads);

  // Mark task sets that already have parsed JSON (answer fields available)
  let solvable = 0;
  for (const o of olympiads) {
    for (const m of o.materials) {
      if (m.setId && fs.existsSync(path.join(TASKS_DIR, `${m.setId}.json`))) {
        m.solvable = true;
        solvable++;
      }
    }
  }

  const catalog = {
    subject: "chemistry",
    generatedAt: new Date().toISOString(),
    source: from,
    olympiads,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(catalog) + "\n");

  const materials = olympiads.reduce((n, o) => n + o.materials.length, 0);
  const local = olympiads.reduce((n, o) => n + o.materials.filter((m) => m.local).length, 0);
  console.log(`Каталог химии: ${olympiads.length} олимпиад, ${materials} PDF (локально: ${local}), с полями ответа: ${solvable}`);
  console.log(`Источник: ${from} → ${path.relative(ROOT, OUT_PATH)}`);
}

main();
