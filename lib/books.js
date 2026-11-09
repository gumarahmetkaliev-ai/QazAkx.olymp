/**
 * Рекомендации литературы по темам ошибок: книга → глава/раздел → страницы.
 * Указатель — data/books.json (scripts: оглавления PDF-книг, темы — lib/bio-topics.js).
 * На сайт попадают только название, раздел и страницы — не текст книги.
 */
const fs = require("fs");
const path = require("path");

let index = null;
function loadBooks() {
  if (index) return index;
  try {
    index = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "books.json"), "utf8")).books || [];
  } catch {
    index = [];
  }
  return index;
}

// общие слова, которые есть в заголовках любых глав — не считаем совпадением
const STOP = new Set(["систе", "общие", "общая", "особе", "введе", "основ", "часть", "глава", "харак", "строе", "функц", "приме", "котор", "какой", "какая", "какие", "выбер", "утвер", "следу", "ниже", "chapt", "secti", "syste", "struc", "funct", "gener", "intro", "overv", "which", "follo", "these", "their"]);

/** Грубый стемминг: первые 5 букв слов длиной ≥ 4, без общих слов */
function stems(text) {
  const words =
    String(text || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .match(/[a-zа-яәіңғүұқөһ]{4,}/g) || [];
  return new Set(words.map((w) => w.slice(0, 5)).filter((w) => !STOP.has(w)));
}

// Опорные слова темы (рус + англ): помогают выбрать центральную главу, когда язык вопроса и книги разный
const ANCHORS = {
  "bio-cell": "клетка мембрана органеллы cell membrane organelle structure",
  "bio-biochem": "белки аминокислоты ферменты углеводы липиды protein amino acids enzymes carbohydrates lipids macromolecules",
  "bio-metabolism": "клеточное дыхание гликолиз метаболизм cellular respiration glycolysis metabolism fermentation",
  "bio-photosynthesis": "фотосинтез photosynthesis light reactions calvin",
  "bio-molecular": "репликация транскрипция трансляция replication transcription translation genetic code",
  "bio-cell-cycle": "мейоз митоз клеточный цикл meiosis mitosis cell cycle",
  "bio-genetics": "наследование мендель сцепление mendel inheritance linkage chromosomes",
  "bio-popgen": "популяции харди hardy weinberg populations evolution allele frequencies",
  "bio-gene-regulation": "регуляция экспрессии биотехнология regulation gene expression biotechnology",
  "bio-evolution": "эволюция отбор evolution natural selection phylogeny speciation",
  "bio-systematics": "систематика разнообразие diversity classification taxonomy",
  "bio-microbio": "бактерии вирусы bacteria archaea viruses prokaryotes",
  "bio-plants": "растения строение растений plant structure growth transport",
  "bio-animal-anatomy": "животные строение animal form diversity invertebrates vertebrates",
  "bio-human-physiology": "физиология кровообращение дыхание выделение physiology circulation gas exchange kidney excretion digestion",
  "bio-neuro": "нервная система гормоны nervous system neurons hormones endocrine",
  "bio-immunology": "иммунная система immune system",
  "bio-development": "размножение развитие reproduction development",
  "bio-ecology": "экология экосистемы сообщества ecology ecosystems communities populations",
  "bio-ethology": "поведение behavior",
  "bio-methods": "методы эксперимент methods experiment",
};

/**
 * Разделы книг по теме.
 * @param topic  id темы (bio-…)
 * @param text   текст вопроса/ошибки — для выбора самого близкого раздела
 * @param lang   "ru" | "kz" | "en" — русские книги первыми для ru/kz
 * @param limit  сколько книг вернуть
 */
function recommend(topic, { text = "", lang = "ru", limit = 3 } = {}) {
  const words = stems(text);
  const anchor = stems(ANCHORS[topic] || "");
  const out = [];
  for (const book of loadBooks()) {
    const cands = book.sections.filter((s) => s.topic === topic);
    if (!cands.length) continue;
    let best = null;
    let bestScore = -1;
    for (const s of cands) {
      const sw = stems(`${s.t} ${s.ch || ""}`);
      let overlap = 0;
      let anchorHit = 0;
      for (const w of words) if (sw.has(w)) overlap++;
      for (const w of anchor) if (sw.has(w)) anchorHit++;
      // слова вопроса важнее всего; без них — центральная глава темы (опорные слова)
      const score = overlap * 3 + Math.min(anchorHit, 3) * 1.2 + (s.lvl === 0 ? 1 : 0) - (s.to && s.to - s.p > 60 ? 0.5 : 0);
      if (score > bestScore) (best = s), (bestScore = score);
    }
    const langBonus = (lang === "en" ? book.lang === "en" : book.lang === "ru") ? 2 : 0;
    out.push({
      book: book.id,
      title: book.title,
      authors: book.authors,
      lang: book.lang,
      section: best.t,
      chapter: best.lvl ? best.ch : null,
      pages: best.to && best.to !== best.p ? `${best.p}–${best.to}` : String(best.p),
      score: bestScore + langBonus,
    });
  }
  // тома одной книги (grin-1, grin-2 …) — только лучший, чтобы рекомендации были из разных книг
  const seen = new Set();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      const series = r.book.replace(/-\d+$/, "");
      if (seen.has(series)) return false;
      seen.add(series);
      return true;
    })
    .slice(0, limit)
    .map(({ score, ...r }) => r);
}

module.exports = { recommend, loadBooks, stems };
