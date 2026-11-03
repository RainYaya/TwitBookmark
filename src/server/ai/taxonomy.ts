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
  topics?: string[];
  hostname?: string;
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
    if (Array.isArray(metadata.topics)) {
      sample.topics = metadata.topics
        .filter((topic): topic is string => typeof topic === 'string')
        .slice(0, 10);
    }
  }
  if (row.source === 'browser') {
    try {
      sample.hostname = new URL(row.url).hostname;
    } catch {
      // leave hostname out for malformed URLs
    }
  }
  return sample;
}

export function sampleForTaxonomy(db: Database, limit = 150): SampleItem[] {
  const rows = db
    .prepare(
      `SELECT source, count(*) AS n FROM items
       WHERE deleted_at IS NULL
       GROUP BY source`,
    )
    .all() as Array<{ source: string; n: number }>;
  const counts = new Map(rows.map((row) => [row.source, row.n]));
  const sources = ['twitter', 'browser', 'github'].filter((source) => (counts.get(source) ?? 0) > 0);
  if (sources.length === 0) return [];

  const total = sources.reduce((sum, source) => sum + (counts.get(source) ?? 0), 0);
  const cap = Math.min(limit, total);
  const allocation = new Map<string, number>();
  for (const source of sources) {
    const available = counts.get(source) ?? 0;
    allocation.set(source, Math.min(available, Math.round((available / total) * cap)));
  }

  const floor = Math.min(10, Math.max(1, Math.floor(cap / sources.length)));
  for (const source of sources) {
    const available = counts.get(source) ?? 0;
    if ((allocation.get(source) ?? 0) < Math.min(floor, available)) {
      allocation.set(source, Math.min(floor, available));
    }
  }

  let sum = [...allocation.values()].reduce((left, right) => left + right, 0);
  while (sum < cap) {
    let best: string | null = null;
    let room = 0;
    for (const source of sources) {
      const left = (counts.get(source) ?? 0) - (allocation.get(source) ?? 0);
      if (left > room) {
        best = source;
        room = left;
      }
    }
    if (!best) break;
    allocation.set(best, (allocation.get(best) ?? 0) + 1);
    sum += 1;
  }
  while (sum > cap) {
    let best: string | null = null;
    let size = 0;
    for (const source of sources) {
      const value = allocation.get(source) ?? 0;
      if (value > size && value > 1) {
        best = source;
        size = value;
      }
    }
    if (!best) break;
    allocation.set(best, size - 1);
    sum -= 1;
  }

  const bySource = db.prepare(
    `SELECT id, source, title, url, metadata FROM items
     WHERE deleted_at IS NULL AND source = ?
     ORDER BY RANDOM() LIMIT ?`,
  );
  const samples: SampleItem[] = [];
  for (const source of sources) {
    const take = allocation.get(source) ?? 0;
    if (take === 0) continue;
    for (const row of bySource.all(source, take) as ItemRow[]) samples.push(toSample(row));
  }
  return samples.slice(0, cap);
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
