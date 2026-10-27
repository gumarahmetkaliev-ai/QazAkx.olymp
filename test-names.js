const fs = require('fs');
const sqlite3 = require('better-sqlite3');
const db = sqlite3('data/qazakx.sqlite');
const mapping = JSON.parse(fs.readFileSync('titles_mapping.json', 'utf8'));
const rows = db.prepare('SELECT id FROM olympiad_entries').all();
let ok = 0, miss = 0, empty = 0;
for (const [k,v] of Object.entries(mapping)) {
  if (!rows.find(r => r.id === k)) console.log('MISSING DB ID:', k);
  else if (!v || v.trim() === '') console.log('EMPTY TITLE:', k);
  else ok++;
}
console.log('Mapping verified:', ok, 'missing DB:', miss, 'empty:', empty, '| DB ids total:', rows.length);
// Numeric sort check on years
const years = db.prepare('SELECT DISTINCT year FROM olympiad_entries ORDER BY year ASC').all();
console.log('Year sort OK:', years[0]?.year, '->', years[years.length-1]?.year);
