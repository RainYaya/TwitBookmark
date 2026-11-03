import type { Database } from '../../src/server/db.js';

const NOW = '2026-11-02T12:00:00.000Z';

interface SeedRow {
  id: string;
  source: 'twitter' | 'browser';
  title: string;
  url: string;
  created_at: string | null;
  saved_at: string;
  saved_source: 'tweet_created' | 'browser_added';
  metadata: Record<string, unknown>;
}

const ROWS: SeedRow[] = [
  {
    id: 'tw:1',
    source: 'twitter',
    title: '推特条目一',
    url: 'https://x.com/seed/status/1',
    created_at: '2026-11-02T09:00:00.000Z',
    saved_at: '2026-11-02T09:00:00.000Z',
    saved_source: 'tweet_created',
    metadata: { name: '种子作者', screen_name: 'seed', body: '第一条种子推文' },
  },
  {
    id: 'tw:2',
    source: 'twitter',
    title: '推特条目二',
    url: 'https://x.com/seed/status/2',
    created_at: '2026-11-01T09:00:00.000Z',
    saved_at: '2026-11-01T09:00:00.000Z',
    saved_source: 'tweet_created',
    metadata: { name: '种子作者', screen_name: 'seed', body: '第二条种子推文' },
  },
  {
    id: 'browser:seed1',
    source: 'browser',
    title: '浏览器条目一',
    url: 'https://example.com/one',
    created_at: null,
    saved_at: '2026-11-01T00:00:00.000Z',
    saved_source: 'browser_added',
    metadata: {},
  },
  {
    id: 'browser:seed2',
    source: 'browser',
    title: '浏览器条目二',
    url: 'https://example.com/two',
    created_at: null,
    saved_at: '2026-11-02T00:00:00.000Z',
    saved_source: 'browser_added',
    metadata: {},
  },
  {
    id: 'browser:seed3',
    source: 'browser',
    title: '浏览器条目三',
    url: 'https://example.com/three',
    created_at: null,
    saved_at: '2026-10-31T00:00:00.000Z',
    saved_source: 'browser_added',
    metadata: {},
  },
];

export function seed(db: Database): void {
  const insert = db.prepare(`
    INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, metadata)
    VALUES (@id, @source, @title, @url, @created_at, @saved_at, @saved_source, @imported_at, @metadata)
  `);
  for (const row of ROWS) {
    insert.run({
      ...row,
      imported_at: NOW,
      metadata: JSON.stringify(row.metadata),
    });
  }
}
