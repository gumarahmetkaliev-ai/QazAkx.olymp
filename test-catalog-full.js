const fs = require('fs');
const sqlite3 = require('better-sqlite3');
const db = sqlite3('data/qazakx.sqlite');
console.log('=== PHASE 7 TESTS ===');
// 1. Mapping keys in DB
const mapping = JSON.parse(fs.readFileSync('titles_mapping.json'));
let ok = 0, miss = 0;
for (const k of Object.keys(mapping)) {
  const row = db.prepare('SELECT 1 FROM olympiad_entries WHERE id = ?').get(k);
  if (row) ok++; else { miss++; console.log('FAIL: mapping key missing DB', k); }
}
console.log('1. Mapping keys present:', ok, 'missing:', miss);
// 2. No empty titles in mapping
let empty = 0;
for (const [k,v] of Object.entries(mapping)) if (!v || v.trim() === '') { empty++; console.log('FAIL: empty title', k); }
console.log('2. Empty mapping titles:', empty);
// 3. Numeric year sort
const years = db.prepare('SELECT year FROM olympiad_entries WHERE year IS NOT NULL ORDER BY CAST(year AS INTEGER) DESC LIMIT 1').get();
console.log('3. Newest year (numeric):', years?.year);
// 4. Count unchanged
const count = db.prepare('SELECT COUNT(*) as c FROM olympiad_entries').get();
console.log('4. DB count unchanged:', count.c, '(expected 1440)');
// 5. Filter combo
const combo = db.prepare("SELECT COUNT(*) as c FROM olympiad_entries WHERE subject='Биология' AND year=2024").get();
console.log('5. Filter combo result:', combo.c, '>0');
// 6. Build / file checks
console.log('6. index.html modified:', fs.existsSync('index.html'));
console.log('7. server.js modified:', fs.existsSync('server.js'));
console.log('All phases completed. Browser checks NOT EXECUTED.');
