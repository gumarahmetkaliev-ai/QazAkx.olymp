/**
 * SQLite Database Layer for QazAkx.olymp
 * Local persistent storage for catalog, users, progress, and diagnostics.
 * Uses better-sqlite3 for synchronous, fast access.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "qazakx.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });

let db;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  initSchema(db);
  runMigrations(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS olympiad_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_en TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS olympiad_entries (
      id TEXT PRIMARY KEY,
      subject_id INTEGER REFERENCES olympiad_subjects(id),
      subject TEXT NOT NULL,
      subject_en TEXT,
      year INTEGER,
      grade INTEGER,
      round TEXT,
      language TEXT,
      source_page TEXT,
      title TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS olympiad_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      olympiad_id TEXT NOT NULL REFERENCES olympiad_entries(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('tasks', 'solutions', 'other')),
      language TEXT,
      title TEXT NOT NULL,
      file TEXT,
      source_page TEXT,
      local INTEGER DEFAULT 0,
      cdn_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_materials_olympiad ON olympiad_materials(olympiad_id);
    CREATE INDEX IF NOT EXISTS idx_materials_type ON olympiad_materials(type);
    CREATE INDEX IF NOT EXISTS idx_entries_subject ON olympiad_entries(subject);
    CREATE INDEX IF NOT EXISTS idx_entries_year ON olympiad_entries(year);
    CREATE INDEX IF NOT EXISTS idx_entries_grade ON olympiad_entries(grade);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT,
      settings_json TEXT DEFAULT '{}',
      is_local INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      olympiad_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      answer TEXT,
      parts_json TEXT,
      status TEXT,
      ai_result_json TEXT,
      score INTEGER,
      max_score INTEGER DEFAULT 10,
      last_saved TEXT DEFAULT CURRENT_TIMESTAMP,
      checked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, olympiad_id, task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_progress_user ON user_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_progress_olympiad ON user_progress(olympiad_id);
    CREATE INDEX IF NOT EXISTS idx_user_progress_checked ON user_progress(checked_at);

    CREATE TABLE IF NOT EXISTS ai_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 1,
      config_encrypted TEXT,
      default_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model TEXT,
      prompt_tokens INTEGER,
      response_tokens INTEGER,
      success INTEGER,
      error TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_requests_provider ON ai_requests(provider);
  `);
}

const migrations = [
  // Migration 001: Initial schema (already handled above)
];

function runMigrations(db) {
  const migTable = db.prepare(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  for (const mig of migrations) {
    const exists = db.prepare("SELECT id FROM _migrations WHERE id = ?").get(mig.id);
    if (!exists) {
      mig.up(db);
      db.prepare("INSERT INTO _migrations (id, name) VALUES (?, ?)").run(mig.id, mig.name);
    }
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  initSchema,
  closeDb,
  DB_PATH,
};
