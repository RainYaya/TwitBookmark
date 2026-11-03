import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

type App = ReturnType<typeof buildApp>;

const IMPORTED_AT = '2026-11-02T00:00:00.000Z';

function insertItem(
  db: Database,
  id: string,
  overrides: Partial<{
    source: string;
    title: string;
    url: string;
    saved_at: string;
    status: string;
    saved_source: string;
  }> = {},
) {
  const row = {
    source: 'twitter',
    title: `title ${id}`,
    url: `https://example.com/${id}`,
    saved_at: '2026-11-01T10:00:00.000Z',
    status: 'inbox',
    saved_source: 'tweet_created',
    ...overrides,
  };
  db.prepare(
    `INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.source,
    row.title,
    row.url,
    row.saved_at,
    row.saved_at,
    row.saved_source,
    IMPORTED_AT,
    row.status,
  );
}

describe('items API', () => {
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

  it('lists items newest saved_at first', async () => {
    insertItem(db, 'old', { saved_at: '2026-10-01T10:00:00.000Z' });
    insertItem(db, 'new', { saved_at: '2026-11-02T10:00:00.000Z' });

    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['new', 'old']);
    expect(body.items[0].tags).toEqual([]);
  });

  it('patches status and checkboxes', async () => {
    insertItem(db, 'a');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { status: 'later', read: true, is_todo: true, todo_done: true },
    });

    expect(res.statusCode).toBe(200);
    const item = res.json();
    expect(item).toMatchObject({
      id: 'a',
      status: 'later',
      read: true,
      is_todo: true,
      todo_done: true,
    });

    const row = db.prepare('SELECT status, read FROM items WHERE id = ?').get('a') as {
      status: string;
      read: number;
    };
    expect(row).toEqual({ status: 'later', read: 1 });
  });

  it('rejects unknown patch fields', async () => {
    insertItem(db, 'a');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/items/a',
      payload: { bogus: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('soft-deletes, lists the trash, and restores', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b', { saved_at: '2026-11-02T10:00:00.000Z' });

    const del = await app.inject({ method: 'DELETE', url: '/api/items/a' });
    expect(del.statusCode).toBe(200);

    const live = await app.inject({ method: 'GET', url: '/api/items' });
    expect(live.json().items.map((item: { id: string }) => item.id)).toEqual(['b']);

    const trash = await app.inject({ method: 'GET', url: '/api/items?deleted=1' });
    expect(trash.json().items.map((item: { id: string }) => item.id)).toEqual(['a']);

    const restore = await app.inject({ method: 'POST', url: '/api/items/a/restore' });
    expect(restore.statusCode).toBe(200);

    const back = await app.inject({ method: 'GET', url: '/api/items' });
    expect(back.json().items.map((item: { id: string }) => item.id)).toEqual(['b', 'a']);
    const emptyTrash = await app.inject({ method: 'GET', url: '/api/items?deleted=1' });
    expect(emptyTrash.json().items).toEqual([]);
  });

  it('bulk deletes every given id', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b');
    insertItem(db, 'c');

    const res = await app.inject({
      method: 'POST',
      url: '/api/items/bulk',
      payload: { ids: ['a', 'c'], action: 'delete' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(2);

    const live = await app.inject({ method: 'GET', url: '/api/items' });
    expect(live.json().items.map((item: { id: string }) => item.id)).toEqual(['b']);
  });

  it('filters by source and status', async () => {
    insertItem(db, 'tw', { source: 'twitter', status: 'inbox' });
    insertItem(db, 'br', { source: 'browser', status: 'later' });
    insertItem(db, 'gh', { source: 'github', status: 'later' });

    const later = await app.inject({ method: 'GET', url: '/api/items?status=later' });
    expect(later.json().items.map((item: { id: string }) => item.id).sort()).toEqual(['br', 'gh']);

    const browser = await app.inject({
      method: 'GET',
      url: '/api/items?source=browser&status=later',
    });
    expect(browser.json().items.map((item: { id: string }) => item.id)).toEqual(['br']);
  });

  it('filters by more than one source at once', async () => {
    insertItem(db, 'tw', { source: 'twitter' });
    insertItem(db, 'br', { source: 'browser' });
    insertItem(db, 'gh', { source: 'github' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/items?source=browser&source=github',
    });
    expect(res.json().items.map((item: { id: string }) => item.id).sort()).toEqual(['br', 'gh']);
  });

  it('pages with a cursor', async () => {
    insertItem(db, 'a', { saved_at: '2026-11-01T10:00:00.000Z' });
    insertItem(db, 'b', { saved_at: '2026-11-02T10:00:00.000Z' });
    insertItem(db, 'c', { saved_at: '2026-11-03T10:00:00.000Z' });

    const first = await app.inject({ method: 'GET', url: '/api/items?limit=2' });
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual(['c', 'b']);
    expect(first.json().nextCursor).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: `/api/items?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    });
    expect(second.json().items.map((item: { id: string }) => item.id)).toEqual(['a']);
    expect(second.json().nextCursor).toBeUndefined();
  });

  it('accepts AI suggestions per item without overwriting user edits', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b');
    insertItem(db, 'gone');
    db.prepare(
      `UPDATE items SET ai_state = 'suggested', ai_tags = '["AI","工具"]',
         ai_summary = 'AI 摘要', summary = CASE WHEN id = 'a' THEN '我的摘要' ELSE NULL END,
         deleted_at = CASE WHEN id = 'gone' THEN '2026-11-02T00:00:00.000Z' ELSE NULL END
       WHERE id IN ('a','b','gone')`,
    ).run();
    db.prepare("INSERT INTO tags (name) VALUES ('我的')").run();
    db.prepare("INSERT INTO item_tags (item_id, tag_id) SELECT 'a', id FROM tags WHERE name = '我的'").run();

    const res = await app.inject({
      method: 'POST',
      url: '/api/items/accept-ai',
      payload: { ids: ['a'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1 });

    const a = await app.inject({ method: 'GET', url: '/api/items?q=%E6%88%91%E7%9A%84%E6%91%98%E8%A6%81' });
    const aItem = (a.json().items as Array<{ id: string; tags: string[]; summary: string; ai_state: string }>).find(
      (item) => item.id === 'a',
    )!;
    expect(aItem.tags.sort()).toEqual(['AI', '工具', '我的'].sort());
    expect(aItem.summary).toBe('我的摘要');
    expect(aItem.ai_state).toBe('accepted');

    const all = await app.inject({
      method: 'POST',
      url: '/api/items/accept-ai',
      payload: { source: 'twitter', status: 'inbox' },
    });
    expect(all.json()).toEqual({ updated: 1 });
    const b = await app.inject({ method: 'GET', url: '/api/items?q=AI' });
    const bItem = (b.json().items as Array<{ id: string; tags: string[]; summary: string; ai_state: string }>).find(
      (item) => item.id === 'b',
    )!;
    expect(bItem.tags.sort()).toEqual(['AI', '工具'].sort());
    expect(bItem.summary).toBe('AI 摘要');
    expect(bItem.ai_state).toBe('accepted');

    const stillGone = db.prepare("SELECT ai_state FROM items WHERE id = 'gone'").get() as {
      ai_state: string;
    };
    expect(stillGone.ai_state).toBe('suggested');
  });

  it('restores a batch from the recycle bin', async () => {
    insertItem(db, 'a');
    insertItem(db, 'b');
    for (const id of ['a', 'b']) {
      await app.inject({ method: 'DELETE', url: `/api/items/${id}` });
    }

    const restored = await app.inject({
      method: 'POST',
      url: '/api/items/bulk',
      payload: { ids: ['a', 'b'], action: 'restore' },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({ updated: 2 });

    const listed = await app.inject({ method: 'GET', url: '/api/items' });
    expect(listed.json().items.map((item: { id: string }) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('returns 404 for unknown items', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/items/nope',
      payload: { status: 'done' },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: '/api/items/nope' });
    expect(del.statusCode).toBe(404);
  });
});
