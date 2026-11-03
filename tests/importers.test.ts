import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createDb } from '../src/server/db.js';
import { normalizeUrl, browserId } from '../src/server/lib/url.js';
import {
  parseTwitterExport,
  importTwitter,
  type TwitterEntry,
} from '../src/server/importers/twitter.js';
import { importBrowser } from '../src/server/importers/browser.js';
import { importGithubStars } from '../src/server/importers/github.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('normalizeUrl', () => {
  it('lowercases the host and drops default ports, trailing slashes and trackers', () => {
    expect(
      normalizeUrl('HTTPS://Example.COM:443/a/?utm_source=x&b=2&a=1&fbclid=y#frag'),
    ).toBe('https://example.com/a?a=1&b=2#frag');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com:80')).toBe('http://example.com');
  });

  it('keeps meaningful query parameters and rejects non-http links', () => {
    expect(normalizeUrl('https://example.com/watch?v=abc&t=10')).toBe(
      'https://example.com/watch?t=10&v=abc',
    );
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('derives a stable 12 character browser id', () => {
    expect(browserId('https://example.com/a')).toMatch(/^[0-9a-f]{12}$/);
    expect(browserId('https://example.com/a')).toBe(browserId('https://example.com/a'));
  });
});

describe('importBrowser', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => db.close());

  it('dedupes tracking variants and keeps the earliest ADD_DATE', () => {
    const stats = importBrowser(db, fixture('browser.html'), {
      now: '2026-11-02T00:00:00.000Z',
    });

    expect(stats).toMatchObject({ seen: 5, inserted: 3, updated: 0, skipped: 2 });
    const rows = db
      .prepare('SELECT id, title, url, saved_at, source, saved_source FROM items ORDER BY url')
      .all() as Array<{
      id: string;
      title: string;
      url: string;
      saved_at: string;
      source: string;
      saved_source: string;
    }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      title: 'Example A',
      url: 'https://example.com/a?a=1&b=2',
      saved_at: '1970-01-01T00:01:40.000Z',
      source: 'browser',
      saved_source: 'browser_added',
    });
    expect(rows.find((row) => row.url === 'https://example.net/no-date')?.saved_at).toBe(
      '2026-11-02T00:00:00.000Z',
    );
  });

  it('is idempotent', () => {
    importBrowser(db, fixture('browser.html'));
    const second = importBrowser(db, fixture('browser.html'));
    expect(second.inserted).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 3 });
  });
});

describe('importTwitter', () => {
  let db: Database;
  let mediaDir: string;

  beforeEach(() => {
    db = createDb(':memory:');
    mediaDir = mkdtempSync(join(tmpdir(), 'twitbookmark-media-'));
  });

  afterEach(() => {
    db.close();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  const entries = () => parseTwitterExport(JSON.parse(fixture('twitter.json')));
  const download = async () => Buffer.from('image-bytes');

  it('uses the tweet publish time as saved_at and keeps source metadata', async () => {
    const stats = await importTwitter(db, entries(), { mediaDir, download });
    expect(stats).toMatchObject({ seen: 2, inserted: 2, updated: 0, skipped: 0 });

    const row = db.prepare('SELECT * FROM items WHERE id = ?').get('tw:111') as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      source: 'twitter',
      saved_source: 'tweet_created',
      saved_at: '2026-11-01T00:30:00.000Z',
      created_at: '2026-11-01T00:30:00.000Z',
      url: 'https://x.com/alice/status/111',
    });
    const metadata = JSON.parse(row.metadata as string);
    expect(metadata.body).toContain('本地 AI 工具');
    expect(metadata.screen_name).toBe('alice');
    expect(metadata.media[0].thumb).toMatch(/\.jpg$/);
    expect(existsSync(join(mediaDir, metadata.media[0].thumb.split(/[\\/]/).pop()))).toBe(true);
    expect(metadata.avatar_url).toMatch(/^media\//);
    expect(existsSync(join(mediaDir, metadata.avatar_url.split(/[\\/]/).pop()))).toBe(true);
  });

  it('updates text on re-import without changing the date or the item count', async () => {
    await importTwitter(db, entries(), { mediaDir, download });

    const changed = entries();
    changed[0].full_text = '更新后的正文';
    const stats = await importTwitter(db, changed, { mediaDir, download });

    expect(stats).toMatchObject({ seen: 2, inserted: 0, updated: 2, skipped: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 2 });
    const row = db.prepare('SELECT title, saved_at, metadata FROM items WHERE id = ?').get(
      'tw:111',
    ) as { title: string; saved_at: string; metadata: string };
    expect(row.title).toBe('更新后的正文');
    expect(row.saved_at).toBe('2026-11-01T00:30:00.000Z');
    expect(JSON.parse(row.metadata).body).toBe('更新后的正文');
  });

  it('keeps the item when the media download fails', async () => {
    const stats = await importTwitter(db, entries(), {
      mediaDir,
      download: async () => null,
    });
    expect(stats.inserted).toBe(2);
    const row = db.prepare('SELECT metadata FROM items WHERE id = ?').get('tw:111') as {
      metadata: string;
    };
    expect(JSON.parse(row.metadata).media[0].thumb).toBeNull();
    expect(JSON.parse(row.metadata).media[0].original).toContain('pbs.twimg.com');
    expect(JSON.parse(row.metadata).avatar_url).toBeNull();
  });
});

describe('importGithubStars', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => db.close());

  it('flattens paginated pages and marks first_seen', () => {
    const pages = JSON.parse(fixture('github.json'));
    const stats = importGithubStars(db, pages, '2026-11-02T12:00:00.000Z');

    expect(stats).toMatchObject({ seen: 2, inserted: 2, updated: 0, skipped: 0 });
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get('gh:owner/one') as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      source: 'github',
      title: 'owner/one',
      url: 'https://github.com/owner/one',
      saved_at: '2026-11-02T12:00:00.000Z',
      saved_source: 'first_seen',
      created_at: '2026-10-20T08:00:00.000Z',
    });
    expect(JSON.parse(row.metadata as string).language).toBe('TypeScript');
  });

  it('keeps saved_at and locally deleted rows across syncs', () => {
    const pages = JSON.parse(fixture('github.json'));
    importGithubStars(db, pages, '2026-11-02T12:00:00.000Z');
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(
      '2026-11-02T13:00:00.000Z',
      'gh:owner/two',
    );

    const stats = importGithubStars(db, pages, '2026-11-03T12:00:00.000Z');
    expect(stats).toMatchObject({ inserted: 0, updated: 2 });
    const rows = db
      .prepare('SELECT id, saved_at, deleted_at FROM items ORDER BY id')
      .all() as Array<{ id: string; saved_at: string; deleted_at: string | null }>;
    expect(rows[0].saved_at).toBe('2026-11-02T12:00:00.000Z');
    expect(rows[1].deleted_at).toBe('2026-11-02T13:00:00.000Z');
  });
});
