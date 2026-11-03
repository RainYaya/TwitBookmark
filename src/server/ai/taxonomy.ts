import { z } from 'zod';
import type { Database } from '../db.js';
import type { ChatMessage, LanguageModelClient } from './lmstudio.js';

export interface TaxonomyTag {
  name: string;
  description: string;
}

export interface SampleItem {
  id: string;
  source: string;
  title: string;
  url: string;
  description?: string;
  language?: string;
}

interface ItemRow {
  id: string;
  source: string;
  title: string;
  url: string;
  metadata: string;
}

function toSample(row: ItemRow): SampleItem {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  const sample: SampleItem = {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
  };
  if (row.source === 'github') {
    if (typeof metadata.description === 'string') sample.description = metadata.description;
    if (typeof metadata.language === 'string') sample.language = metadata.language;
  }
  return sample;
}

export function sampleForTaxonomy(db: Database, limit = 50): SampleItem[] {
  const perSource = Math.ceil(limit / 3);
  const bySource = db.prepare(
    `SELECT id, source, title, url, metadata FROM items
     WHERE deleted_at IS NULL AND source = ?
     ORDER BY RANDOM() LIMIT ?`,
  );
  const chosen = new Map<string, SampleItem>();
  for (const source of ['twitter', 'browser', 'github']) {
    for (const row of bySource.all(source, perSource) as ItemRow[]) {
      if (chosen.size >= limit) break;
      chosen.set(row.id, toSample(row));
    }
  }

  if (chosen.size < limit) {
    const extra = db.prepare(
      `SELECT id, source, title, url, metadata FROM items
       WHERE deleted_at IS NULL
       ORDER BY RANDOM() LIMIT ?`,
    ).all(limit) as ItemRow[];
    for (const row of extra) {
      if (chosen.size >= limit) break;
      if (!chosen.has(row.id)) chosen.set(row.id, toSample(row));
    }
  }

  return [...chosen.values()];
}

export function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

const proposalSchema = z
  .object({
    tags: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(20),
            description: z.string().trim().max(200).default(''),
          })
          .strict(),
      )
      .min(5)
      .max(20),
  })
  .strict();

export async function proposeTaxonomy(
  client: LanguageModelClient,
  samples: SampleItem[],
): Promise<TaxonomyTag[]> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是个人书签整理助手。根据给出的书签样本，提出 10–15 个中文主题标签，每个标签配一句简短定义。' +
        '标签要覆盖常见主题：AI 与智能体、编程开发、工具效率、逆向安全、游戏模拟器、学习教程、阅读写作、影音动漫、生活消费、资源下载、账号入口、备查等。' +
        '不要输出工作流状态（如待读、待办）。只输出 JSON，不要解释。',
    },
    {
      role: 'user',
      content: JSON.stringify({ items: samples }),
    },
  ];

  const text = await client.chat(messages);
  let parsed: z.infer<typeof proposalSchema>;
  try {
    parsed = proposalSchema.parse(parseModelJson(text));
  } catch {
    throw new Error('模型返回的标签格式不正确');
  }

  const seen = new Set<string>();
  return parsed.tags.filter((tag) => {
    const key = tag.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
