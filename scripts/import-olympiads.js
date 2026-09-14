const fs = require("fs");
const path = require("path");

const origin = "https://olympiads.bc-pf.org";
const subjects = [
  "astronomy", "biology", "geography", "informatics", "linguistics",
  "math", "physics", "chemistry", "english", "history", "krsh", "kll",
  "deutsch", "law", "rksh", "rll",
];
const outputRoot = path.join(__dirname, "..", "public", "olympiads");
const manifestPath = path.join(__dirname, "..", "olympiads.json");

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

function linksFromHtml(html) {
  return [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map((match) => match[1]);
}

function absoluteUrl(value) {
  try { return new URL(value, origin).toString(); } catch { return null; }
}

async function main() {
  const pages = subjects.map((subject) => `${origin}/${subject}`);
  const visited = new Set();
  const pdfs = new Map();

  while (pages.length) {
    const batch = pages.splice(0, 12).filter((pageUrl) => !visited.has(pageUrl));
    batch.forEach((pageUrl) => visited.add(pageUrl));
    await Promise.all(batch.map(async (pageUrl) => {
      try {
        const html = await (await get(pageUrl)).text();
        for (const rawLink of linksFromHtml(html)) {
          const link = absoluteUrl(rawLink);
          if (!link) continue;
          if (link.toLowerCase().includes(".pdf")) {
            pdfs.set(link, pageUrl);
            continue;
          }
          const parsed = new URL(link);
          if (parsed.origin !== origin) continue;
          const firstPart = parsed.pathname.split("/")[1];
          if (subjects.includes(firstPart) && !visited.has(link)) pages.push(link);
        }
      } catch (error) {
        console.warn(`Skipped ${pageUrl}: ${error.message}`);
      }
    }));
    console.log(`Scanned ${visited.size} pages, found ${pdfs.size} PDFs.`);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const manifest = [];
  let index = 0;
  for (const [remoteUrl, sourcePage] of pdfs) {
    const parsed = new URL(remoteUrl);
    const subject = parsed.pathname.split("/")[1] || "other";
    const safeName = `${String(index++).padStart(5, "0")}-${path.basename(parsed.pathname).replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const relativeFile = path.join("public", "olympiads", subject, safeName);
    const localFile = path.join(__dirname, "..", relativeFile);
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    if (!fs.existsSync(localFile)) {
      console.log(`Downloading ${index}/${pdfs.size}: ${remoteUrl}`);
      const buffer = Buffer.from(await (await get(remoteUrl)).arrayBuffer());
      fs.writeFileSync(localFile, buffer);
    }
    manifest.push({ subject, title: path.basename(parsed.pathname), sourcePage, file: relativeFile });
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Imported ${manifest.length} PDF files from ${visited.size} pages.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });