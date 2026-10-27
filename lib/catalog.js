/**
 * Catalog Import Service
 * Imports olympiads.json into the SQLite database.
 * Ensures idempotent imports with stable unique IDs.
 */

const { getDb } = require("./db/sqlite");

const CDN_ORIGIN = "https://cdn.bc-pf.org";
const PAGE_ORIGIN = "https://olympiads.bc-pf.org";

function resolveCdnUrl(material) {
  if (!material) return null;
  const title = material.title || material.file;
  if (!title || !material.sourcePage) return null;

  // If we have a file path that includes the original filename, try to reconstruct
  const origName = title.replace(/\d{5}-/, ""); // Remove numeric prefix if present
  const parts = material.sourcePage.replace(PAGE_ORIGIN, "").split("/").filter(Boolean);

  if (parts.length >= 2) {
    const subjectEn = parts[0];
    const remainingPath = parts.slice(1).join("/");
    return `${CDN_ORIGIN}/olympiads/${subjectEn}/${remainingPath}/${origName}`;
  }
  return null;
}

function ensureUniqueOlympiadId(db, baseId, sourcePage, index) {
  // Check if this ID already exists
  const existing = db.prepare("SELECT id FROM olympiad_entries WHERE id = ?").get(baseId);
  if (!existing) return baseId;

  // If exists, verify it's the same source page (updating existing)
  const sourceMatch = db.prepare("SELECT source_page FROM olympiad_entries WHERE id = ?").get(baseId);
  if (sourceMatch?.source_page === sourcePage) {
    return baseId; // Update existing record
  }

  // Different source page with same ID - create unique variant
  let id = baseId;
  let counter = 1;
  while (db.prepare("SELECT 1 FROM olympiad_entries WHERE id = ?").get(id)) {
    id = `${baseId}-${counter++}`;
  }
  return id;
}

async function importCatalog(catalogPath, options = {}) {
  const fs = require("fs");
  const path = require("path");

  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const db = getDb();

  const report = {
    totalEntries: raw.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    localMaterials: 0,
    remoteMaterials: 0,
    hasLocalPdf: 0,
  };

  const insertSubject = db.prepare(`
    INSERT INTO olympiad_subjects (name, name_en) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET name_en = excluded.name_en
  `);
  const insertEntry = db.prepare(`
    INSERT INTO olympiad_entries (
      id, subject_id, subject, subject_en, year, grade, round, language, source_page, title, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      subject = excluded.subject,
      subject_en = excluded.subject_en,
      year = excluded.year,
      grade = excluded.grade,
      round = excluded.round,
      language = excluded.language,
      source_page = excluded.source_page,
      title = excluded.title,
      updated_at = CURRENT_TIMESTAMP
  `);
  const insertMaterial = db.prepare(`
    INSERT INTO olympiad_materials (
      olympiad_id, type, language, title, file, source_page, local, cdn_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    db.pragma("journal_mode = OFF");
    const insertMany = db.transaction((entries) => {
      const findSubjectStmt = db.prepare("SELECT id FROM olympiad_subjects WHERE name = ?");
      const insertSubjectStmt = db.prepare("INSERT INTO olympiad_subjects (name, name_en) VALUES (?, ?)");

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          report.errors.push(`Skipped malformed entry at index ${entries.indexOf(entry)}`);
          report.skipped++;
          continue;
        }

        const subject = entry.subject || "Неизвестный предмет";
        let subjRow = findSubjectStmt.get(subject);
        if (!subjRow) {
          const insertRes = insertSubjectStmt.run(subject, entry.subject_en || "");
          subjRow = { id: insertRes.lastInsertRowid };
        }

        let entryId = entry.id || `mat-${entry.subject}-${entry.year}-${entry.round || 0}`;
        entryId = ensureUniqueOlympiadId(db, entryId, entry.sourcePage, entries.indexOf(entry));

        const isNew = !db.prepare("SELECT 1 FROM olympiad_entries WHERE id = ?").get(entryId);

        // Build proper title from metadata
        const titleParts = [
          subject,
          entry.year,
          entry.grade ? `Класс ${entry.grade}` : '',
          entry.round || '',
          (entry.language || '').toUpperCase()
        ].filter(Boolean);
        const title = titleParts.join(' · ') || entry.sourcePage || '';

        insertEntry.run(
          entryId,
          subjRow.id,
          subject,
          entry.subject_en || "",
          entry.year || null,
          entry.grade || null,
          entry.round || null,
          entry.language || null,
          entry.sourcePage || "",
          title,
        );

        // Track whether this is new or existing
        if (isNew) {
          report.imported++;
        } else {
          report.updated++;
          // Clean up old materials for this entry when updating
          db.prepare("DELETE FROM olympiad_materials WHERE olympiad_id = ?").run(entryId);
        }

        const hasLocal = (entry.materials || []).some((m) => m.local);
        if (hasLocal) report.hasLocalPdf++;

        for (const mat of (entry.materials || [])) {
          const type = /sol|solution|res/i.test(`${mat.type || ""} ${mat.title || ""} ${mat.file || ""}`)
            ? "solutions"
            : (mat.type || "tasks");
          const localFlag = mat.local ? 1 : 0;
          const cdnUrl = resolveCdnUrl(mat);

          insertMaterial.run(
            entryId,
            type,
            mat.language || "",
            mat.title || "",
            mat.file || "",
            mat.sourcePage || "",
            localFlag,
            cdnUrl,
          );

          if (localFlag) report.localMaterials++;
          else report.remoteMaterials++;
        }
      }
    });

    insertMany(entries = raw);

    db.pragma("journal_mode = WAL");
  } catch (err) {
    db.pragma("journal_mode = WAL");
    report.errors.push(`Import failed: ${err.message}`);
    throw err;
  }

  return report;
}

function getCatalogStats() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM olympiad_entries) as entries,
      (SELECT COUNT(*) FROM olympiad_materials) as materials,
      (SELECT COUNT(*) FROM olympiad_materials WHERE local = 1) as local_materials,
      (SELECT COUNT(DISTINCT subject) FROM olympiad_entries) as subjects,
      (SELECT COUNT(DISTINCT year) FROM olympiad_entries WHERE year IS NOT NULL) as years,
      (SELECT COUNT(DISTINCT grade) FROM olympiad_entries WHERE grade IS NOT NULL) as grades
  `).get();

  return stats;
}

function getSubjectList() {
  return getDb().prepare(
    "SELECT DISTINCT subject, subject_en FROM olympiad_entries ORDER BY subject"
  ).all();
}

function searchOlympiads(filters = {}) {
  const db = getDb();
  let query = "SELECT * FROM olympiad_entries WHERE 1=1";
  const params = [];

  if (filters.subject) { query += " AND subject = ?"; params.push(filters.subject); }
  if (filters.year) { query += " AND year = ?"; params.push(filters.year); }
  if (filters.grade) { query += " AND grade = ?"; params.push(filters.grade); }
  if (filters.language) { query += " AND language = ?"; params.push(filters.language); }
  if (filters.search) {
    query += " AND (title LIKE ? OR source_page LIKE ?)";
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  query += " ORDER BY year DESC, subject ASC LIMIT 200";
  return db.prepare(query).all(...params);
}

module.exports = {
  importCatalog,
  getCatalogStats,
  getSubjectList,
  searchOlympiads,
  resolveCdnUrl,
};
