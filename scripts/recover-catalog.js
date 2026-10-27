const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const manifestPath = path.join(root, "olympiads.json");

function gitCatalog() {
  try {
    const tmpPath = path.join(__dirname, "..", "/tmp/full_catalog.json");
    if (fs.existsSync(tmpPath)) return JSON.parse(fs.readFileSync(tmpPath, "utf8"));
    // Fallback: read from git history directly
    const output = execFileSync("git", ["show", "d734665:olympiads.json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output);
  } catch (error) {
    console.warn("Could not read recovered catalog:", error.message);
    return [];
  }
}

function exists(file) {
  return fs.existsSync(path.join(publicDir, file)) && fs.statSync(path.join(publicDir, file)).isFile();
}

function subjectLabel(subject) {
  return {
    chemistry: "Химия",
    biology: "Биология",
    physics: "Физика",
    geography: "География",
    math: "Математика",
    astronomy: "Астрономия",
    informatics: "Информатика",
  }[String(subject || "").toLowerCase()] || String(subject || "Другой предмет");
}

function languageFrom(value) {
  const text = String(value || "").toLowerCase();
  if (/(qaz|қаз|kaz|-kz|_kz|\bkz\b)/.test(text)) return "kz";
  if (/(rus|рус|-ru|_rus|\bru\b)/.test(text)) return "ru";
  if (/(eng|англ|-en|_en|\ben\b)/.test(text)) return "en";
  return null;
}

function gradeFrom(value) {
  const text = String(value || "");
  const sourceMatch = text.match(/(?:national|region|oblast)\/\d{4}\/(7|8|9|10|11)(?:\/|$)/i);
  if (sourceMatch) return Number(sourceMatch[1]);
  const nameMatch = text.match(/(?:chem|chem9|chem10|chem11|bio-|chem-|phys-|astro-|cs|geo)(\d{1,2})(?:[-_.]|$)/i);
  if (nameMatch) {
    const grade = Number(nameMatch[1]);
    if (grade >= 7 && grade <= 11) return grade;
  }
  return null;
}

function roundFrom(value) {
  const text = String(value || "");
  const roundMatch = text.match(/(?:round|tour)[-_ ]?(\d+)/i);
  if (roundMatch) return `round${roundMatch[1]}`;
  const materialMatch = text.match(/(?:chem|bio|phys|astro|cs|geo)-(\d+)-/i);
  if (materialMatch) return `round${materialMatch[1]}`;
  return null;
}

function yearFrom(value) {
  const match = String(value || "").match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function materialType(title) {
  const text = String(title || "").toLowerCase();
  if (/(^|[-_.])(sol|solution|res|answer)([-_.]|$)/.test(text)) return "solutions";
  if (/(task|tasks|blank)/.test(text)) return "tasks";
  return "other";
}

function normalize(entry) {
  const file = String(entry.file || "").replace(/^\/+/, "");
  const title = String(entry.title || path.basename(file));
  return {
    id: `material-${file}`,
    subject: subjectLabel(entry.subject),
    subject_en: String(entry.subject || "").toLowerCase(),
    year: yearFrom(`${entry.sourcePage || ""} ${title}`),
    grade: gradeFrom(`${entry.sourcePage || ""} ${title}`),
    round: roundFrom(`${entry.sourcePage || ""} ${title}`),
    language: languageFrom(`${entry.sourcePage || ""} ${title}`),
    type: materialType(title),
    title,
    sourcePage: entry.sourcePage || "",
    file,
    pdf: file,
    local: exists(file),
  };
}

function addLocalEntry(file, type) {
  const title = path.basename(file);
  const entry = normalize({
    subject: "chemistry",
    title,
    sourcePage: "Национальная олимпиада 2024 · 9 класс",
    file,
  });
  entry.subject = "Химия";
  entry.subject_en = "chemistry";
  entry.year = 2024;
  entry.grade = 9;
  entry.round = "round1";
  entry.language = "ru";
  entry.type = type;
  entry.local = true;
  return entry;
}

const recovered = gitCatalog().map(normalize);
const entries = recovered;
const localFiles = [
  ["olympiads/chemistry/chem9-2024-round1-tasks-rus.pdf", "tasks"],
  ["olympiads/chemistry/chem9-2024-round1-sol-rus.pdf", "solutions"],
];
for (const [file, type] of localFiles) {
  if (!entries.some((entry) => entry.file === file)) entries.push(addLocalEntry(file, type));
}

fs.writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
const localCount = entries.filter((entry) => entry.local).length;
const subjects = new Set(entries.map((entry) => entry.subject));
console.log(`Recovered ${entries.length} catalog materials (${localCount} local PDFs) from git history and the current local archive.`);
console.log(`Subjects recovered: ${subjects.size}`);
for (const entry of localFiles) console.log(` - ${entry[0]}`);
