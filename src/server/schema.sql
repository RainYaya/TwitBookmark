PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('twitter','browser','github')),
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  created_at    TEXT,
  saved_at      TEXT NOT NULL,
  saved_source  TEXT CHECK (saved_source IN ('tweet_created','browser_added','first_seen')),
  imported_at   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'inbox'
                CHECK (status IN ('inbox','later','done','reference')),
  read          INTEGER NOT NULL DEFAULT 0,
  is_todo       INTEGER NOT NULL DEFAULT 0,
  todo_done     INTEGER NOT NULL DEFAULT 0,
  metadata      TEXT NOT NULL DEFAULT '{}',
  ai_tags       TEXT NOT NULL DEFAULT '[]',
  ai_summary    TEXT,
  summary       TEXT,
  ai_state      TEXT NOT NULL DEFAULT 'none'
                CHECK (ai_state IN ('none','suggested','accepted')),
  last_surfaced_at TEXT,
  deleted_at    TEXT,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_items_saved ON items(saved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at);

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  total      INTEGER NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED, title, text, summary, tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (id, title, text, summary)
  VALUES (
    new.id,
    new.title,
    COALESCE(json_extract(new.metadata, '$.body'), '') || ' ' ||
    COALESCE(json_extract(new.metadata, '$.description'), ''),
    COALESCE(new.summary, new.ai_summary, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
  DELETE FROM items_fts WHERE id = old.id;
  INSERT INTO items_fts (id, title, text, summary)
  VALUES (
    new.id,
    new.title,
    COALESCE(json_extract(new.metadata, '$.body'), '') || ' ' ||
    COALESCE(json_extract(new.metadata, '$.description'), ''),
    COALESCE(new.summary, new.ai_summary, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE id = old.id;
END;
