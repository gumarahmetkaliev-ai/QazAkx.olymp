const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const olympiadsDir = path.join(publicDir, "olympiads");
const manifestPath = path.join(root, "olympiads.json");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function publicFile(file) {
  return String(file || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^public\//, "");
}

function isLocal(file) {
  const safe = publicFile(file);
  if (!safe || safe.includes("..") || !safe.startsWith("olympiads/") || !/\.pdf$/i.test(safe)) return false;
  const filePath = path.join(publicDir, ...safe.split("/"));
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

const pdfs = walk(olympiadsDir).filter((file) => file.toLowerCase().endsWith(".pdf"));
const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : [];
const entries = Array.isArray(existing) ? existing : [];

entries.forEach((entry) => {
  entry.local = isLocal(entry.file || entry.pdf);
  if (entry.materials && Array.isArray(entry.materials)) {
    entry.materials.forEach((material) => {
      material.local = isLocal(material.file || material.pdf);
    });
  }
});

const localCount = entries.filter((entry) => entry.local).length;
const materialCount = entries.reduce((sum, entry) => sum + (entry.materials ? entry.materials.length : 1), 0);
fs.writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);

console.log(`Catalog preserved: ${entries.length} olympiad materials (${localCount} local PDFs).`);
for (const file of pdfs) console.log(` - ${publicFile(file)}`);
