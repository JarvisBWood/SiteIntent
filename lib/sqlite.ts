import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

let database: Database.Database | null = null;

export function getSqliteDb() {
  if (database) {
    return database;
  }

  const dataDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "siteintent.sqlite");
  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  initializeSchema(database);
  return database;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_ui_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS target_intent_models (
      project_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_onboarding (
      project_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scan_runs_project_id ON scan_runs(project_id);

    CREATE TABLE IF NOT EXISTS scan_pages (
      scan_id TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (scan_id, page_index),
      FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE
    );
  `);
}
