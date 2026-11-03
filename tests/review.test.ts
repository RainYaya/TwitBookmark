import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

const NOW = '2026-11-02T12:00:00.000Z';

function insertItem(
  db: Database,
  id: string,
  values: {
    status: string;
    last_surfaced_at?: string | null;
    deleted_at?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, status, last_surfaced_at, deleted_at, metadata)
     VALUES (?, 'twitter', ?, ?, ?, ?, 'tweet_created', ?, ?, ?, ?, '{}')`,
  ).run(
    id,
    `title ${id}`,
    `https://example.com/${id}`,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-02T00:00:00.000Z',
    values.status,
    values.last_surfaced_at ?? null,
    values.deleted_at ?? null,
  );
}

describe('daily review', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = buildApp({ db, now: () => NOW });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('picks later/reference items, preferring never-surfaced ones', async () => {
    insertItem(db, 'recent', { status: 'later', last_surfaced_at: '2026-10-30T12:00:00.000Z' });
    insertItem(db, 'old', { status: 'reference', last_surfaced_at: '2026-10-10T12:00:00.000Z' });
    insertItem(db, 'never1', { status: 'later' });
    insertItem(db, 'never2', { status: 'reference' });
    insertItem(db, 'inbox', { status: 'inbox' });
    insertItem(db, 'done', { status: 'done' });
    insertItem(db, 'deleted', {
      status: 'reference',
      deleted_at: '2026-11-01T00:00:00.000Z',
    });

    const res = await app.inject({ method: 'GET', url: '/api/review/daily?count=3' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((item: { id: string }) => item.id);
    expect(ids.sort()).toEqual(['never1', 'never2', 'old']);

    const surfaced = db
      .prepare('SELECT id, last_surfaced_at FROM items WHERE last_surfaced_at = ? ORDER BY id')
      .all(NOW) as Array<{ id: string }>;
    expect(surfaced.map((row) => row.id)).toEqual(['never1', 'never2', 'old']);
    const recent = db.prepare('SELECT last_surfaced_at FROM items WHERE id = ?').get('recent') as {
      last_surfaced_at: string;
    };
    expect(recent.last_surfaced_at).toBe('2026-10-30T12:00:00.000Z');
  });

  it('does not repeat items within the same day', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      insertItem(db, id, { status: 'later' });
    }

    const first = await app.inject({ method: 'GET', url: '/api/review/daily?count=3' });
    const second = await app.inject({ method: 'GET', url: '/api/review/daily?count=3' });
    const firstIds = first.json().items.map((item: { id: string }) => item.id);
    const secondIds = second.json().items.map((item: { id: string }) => item.id);

    expect(firstIds).toHaveLength(3);
    expect(secondIds).toHaveLength(2);
    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  it('includes an item at exactly 14 days and excludes newer ones', async () => {
    insertItem(db, 'boundary', {
      status: 'later',
      last_surfaced_at: '2026-10-19T12:00:00.000Z',
    });
    insertItem(db, 'tooSoon', {
      status: 'later',
      last_surfaced_at: '2026-10-19T12:00:01.000Z',
    });

    const res = await app.inject({ method: 'GET', url: '/api/review/daily?count=5' });
    expect(res.json().items.map((item: { id: string }) => item.id)).toEqual(['boundary']);
  });

  it('rejects an invalid count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/review/daily?count=0' });
    expect(res.statusCode).toBe(400);
  });
});
