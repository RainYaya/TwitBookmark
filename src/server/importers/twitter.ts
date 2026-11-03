import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';

export interface ImportStats {
  seen: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface TwitterMedia {
  type?: string;
  url?: string;
  thumbnail?: string;
  original?: string;
}

export interface TwitterEntry {
  id: string;
  created_at: string;
  full_text?: string;
  media?: TwitterMedia[];
  screen_name?: string;
  name?: string;
  profile_image_url?: string;
  url?: string;
  favorite_count?: number;
  retweet_count?: number;
  bookmark_count?: number;
  views_count?: number;
}

export interface TwitterImportOptions {
  mediaDir?: string;
  download?: (url: string) => Promise<Buffer | null>;
}

export function parseTwitterExport(input: unknown): TwitterEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === 'object' && Reflect.get(entry, 'id') != null,
    )
    .map((entry) => {
      const id = entry.id;
      const createdAt = entry.created_at;
      return {
        ...entry,
        id: typeof id === 'number' ? String(id) : String(id),
        created_at: typeof createdAt === 'string' ? createdAt : '',
      } as TwitterEntry;
    })
    .filter((entry) => entry.id !== '' && entry.created_at !== '');
}

export function tweetDateToIso(raw: string): string | null {
  let value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    value = value.replace(' ', 'T').replace(/ ([+-]\d{2}:\d{2})$/, '$1');
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function extensionFor(url: string): string {
  try {
    const parsed = new URL(url);
    const format = parsed.searchParams.get('format');
    if (format) {
      const cleaned = format.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (cleaned) return cleaned;
    }
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // fall through
  }
  return 'jpg';
}

async function downloadMedia(
  url: string,
  mediaDir: string,
  download: (url: string) => Promise<Buffer | null>,
): Promise<string | null> {
  const filename = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${extensionFor(url)}`;
  const absolute = join(mediaDir, filename);
  if (existsSync(absolute)) return `media/${filename}`;
  const buffer = await download(url);
  if (!buffer) return null;
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(absolute, buffer);
  return `media/${filename}`;
}

function makeTitle(entry: TwitterEntry): string {
  const text = (entry.full_text ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return entry.screen_name ? `@${entry.screen_name}` : entry.id;
}

export async function importTwitter(
  db: Database,
  entries: TwitterEntry[],
  opts: TwitterImportOptions = {},
): Promise<ImportStats> {
  const mediaDir = opts.mediaDir ?? 'data/media';
  const download = opts.download ?? fetchBuffer;
  const importedAt = nowIso();
  const stats: ImportStats = { seen: 0, inserted: 0, updated: 0, skipped: 0 };
  const exists = db.prepare('SELECT 1 FROM items WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, metadata)
    VALUES (?, 'twitter', ?, ?, ?, ?, 'tweet_created', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      created_at = excluded.created_at,
      metadata = excluded.metadata
  `);

  for (const entry of entries) {
    stats.seen += 1;
    const savedAt = tweetDateToIso(entry.created_at);
    if (!savedAt) {
      stats.skipped += 1;
      continue;
    }

    const media: Array<{ type: string; thumb: string | null; original: string | null }> = [];
    for (const item of entry.media ?? []) {
      const source = item.thumbnail ?? item.original ?? item.url;
      if (!source) continue;
      const thumb = await downloadMedia(source, mediaDir, download);
      media.push({
        type: item.type ?? 'photo',
        thumb,
        original: item.original ?? item.url ?? null,
      });
    }

    const avatar = entry.profile_image_url
      ? await downloadMedia(entry.profile_image_url, mediaDir, download)
      : null;

    const metadata = {
      body: entry.full_text ?? '',
      screen_name: entry.screen_name ?? null,
      name: entry.name ?? null,
      avatar_url: avatar,
      media,
      favorite_count: entry.favorite_count ?? 0,
      retweet_count: entry.retweet_count ?? 0,
      bookmark_count: entry.bookmark_count ?? 0,
      views_count: entry.views_count ?? 0,
    };
    const url = entry.url ?? `https://x.com/${entry.screen_name ?? 'i'}/status/${entry.id}`;
    const id = `tw:${entry.id}`;
    const existed = Boolean(exists.get(id));
    upsert.run(
      id,
      makeTitle(entry),
      url,
      savedAt,
      savedAt,
      importedAt,
      JSON.stringify(metadata),
    );
    if (existed) stats.updated += 1;
    else stats.inserted += 1;
  }

  return stats;
}
