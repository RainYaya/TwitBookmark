import DatabaseConstructor from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Database = DatabaseConstructor.Database;

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export function createDb(filename = 'data/bookmarks.db'): Database {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new DatabaseConstructor(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}
