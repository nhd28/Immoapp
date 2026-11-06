import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'immo.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  address TEXT, city TEXT, type TEXT,
  price REAL, living_area REAL, plot_area REAL, rooms REAL, units INTEGER,
  year_built INTEGER, rent_yearly REAL, hausgeld REAL,
  energy_class TEXT, source TEXT, link TEXT, contact TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'eingang',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ai_status TEXT, ai_error TEXT, ai_analysis TEXT, ai_at TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- 'expose' | 'image' | 'doc'
  stored_name TEXT NOT NULL, original_name TEXT, mime TEXT, size INTEGER,
  is_cover INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user TEXT NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}', -- JSON {kriterium: 1..5}
  verdict TEXT,                      -- 'ja' | 'vielleicht' | 'nein'
  comment TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, user)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user TEXT, type TEXT NOT NULL,   -- 'status' | 'comment' | 'upload' | 'created' | 'ai'
  text TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function logActivity(propertyId, user, type, text) {
  db.prepare('INSERT INTO activity (property_id, user, type, text) VALUES (?, ?, ?, ?)').run(
    propertyId, user ?? null, type, text ?? null,
  );
}
