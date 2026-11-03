import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';
import type { LanguageModelClient } from '../src/server/ai/lmstudio.js';

describe('settings, scan and runtime endpoints', () => {
  let db: Database;
  let dir: string;

  beforeEach(() => {
    db = createDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'twitbookmark-imports-'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('roundtrips settings and rejects unknown keys', async () => {
    const app = buildApp({ db });
    await app.ready();

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_base_url: 'http://localhost:1234/v1' } },
    });
    expect(put.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(got.json().settings.lmstudio_base_url).toBe('http://localhost:1234/v1');

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { unknown: 'x' } },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('scans the imports folder and ignores directories', async () => {
    writeFileSync(join(dir, 'b.html'), '<html></html>');
    writeFileSync(join(dir, 'a.json'), '[]');
    writeFileSync(join(dir, 'c.txt'), 'notes');
    mkdirSync(join(dir, 'nested'));

    const app = buildApp({ db, importsDir: dir });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/import/scan' });
    expect(res.statusCode).toBe(200);
    const files = res.json().files as Array<{
      name: string;
      size: number;
      modified_at: string;
      kind: string;
    }>;
    expect(files.map((file) => file.name)).toEqual(['a.json', 'b.html', 'c.txt']);
    expect(files[0]).toMatchObject({ kind: 'twitter', size: 2 });
    expect(files[1].kind).toBe('browser');
    expect(files[2].kind).toBe('other');
    expect(Number.isNaN(Date.parse(files[0].modified_at))).toBe(false);
    await app.close();
  });

  it('accepts browser exports larger than the default body limit', async () => {
    const padding = `<DT><A HREF="https://example.com/big">Big</A>${' '.repeat(1_200_000)}`;
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>${padding}</DL><p>`;
    const app = buildApp({ db });
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/browser',
      payload: { html },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inserted: 1 });
    await app.close();
  });

  it('lists LM Studio models through the client factory', async () => {
    const model: LanguageModelClient = {
      listModels: vi.fn(async () => ['qwen', 'llama']),
      chat: vi.fn(async () => ''),
    };
    const app = buildApp({ db, lmClientFactory: () => model });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/ai/models' });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toEqual(['qwen', 'llama']);
    await app.close();
  });

  it('reports GitHub sync counts', async () => {
    const app = buildApp({
      db,
      ghRunner: async () => [
        [
          {
            full_name: 'owner/one',
            description: 'x',
            language: 'TypeScript',
            stargazers_count: 1,
            html_url: 'https://github.com/owner/one',
            topics: [],
            updated_at: '2026-10-01T00:00:00Z',
          },
        ],
      ],
    });
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/sync/github' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inserted: 1, fetched: 1 });
    await app.close();
  });
});
