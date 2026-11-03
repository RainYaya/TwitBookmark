import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('import routes', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;

  const tweets = [
    {
      id: '1',
      created_at: '2026-11-01 09:30:00 +09:00',
      full_text: '第一批书签',
      media: [],
      screen_name: 'alice',
      url: 'https://x.com/alice/status/1',
    },
  ];

  beforeEach(async () => {
    db = createDb(':memory:');
    app = buildApp({
      db,
      ghRunner: async () => JSON.parse(fixture('github.json')),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('imports twitter JSON and is idempotent', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/import/twitter',
      payload: { json: tweets },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ inserted: 1, updated: 0 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/import/twitter',
      payload: { json: tweets },
    });
    expect(second.json()).toMatchObject({ inserted: 0, updated: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 });
  });

  it('imports browser HTML', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/browser',
      payload: { html: fixture('browser.html') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inserted: 3 });
  });

  it('syncs GitHub stars through the injected runner', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync/github' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inserted: 2, fetched: 2 });
  });

  it('rejects a request with no payload', async () => {
    const twitter = await app.inject({
      method: 'POST',
      url: '/api/import/twitter',
      payload: {},
    });
    expect(twitter.statusCode).toBe(400);

    const browser = await app.inject({
      method: 'POST',
      url: '/api/import/browser',
      payload: {},
    });
    expect(browser.statusCode).toBe(400);
  });
});
