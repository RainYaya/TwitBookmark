import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

function insertItem(
  db: Database,
  id: string,
  values: { title: string; body?: string; source?: string; status?: string },
) {
  const metadata = JSON.stringify({ body: values.body ?? '' });
  db.prepare(
    `INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'tweet_created', ?, ?, ?)`,
  ).run(
    id,
    values.source ?? 'twitter',
    values.title,
    `https://example.com/${id}`,
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
    '2026-11-02T00:00:00.000Z',
    values.status ?? 'inbox',
    metadata,
  );
}

describe('search', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = buildApp({ db });
    await app.ready();
    insertItem(db, 'agent', {
      title: '关于智能体工作流的思考',
      body: '本地 AI 智能体工具与工作流编排',
    });
    insertItem(db, 'other', { title: '完全无关的影评', body: '这部电影很好看' });
    insertItem(db, 'browser', {
      title: '智能体资源站',
      body: '智能体相关链接',
      source: 'browser',
      status: 'later',
    });
    insertItem(db, 'deleted', {
      title: '已删除的智能体笔记',
      body: '智能体',
    });
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(
      '2026-11-02T00:00:00.000Z',
      'deleted',
    );
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('finds a Chinese substring in live items', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items?q=智能体' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((item: { id: string }) => item.id).sort()).toEqual([
      'agent',
      'browser',
    ]);
  });

  it('supports two character queries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items?q=智能' });
    expect(res.json().items.map((item: { id: string }) => item.id).sort()).toEqual([
      'agent',
      'browser',
    ]);
  });

  it('searches the confirmed summary', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/items/other',
      payload: { summary: '一篇关于代理编排的笔记' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/items?q=代理编排' });
    expect(res.json().items.map((item: { id: string }) => item.id)).toEqual(['other']);
  });

  it('includes the trash only when deleted=1', async () => {
    const live = await app.inject({ method: 'GET', url: '/api/items?q=智能体' });
    expect(live.json().items.map((item: { id: string }) => item.id)).not.toContain('deleted');

    const trash = await app.inject({ method: 'GET', url: '/api/items?q=智能体&deleted=1' });
    expect(trash.json().items.map((item: { id: string }) => item.id)).toEqual(['deleted']);
  });

  it('combines search with source, status and tag filters', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/items/browser/tags',
      payload: { tags: ['资源'] },
    });

    const combined = await app.inject({
      method: 'GET',
      url: '/api/items?q=智能体&source=browser&status=later&tag=资源',
    });
    expect(combined.json().items.map((item: { id: string }) => item.id)).toEqual(['browser']);

    const wrongTag = await app.inject({
      method: 'GET',
      url: '/api/items?q=智能体&tag=不存在',
    });
    expect(wrongTag.json().items).toEqual([]);
  });
});
