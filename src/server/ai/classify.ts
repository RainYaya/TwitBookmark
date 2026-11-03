import { z } from 'zod';
import type { Database } from '../db.js';
import type { ChatMessage, LanguageModelClient } from './lmstudio.js';
import { parseModelJson, type TaxonomyTag } from './taxonomy.js';

export interface ClassifyOptions {
  db: Database;
  client: LanguageModelClient;
  taxonomy: TaxonomyTag[];
  batchSize?: number;
  shouldPause?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface ClassifyResult {
  processed: number;
  paused: boolean;
  unknownTags: number;
}

interface PendingRow {
  id: string;
  title: string;
  url: string;
  source: string;
  metadata: string;
}

const resultsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      tags: z.array(z.string()).default([]),
      summary: z.string().default(''),
    }),
  ),
});

function payloadFor(row: PendingRow) {
  const item: Record<string, string> = { id: row.id, title: row.title, url: row.url };
  if (row.source === 'github') {
    try {
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      if (typeof metadata.description === 'string') item.description = metadata.description;
      if (typeof metadata.language === 'string') item.language = metadata.language;
    } catch {
      // metadata is optional
    }
  }
  return item;
}

export async function classifyItems(options: ClassifyOptions): Promise<ClassifyResult> {
  const { db, client, taxonomy } = options;
  const batchSize = options.batchSize ?? 30;
  const allowed = new Set(taxonomy.map((tag) => tag.name));

  const pending = db
    .prepare(
      `SELECT id, title, url, source, metadata FROM items
       WHERE deleted_at IS NULL AND ai_state = 'none'
       ORDER BY saved_at DESC, id DESC`,
    )
    .all() as PendingRow[];

  const update = db.prepare(
    `UPDATE items SET ai_tags = ?, ai_summary = ?, ai_state = 'suggested'
     WHERE id = ? AND ai_state != 'accepted'`,
  );

  let processed = 0;
  let unknownTags = 0;

  for (let start = 0; start < pending.length; start += batchSize) {
    if (options.shouldPause?.()) {
      return { processed, paused: true, unknownTags };
    }

    const batch = pending.slice(start, start + batchSize);
    const taxonomyList = taxonomy
      .map((tag) => `- ${tag.name}：${tag.description || '无定义'}`)
      .join('\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是个人书签分类助手。为每条书签从给定的标签表中选择 1–3 个标签，并写一句不超过 120 字的中文摘要。' +
          '只能使用标签表里的标签，不要创造新标签。只输出 JSON，不要解释。\n' +
          `可用标签：\n${taxonomyList}\n` +
          '输出格式：{"results":[{"id":"条目 id","tags":["标签"],"summary":"摘要"}]}',
      },
      {
        role: 'user',
        content: JSON.stringify({ items: batch.map(payloadFor) }),
      },
    ];

    const text = await client.chat(messages);
    const parsed = resultsSchema.parse(parseModelJson(text));
    const batchIds = new Set(batch.map((row) => row.id));

    db.transaction(() => {
      for (const result of parsed.results) {
        if (!batchIds.has(result.id)) continue;
        const kept = result.tags.filter((tag) => allowed.has(tag));
        unknownTags += result.tags.length - kept.length;
        const summary = result.summary.trim().slice(0, 120);
        update.run(JSON.stringify(kept.slice(0, 3)), summary.length > 0 ? summary : null, result.id);
      }
    })();

    processed += batch.length;
    options.onProgress?.(processed, pending.length);
  }

  return { processed, paused: false, unknownTags };
}
