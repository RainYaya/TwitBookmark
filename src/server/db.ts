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
  const columns = db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'collection_id')) {
    db.exec(
      'ALTER TABLE items ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL',
    );
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id)');
  return db;
}
