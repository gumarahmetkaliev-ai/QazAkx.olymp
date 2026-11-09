/**
 * Двухколоночная вёрстка (pdftotext -layout): казахский | русский текст рядом
 * или одна статья в две колонки. Разрезаем каждую страницу по «жёлобу» и
 * выдаём колонки по очереди: левая, потом правая.
 */

const KZ_LETTERS = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/g;

/** Позиция жёлоба на странице или null */
function findGutter(lines) {
  const body = lines.filter((l) => l.trim().length > 0);
  if (body.length < 8) return null;
  const width = Math.max(...body.map((l) => l.length));
  if (width < 60) return null;
  let best = null;
  for (let x = Math.floor(width * 0.3); x <= Math.floor(width * 0.7); x++) {
    let wide = 0; // строки, которые доходят до x
    let gap = 0; // …и у которых в x пробелы
    let leftUse = 0;
    let rightUse = 0;
    for (const l of body) {
      if (l.length <= x) {
        if (l.trim()) leftUse++;
        continue;
      }
      wide++;
      if (/^\s{2}$/.test(l.slice(x - 1, x + 1)) || l.slice(x - 1, x + 1) === "  ") gap++;
      if (l.slice(0, x).trim()) leftUse++;
      if (l.slice(x).trim()) rightUse++;
    }
    if (wide < body.length * 0.3 || rightUse < body.length * 0.25 || leftUse < body.length * 0.25) continue;
    const ratio = gap / wide;
    if (ratio >= 0.9 && (!best || ratio > best.ratio || (ratio === best.ratio && Math.abs(x - width / 2) < Math.abs(best.x - width / 2)))) best = { x, ratio };
  }
  return best && best.x;
}

/** Разрезать текст постранично; возвращает { text, split } */
function linearize(text) {
  let split = 0;
  const pages = String(text).split("\f").map((page) => {
    const lines = page.split("\n");
    const x = findGutter(lines);
    if (x == null) return page;
    split++;
    const left = [];
    const right = [];
    for (const l of lines) {
      left.push(l.slice(0, x).replace(/\s+$/, ""));
      right.push(l.slice(x).replace(/\s+$/, ""));
    }
    // убрать общий отступ правой колонки
    const ind = Math.min(...right.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    return left.join("\n") + "\n\n" + right.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join("\n");
  });
  return { text: pages.join("\f"), split };
}

/** Доля казахских букв среди кириллицы */
function kzRatio(text) {
  const cyr = (String(text).match(/[а-яёәғқңөұүһі]/gi) || []).length;
  if (!cyr) return 0;
  return (String(text).match(KZ_LETTERS) || []).length / cyr;
}

/** Язык фрагмента: kz | ru | en */
function langOf(text) {
  const s = String(text);
  const cyr = (s.match(/[а-яё]/gi) || []).length;
  const lat = (s.match(/[a-z]/gi) || []).length;
  if (cyr < lat * 0.3) return "en";
  return kzRatio(s) > 0.015 ? "kz" : "ru";
}

module.exports = { linearize, findGutter, kzRatio, langOf };
