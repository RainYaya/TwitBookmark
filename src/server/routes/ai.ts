import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';
import { LmStudioClient, type LanguageModelClient } from '../ai/lmstudio.js';
import { proposeTaxonomy, sampleForTaxonomy, type TaxonomyTag } from '../ai/taxonomy.js';
import { classifyItems } from '../ai/classify.js';
import { itemContext } from '../ai/context.js';
import { readSettings, writeSetting } from './settings.js';

export type LmClientFactory = (settings: {
  baseUrl: string;
  model: string;
}) => LanguageModelClient;

const defaultFactory: LmClientFactory = ({ baseUrl, model }) =>
  new LmStudioClient({ baseUrl, model });

interface AiConfig {
  baseUrl: string;
  model: string;
  taxonomy: TaxonomyTag[];
}

function parseTaxonomy(raw: string | undefined): TaxonomyTag[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is TaxonomyTag =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as TaxonomyTag).name === 'string' &&
          typeof (entry as TaxonomyTag).description === 'string',
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

function configOf(db: Database): AiConfig {
  const settings = readSettings(db);
  return {
    baseUrl: settings.lmstudio_base_url || 'http://localhost:1234/v1',
    model: settings.lmstudio_model || '',
    taxonomy: parseTaxonomy(settings.taxonomy),
  };
}

function countPending(db: Database): number {
  const row = db
    .prepare("SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND ai_state = 'none'")
    .get() as { n: number };
  return row.n;
}

function getJob(db: Database, id: string) {
  return db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as
    | {
        id: string;
        kind: string;
        status: string;
        total: number;
        done: number;
        error: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendProposedTags(db: Database, proposed: TaxonomyTag[]): number {
  if (proposed.length === 0) return 0;
  const settings = readSettings(db);
  const fromProposal = parseTaxonomy(settings.taxonomy_proposal);
  const current = fromProposal.length > 0 ? fromProposal : parseTaxonomy(settings.taxonomy);
  const names = new Set(current.map((tag) => tag.name));
  let added = 0;
  for (const tag of proposed) {
    if (names.has(tag.name)) continue;
    names.add(tag.name);
    current.push(tag);
    added += 1;
  }
  if (added > 0) writeSetting(db, 'taxonomy_proposal', JSON.stringify(current));
  return added;
}

function startClassification(
  db: Database,
  jobId: string,
  config: AiConfig,
  factory: LmClientFactory,
): void {
  void (async () => {
    try {
      const client = factory({ baseUrl: config.baseUrl, model: config.model });
      const result = await classifyItems({
        db,
        client,
        taxonomy: config.taxonomy,
        contextFor: (row) => itemContext(row),
        shouldPause: () => getJob(db, jobId)?.status === 'paused',
        onProgress: (done, total) => {
          db.prepare(
            'UPDATE ai_jobs SET done = ?, total = ?, updated_at = ? WHERE id = ?',
          ).run(done, total, nowIso(), jobId);
        },
      });
      if (result.paused) return;
      const added = appendProposedTags(db, result.proposedTags);
      writeSetting(
        db,
        'ai_last_summary',
        JSON.stringify({
          unmatched: result.unmatched,
          proposed: added,
          processed: result.processed,
          at: nowIso(),
        }),
      );
      db.prepare(
        "UPDATE ai_jobs SET status = 'done', done = total, error = NULL, updated_at = ? WHERE id = ?",
      ).run(nowIso(), jobId);
    } catch (error) {
      db.prepare(
        "UPDATE ai_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
      ).run(errorText(error), nowIso(), jobId);
    }
  })();
}

export function registerAiRoutes(
  app: FastifyInstance,
  db: Database,
  factory: LmClientFactory = defaultFactory,
): void {
  db.prepare(
    "UPDATE ai_jobs SET status = 'paused', updated_at = ? WHERE status IN ('running', 'pending')",
  ).run(nowIso());

  app.get('/api/ai/models', async (_request, reply) => {
    const config = configOf(db);
    try {
      const client = factory({ baseUrl: config.baseUrl, model: config.model });
      return { models: await client.listModels() };
    } catch (error) {
      return reply.code(502).send({ error: errorText(error) });
    }
  });

  app.post('/api/ai/taxonomy', async (_request, reply) => {
    const config = configOf(db);
    if (!config.model) {
      return reply.code(400).send({ error: '请先在设置里选择 LM Studio 模型' });
    }
    const samples = sampleForTaxonomy(db, 150);
    if (samples.length === 0) {
      return reply.code(400).send({ error: '没有可分类的条目' });
    }

    try {
      const client = factory({ baseUrl: config.baseUrl, model: config.model });
      const tags = await proposeTaxonomy(client, samples);
      writeSetting(db, 'taxonomy_proposal', JSON.stringify(tags));
      return { tags };
    } catch (error) {
      return reply.code(502).send({ error: errorText(error) });
    }
  });

  app.post('/api/ai/classify', async (_request, reply) => {
    const config = configOf(db);
    if (!config.model) {
      return reply.code(400).send({ error: '请先在设置里选择 LM Studio 模型' });
    }
    if (config.taxonomy.length === 0) {
      return reply.code(400).send({ error: '请先确认标签体系' });
    }
    const running = db
      .prepare("SELECT 1 FROM ai_jobs WHERE status = 'running' LIMIT 1")
      .get();
    if (running) {
      return reply.code(409).send({ error: '已有分类任务在运行' });
    }

    const total = countPending(db);
    const id = randomUUID();
    const current = nowIso();
    db.prepare(
      'INSERT INTO ai_jobs (id, kind, status, total, done, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    ).run(id, 'classify', total === 0 ? 'done' : 'running', total, current, current);

    if (total > 0) startClassification(db, id, config, factory);
    return { job: getJob(db, id) };
  });

  app.get('/api/ai/jobs/latest', async () => {
    const job = db
      .prepare('SELECT * FROM ai_jobs ORDER BY created_at DESC, id DESC LIMIT 1')
      .get();
    return { job: job ?? null };
  });

  app.get('/api/ai/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getJob(db, id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    return job;
  });

  app.post('/api/ai/jobs/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getJob(db, id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status !== 'running') {
      return reply.code(409).send({ error: 'job is not running' });
    }
    db.prepare("UPDATE ai_jobs SET status = 'paused', updated_at = ? WHERE id = ?").run(
      nowIso(),
      id,
    );
    return getJob(db, id);
  });

  app.post('/api/ai/jobs/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getJob(db, id);
    if (!job) return reply.code(404).send({ error: 'not found' });
    if (job.status !== 'paused') {
      return reply.code(409).send({ error: 'job is not paused' });
    }

    const pending = countPending(db);
    if (pending === 0) {
      db.prepare(
        "UPDATE ai_jobs SET status = 'done', done = total, updated_at = ? WHERE id = ?",
      ).run(nowIso(), id);
      return getJob(db, id);
    }

    db.prepare(
      "UPDATE ai_jobs SET status = 'running', total = ?, updated_at = ? WHERE id = ?",
    ).run(job.done + pending, nowIso(), id);
    startClassification(db, id, configOf(db), factory);
    return getJob(db, id);
  });
}
