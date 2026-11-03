import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

function insertItem(
  db: Database,
  id: string,
  overrides: { title?: string; metadata?: string; status?: string } = {},
) {
  db.prepare(
    `INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, status, metadata)
     VALUES (?, 'twitter', ?, ?, ?, ?, 'tweet_created', ?, ?, ?)`,
  ).run(
    id,
    overrides.title ?? `title ${id}`,
    `https://example.com/${id}`,
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
    '2026-11-02T00:00:00.000Z',
    overrides.status ?? 'inbox',
    overrides.metadata ?? '{}',
  );
}

describe('tags API', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = buildApp({ db });
    await app.ready();
    insertItem(db, 'a');
    insertItem(db, 'b');
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('creates a tag once and lists it with a count', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/tags',
      payload: { name: 'AI' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/tags',
      payload: { name: 'AI' },
    });
    expect(second.json().id).toBe(first.json().id);

    const list = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(list.json().tags).toEqual([{ id: first.json().id, name: 'AI', count: 0 }]);
  });

  it('assigns tags, replaces them, and auto-creates new names', async () => {
    const assigned = await app.inject({
      method: 'POST',
      url: '/api/items/a/tags',
      payload: { tags: ['AI', '工具'] },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().tags).toEqual(['AI', '工具']);

    const replaced = await app.inject({
      method: 'POST',
      url: '/api/items/a/tags',
      payload: { tags: ['AI'] },
    });
    expect(replaced.json().tags).toEqual(['AI']);

    const list = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(list.json().tags.map((tag: { name: string }) => tag.name).sort()).toEqual(['AI', '工具']);
  });

  it('keeps an unaccepted AI suggestion when tags are edited by hand', async () => {
    db.prepare(
      `UPDATE items SET ai_state = 'suggested', ai_tags = '["AI"]', ai_summary = 'AI 摘要'
       WHERE id = 'a'`,
    ).run();

    const res = await app.inject({
      method: 'POST',
      url: '/api/items/a/tags',
      payload: { tags: ['手工标签'] },
    });

    expect(res.json().tags).toEqual(['手工标签']);
    expect(res.json().ai_state).toBe('suggested');
    expect(res.json().ai_tags).toEqual(['AI']);
    expect(res.json().ai_summary).toBe('AI 摘要');
  });

  it('renames and deletes tags without deleting items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/items/a/tags',
      payload: { tags: ['AI'] },
    });
    const tags = (await app.inject({ method: 'GET', url: '/api/tags' })).json().tags;
    const id = tags[0].id;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/tags/${id}`,
      payload: { name: '人工智能' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('人工智能');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/tags/${id}` });
    expect(deleted.statusCode).toBe(200);

    const item = await app.inject({ method: 'GET', url: '/api/items' });
    expect(item.json().items.map((row: { id: string }) => row.id)).toEqual(['b', 'a']);
    const list = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(list.json().tags).toEqual([]);
  });

  it('counts only live items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/items/a/tags',
      payload: { tags: ['AI'] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/items/b/tags',
      payload: { tags: ['AI'] },
    });
    await app.inject({ method: 'DELETE', url: '/api/items/b' });

    const list = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(list.json().tags[0].count).toBe(1);
  });

  it('edits the confirmed summary', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { summary: '我的摘要' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe('我的摘要');
  });

  it('rejects an empty tag name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tags',
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
