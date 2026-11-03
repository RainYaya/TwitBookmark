import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';
import type { ImportStats } from './twitter.js';

export interface GithubRepo {
  full_name: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  html_url?: string;
  topics?: string[];
  updated_at?: string;
}

function flattenPages(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((page) => (Array.isArray(page) ? page : [page]));
}

function isRepo(value: unknown): value is GithubRepo {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'full_name') === 'string' &&
    (Reflect.get(value, 'full_name') as string).length > 0
  );
}

export function importGithubStars(
  db: Database,
  pages: unknown,
  now: string = nowIso(),
): ImportStats {
  const repos = flattenPages(pages).filter(isRepo);
  const stats: ImportStats = { seen: repos.length, inserted: 0, updated: 0, skipped: 0 };
  const exists = db.prepare('SELECT 1 FROM items WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, metadata)
    VALUES (?, 'github', ?, ?, ?, ?, 'first_seen', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      created_at = excluded.created_at,
      metadata = excluded.metadata
  `);

  const run = db.transaction(() => {
    for (const repo of repos) {
      const id = `gh:${repo.full_name}`;
      const url = repo.html_url ?? `https://github.com/${repo.full_name}`;
      const metadata = {
        body: repo.description ?? '',
        description: repo.description ?? '',
        full_name: repo.full_name,
        language: repo.language ?? null,
        stars: repo.stargazers_count ?? 0,
        topics: repo.topics ?? [],
        updated_at: repo.updated_at ?? null,
      };
      const createdAt = repo.updated_at
        ? new Date(repo.updated_at).toISOString()
        : null;
      const existed = Boolean(exists.get(id));
      upsert.run(
        id,
        repo.full_name,
        url,
        createdAt,
        now,
        now,
        JSON.stringify(metadata),
      );
      if (existed) stats.updated += 1;
      else stats.inserted += 1;
    }
  });
  run();

  return stats;
}
