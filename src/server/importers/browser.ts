import { load } from 'cheerio';
import type { Database } from '../db.js';
import { browserId, normalizeUrl } from '../lib/url.js';
import { nowIso } from '../lib/time.js';
import type { ImportStats } from './twitter.js';

export interface BrowserImportOptions {
  now?: string;
}

interface Candidate {
  url: string;
  title: string;
  addedAt: string;
}

export function importBrowser(
  db: Database,
  html: string,
  opts: BrowserImportOptions = {},
): ImportStats {
  const now = opts.now ?? nowIso();
  const $ = load(html);
  const candidates = new Map<string, Candidate>();
  let seen = 0;

  $('a[href]').each((_, element) => {
    seen += 1;
    const normalized = normalizeUrl($(element).attr('href') ?? '');
    if (!normalized) return;

    const rawDate = Number($(element).attr('add_date'));
    const addedAt =
      Number.isFinite(rawDate) && rawDate > 0
        ? new Date(rawDate * 1000).toISOString()
        : now;
    const title =
      $(element).text().replace(/\s+/g, ' ').trim() || new URL(normalized).hostname;

    const existing = candidates.get(normalized);
    if (!existing) {
      candidates.set(normalized, { url: normalized, title, addedAt });
    } else if (addedAt < existing.addedAt) {
      existing.addedAt = addedAt;
      if (!existing.title) existing.title = title;
    }
  });

  const exists = db.prepare('SELECT 1 FROM items WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, metadata)
    VALUES (?, 'browser', ?, ?, ?, ?, 'browser_added', ?, ?)
  `);

  const importedAt = nowIso();
  let inserted = 0;
  const run = db.transaction(() => {
    for (const candidate of candidates.values()) {
      const id = browserId(candidate.url);
      if (exists.get(id)) continue;
      insert.run(
        id,
        candidate.title,
        candidate.url,
        candidate.addedAt,
        candidate.addedAt,
        importedAt,
        JSON.stringify({ body: candidate.title }),
      );
      inserted += 1;
    }
  });
  run();

  return { seen, inserted, updated: 0, skipped: seen - inserted };
}
