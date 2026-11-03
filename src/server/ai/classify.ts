import { z } from 'zod';
import type { Database } from '../db.js';
import type { ChatMessage, LanguageModelClient } from './lmstudio.js';
import { parseModelJson, type TaxonomyTag } from './taxonomy.js';

export interface ItemRow {
  id: string;
  title: string;
  url: string;
  source: string;
  metadata: string;
}

export type ContextLoader = (row: ItemRow) => Promise<string | null>;

export interface ClassifyOptions {
  db: Database;
  client: LanguageModelClient;
  taxonomy: TaxonomyTag[];
  batchSize?: number;
  maxChars?: number;
  contextChars?: number;
  contextFor?: ContextLoader;
  shouldPause?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface ClassifyResult {
  processed: number;
  paused: boolean;
  unknownTags: number;
  unmatched: number;
  proposedTags: TaxonomyTag[];
}

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_MAX_CHARS = 7000;
const DEFAULT_CONTEXT_CHARS = 1000;
const CONTEXT_CONCURRENCY = 4;

const proposedTagSchema = z.object({
  name: z.string().trim().min(1).max(20),
  description: z.string().trim().max(200).default(''),
});

const resultsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      tags: z.array(z.string()).default([]),
      newTags: z.array(proposedTagSchema).default([]),
      summary: z.string().default(''),
    }),
  ),
});

function metadataOf(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function payloadFor(row: ItemRow, context: string | null, contextChars: number) {
  const metadata = metadataOf(row.metadata);
  const item: Record<string, unknown> = { id: row.id, title: row.title, url: row.url };

  if (row.source === 'github') {
    if (typeof metadata.description === 'string' && metadata.description.length > 0) {
      item.description = metadata.description;
    }
    if (typeof metadata.language === 'string' && metadata.language.length > 0) {
      item.language = metadata.language;
    }
    if (Array.isArray(metadata.topics)) {
      item.topics = metadata.topics
        .filter((topic): topic is string => typeof topic === 'string')
        .slice(0, 10);
    }
  }

  const fetched = typeof context === 'string' ? context.trim() : '';
  if (fetched.length > 0) {
    item.text = fetched.slice(0, contextChars);
  } else if (row.source === 'twitter') {
    const body = typeof metadata.body === 'string' ? metadata.body.trim() : '';
    if (body.length > 0) item.text = body.slice(0, 300);
  }

  return item;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface Entry {
  row: ItemRow;
  payload: Record<string, unknown>;
  size: number;
}

function chunkEntries(entries: Entry[], maxChars: number, maxItems: number): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  let size = 0;
  for (const entry of entries) {
    if (current.length > 0 && (current.length >= maxItems || size + entry.size > maxChars)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += entry.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function classifyItems(options: ClassifyOptions): Promise<ClassifyResult> {
  const { db, client, taxonomy } = options;
  const maxItems = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const contextChars = options.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const allowed = new Set(taxonomy.map((tag) => tag.name));

  const pending = db
    .prepare(
      `SELECT id, title, url, source, metadata FROM items
       WHERE deleted_at IS NULL AND ai_state = 'none'
       ORDER BY saved_at DESC, id DESC`,
    )
    .all() as ItemRow[];

  const update = db.prepare(
    `UPDATE items SET ai_tags = ?, ai_summary = ?, ai_state = 'suggested'
     WHERE id = ? AND ai_state != 'accepted'`,
  );

  let processed = 0;
  let unknownTags = 0;
  let unmatched = 0;
  const proposed = new Map<string, { tag: TaxonomyTag; count: number }>();

  const finalProposals = (): TaxonomyTag[] =>
    [...proposed.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 10)
      .map((entry) => entry.tag);

  for (let start = 0; start < pending.length; ) {
    if (processed > 0 && options.shouldPause?.()) {
      return { processed, paused: true, unknownTags, unmatched, proposedTags: finalProposals() };
    }

    const window = pending.slice(start, start + maxItems);
    start += window.length;

    const contexts = await mapLimit(window, CONTEXT_CONCURRENCY, async (row) => {
      if (!options.contextFor) return null;
      try {
        return await options.contextFor(row);
      } catch {
        return null;
      }
    });

    const entries: Entry[] = window.map((row, index) => {
      const payload = payloadFor(row, contexts[index] ?? null, contextChars);
      return { row, payload, size: JSON.stringify(payload).length };
    });

    for (const chunk of chunkEntries(entries, maxChars, maxItems)) {
      if (options.shouldPause?.()) {
        return { processed, paused: true, unknownTags, unmatched, proposedTags: finalProposals() };
      }

      const taxonomyList = taxonomy
        .map((tag) => `- ${tag.name}：${tag.description || '无定义'}`)
        .join('\n');
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            '你是个人书签整理助手。阅读每条书签的标题、链接以及附带的正文或 README 片段，判断它是什么、属于哪一类。' +
            '从给定标签表中选择 1–3 个标签，并用一句不超过 120 字的中文说明它是做什么的；不要评价质量，不要照抄标题。' +
            'tags 只能使用标签表里的标签；如果某条与现有标签都不匹配，不要硬塞，tags 返回空数组，并在 newTags 里给出一个建议的新标签（名称不超过 20 字，配一句简短定义）。' +
            '只输出 JSON，不要解释。\n' +
            `可用标签：\n${taxonomyList}\n` +
            '输出格式：{"results":[{"id":"条目 id","tags":["标签"],"newTags":[{"name":"新标签","description":"一句定义"}],"summary":"说明"}]}',
        },
        {
          role: 'user',
          content: JSON.stringify({ items: chunk.map((entry) => entry.payload) }),
        },
      ];

      const text = await client.chat(messages);
      const parsed = resultsSchema.parse(parseModelJson(text));
      const chunkIds = new Set(chunk.map((entry) => entry.row.id));

      db.transaction(() => {
        for (const result of parsed.results) {
          if (!chunkIds.has(result.id)) continue;
          const kept = result.tags.filter((tag) => allowed.has(tag));
          unknownTags += result.tags.length - kept.length;
          if (kept.length === 0) {
            unmatched += 1;
            const candidates = [
              ...result.newTags,
              ...result.tags.map((name) => ({ name, description: '' })),
            ];
            for (const candidate of candidates) {
              const name = candidate.name.trim();
              if (!name || allowed.has(name)) continue;
              const key = name.toLowerCase();
              const existing = proposed.get(key);
              if (existing) {
                existing.count += 1;
                if (!existing.tag.description && candidate.description.trim()) {
                  existing.tag.description = candidate.description.trim();
                }
              } else {
                proposed.set(key, {
                  tag: { name, description: candidate.description.trim() },
                  count: 1,
                });
              }
            }
            continue;
          }
          const summary = result.summary.trim().slice(0, 120);
          update.run(
            JSON.stringify(kept.slice(0, 3)),
            summary.length > 0 ? summary : null,
            result.id,
          );
        }
      })();

      processed += chunk.length;
      options.onProgress?.(processed, pending.length);
    }
  }

  return { processed, paused: false, unknownTags, unmatched, proposedTags: finalProposals() };
}
