import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

type App = ReturnType<typeof buildApp>;

const AT = '2026-11-02T00:00:00.000Z';

function insertItem(
  db: Database,
  id: string,
  overrides: Partial<{
    source: string;
    status: string;
    ai_state: string;
    deleted_at: string | null;
  }> = {},
) {
  const row = {
    source: 'browser',
    status: 'inbox',
    ai_state: 'none',
    deleted_at: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO items (id, source, title, url, saved_at, imported_at, status, ai_state, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.source,
    `title ${id}`,
    `https://example.com/${id}`,
    AT,
    AT,
    row.status,
    row.ai_state,
    row.deleted_at,
  );
}

describe('collections and facets API', () => {
  let db: Database;
  let app: App;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('creates, renames and lists collections with live counts', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b', { deleted_at: AT });

    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: 'OCR 项目' },
    });
    expect(created.statusCode).toBe(200);
    const collection = created.json() as { id: string; name: string };
    expect(collection.name).toBe('OCR 项目');

    await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { collection_id: collection.id },
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/collections/${collection.id}`,
      payload: { name: '文档识别' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: '文档识别', count: 1 });

    const list = await app.inject({ method: 'GET', url: '/api/collections' });
    expect(list.json()).toEqual({
      collections: [
        expect.objectContaining({ id: collection.id, name: '文档识别', count: 1 }),
      ],
    });
  });

  it('rejects duplicate collection names', async () => {
    await app.inject({ method: 'POST', url: '/api/collections', payload: { name: '前端' } });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: '前端' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('filters items by collection and by unfiled', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b');
    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: '工具' },
    });
    const id = (created.json() as { id: string }).id;
    await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { collection_id: id },
    });

    const inside = await app.inject({
      method: 'GET',
      url: `/api/items?collection=${id}`,
    });
    expect((inside.json() as { items: Array<{ id: string }> }).items.map((row) => row.id)).toEqual([
      'a',
    ]);

    const unfiled = await app.inject({ method: 'GET', url: '/api/items?collection=none' });
    expect((unfiled.json() as { items: Array<{ id: string }> }).items.map((row) => row.id)).toEqual([
      'b',
    ]);
  });

  it('clears the collection when it is deleted', async () => {
    insertItem(db, 'a');
    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: '临时' },
    });
    const id = (created.json() as { id: string }).id;
    await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { collection_id: id },
    });

    const removed = await app.inject({ method: 'DELETE', url: `/api/collections/${id}` });
    expect(removed.statusCode).toBe(200);

    const item = await app.inject({ method: 'GET', url: '/api/items' });
    expect(
      (item.json() as { items: Array<{ id: string; collection_id: string | null }> }).items[0],
    ).toMatchObject({ id: 'a', collection_id: null });
  });

  it('filters items by AI state', async () => {
    insertItem(db, 'suggested', { ai_state: 'suggested' });
    insertItem(db, 'accepted', { ai_state: 'accepted' });

    const response = await app.inject({ method: 'GET', url: '/api/items?ai=suggested' });
    expect(
      (response.json() as { items: Array<{ id: string }> }).items.map((row) => row.id),
    ).toEqual(['suggested']);
  });

  it('filters items that have a personal note', async () => {
    insertItem(db, 'noted');
    insertItem(db, 'plain');
    db.prepare("UPDATE items SET summary = '安卓和 Windows 通信' WHERE id = 'noted'").run();

    const response = await app.inject({ method: 'GET', url: '/api/items?noted=1' });
    expect(
      (response.json() as { items: Array<{ id: string; summary: string }> }).items.map(
        (row) => row.id,
      ),
    ).toEqual(['noted']);

    const facets = await app.inject({ method: 'GET', url: '/api/facets' });
    expect(facets.json()).toMatchObject({ noted: 1 });
  });

  it('returns global counts for the sidebar', async () => {
    insertItem(db, 'a', { source: 'browser', status: 'inbox', ai_state: 'suggested' });
    insertItem(db, 'b', { source: 'github', status: 'later' });
    insertItem(db, 'c', { source: 'twitter', status: 'inbox' });
    insertItem(db, 'gone', { status: 'inbox', deleted_at: AT });
    db.prepare("INSERT INTO tags (name) VALUES ('OCR与文档')").run();
    db.prepare(
      "INSERT INTO item_tags (item_id, tag_id) SELECT 'a', id FROM tags WHERE name = 'OCR与文档'",
    ).run();

    const response = await app.inject({ method: 'GET', url: '/api/facets' });
    expect(response.json()).toMatchObject({
      total: 3,
      deleted: 1,
      untagged: 2,
      aiSuggested: 1,
      statuses: { inbox: 2, later: 1, done: 0, reference: 0 },
      sources: { twitter: 1, browser: 1, github: 1 },
      tags: [{ name: 'OCR与文档', count: 1 }],
      collections: [],
    });
  });
});
