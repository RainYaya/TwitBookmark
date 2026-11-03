import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../src/server/app.js';
import { createDb } from '../src/server/db.js';
import { LmStudioClient, type LanguageModelClient } from '../src/server/ai/lmstudio.js';
import { proposeTaxonomy, sampleForTaxonomy } from '../src/server/ai/taxonomy.js';
import { classifyItems } from '../src/server/ai/classify.js';

const TAXONOMY = [
  { name: 'AI', description: '人工智能与模型' },
  { name: '工具', description: '软件与效率工具' },
  { name: '开发', description: '编程与工程' },
];

function insertItem(
  db: Database,
  id: string,
  values: {
    source?: string;
    status?: string;
    ai_state?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  db.prepare(
    `INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at, status, ai_state, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'first_seen', ?, ?, ?, ?)`,
  ).run(
    id,
    values.source ?? 'twitter',
    `标题 ${id}`,
    `https://example.com/${id}`,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-02T00:00:00.000Z',
    values.status ?? 'inbox',
    values.ai_state ?? 'none',
    JSON.stringify(values.metadata ?? { body: `正文 ${id}` }),
  );
}

class FakeModel implements LanguageModelClient {
  prompts: Array<Array<{ role: string; content: string }>> = [];
  batches: string[][] = [];

  constructor(
    private reply: string | ((items: Array<{ id: string }>) => string),
  ) {}

  async listModels() {
    return ['fake-model'];
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    this.prompts.push(messages);
    const user = messages.find((message) => message.role === 'user');
    const parsed = JSON.parse(user!.content) as { items: Array<{ id: string }> };
    this.batches.push(parsed.items.map((item) => item.id));
    if (typeof this.reply === 'function') return this.reply(parsed.items);
    return this.reply;
  }
}

function fenced(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

describe('LmStudioClient', () => {
  it('lists models from the OpenAI-compatible endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }), {
        status: 200,
      }),
    );
    const client = new LmStudioClient({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'model-a',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.listModels()).toEqual(['model-a', 'model-b']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.anything(),
    );
  });

  it('sends a chat completion and returns the message content', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200 },
      ),
    );
    const client = new LmStudioClient({
      baseUrl: 'http://lm/v1',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const text = await client.chat([{ role: 'user', content: 'hi' }]);
    expect(text).toBe('{"ok":true}');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('m');
    expect(body.messages[0].content).toBe('hi');
  });

  it('throws a clear error when LM Studio is unreachable', async () => {
    const client = new LmStudioClient({
      baseUrl: 'http://lm/v1',
      model: 'm',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(client.listModels()).rejects.toThrow(/LM Studio/);
  });
});

describe('taxonomy', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
    for (const source of ['twitter', 'browser', 'github']) {
      for (let index = 0; index < 20; index += 1) {
        insertItem(db, `${source}-${index}`, { source });
      }
    }
  });

  afterEach(() => db.close());

  it('samples 30–50 items across all three sources', () => {
    const samples = sampleForTaxonomy(db, 45);
    expect(samples.length).toBe(45);
    expect(new Set(samples.map((sample) => sample.source))).toEqual(
      new Set(['twitter', 'browser', 'github']),
    );
  });

  it('samples proportionally and carries topics and hostnames', () => {
    const big = createDb(':memory:');
    for (let index = 0; index < 60; index += 1) {
      insertItem(big, `b${index}`, { source: 'browser' });
    }
    for (let index = 0; index < 40; index += 1) {
      insertItem(big, `g${index}`, {
        source: 'github',
        metadata: { full_name: `acme/r${index}`, topics: ['ocr', 'pdf'] },
      });
    }
    for (let index = 0; index < 10; index += 1) {
      insertItem(big, `t${index}`, { source: 'twitter' });
    }

    const samples = sampleForTaxonomy(big, 50);

    expect(samples).toHaveLength(50);
    expect(new Set(samples.map((sample) => sample.source))).toEqual(
      new Set(['twitter', 'browser', 'github']),
    );
    expect(samples.find((sample) => sample.source === 'github')?.topics).toEqual(['ocr', 'pdf']);
    expect(samples.find((sample) => sample.source === 'browser')?.hostname).toBe('example.com');
    big.close();
  });

  it('parses a fenced JSON taxonomy proposal', async () => {
    const reply = fenced({
      tags: Array.from({ length: 12 }, (_, index) => ({
        name: `标签${index}`,
        description: `定义${index}`,
      })),
    });
    const model = new FakeModel(reply);
    const samples = sampleForTaxonomy(db, 40);
    const tags = await proposeTaxonomy(model, samples);

    expect(tags).toHaveLength(12);
    expect(tags[0]).toEqual({ name: '标签0', description: '定义0' });
    const prompt = model.prompts[0].map((message) => message.content).join('\n');
    expect(prompt).toContain(samples[0].title);
    expect(prompt).toContain(samples[0].url);
  });
});

describe('classifyItems', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => db.close());

  it('classifies in batches of at most 30 and stores suggestions', async () => {
    for (let index = 0; index < 35; index += 1) insertItem(db, `t${index}`);

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({
          id: item.id,
          tags: ['AI', 'outside'],
          summary: '长'.repeat(150),
        })),
      }),
    );

    const result = await classifyItems({ db, client: model, taxonomy: TAXONOMY, batchSize: 30 });
    expect(result).toMatchObject({ processed: 35, paused: false, unknownTags: 35 });
    expect(model.batches.map((batch) => batch.length)).toEqual([30, 5]);

    const row = db
      .prepare('SELECT ai_tags, ai_summary, ai_state FROM items WHERE id = ?')
      .get('t0') as { ai_tags: string; ai_summary: string; ai_state: string };
    expect(JSON.parse(row.ai_tags)).toEqual(['AI']);
    expect(row.ai_summary).toHaveLength(120);
    expect(row.ai_state).toBe('suggested');
  });

  it('sends fetched page or README text and repository topics to the model', async () => {
    insertItem(db, 'b1', { source: 'browser', metadata: { body: '原标题' } });
    insertItem(db, 'g1', {
      source: 'github',
      metadata: {
        full_name: 'acme/ocr',
        description: 'OCR toolkit',
        language: 'Python',
        topics: ['ocr', 'pdf'],
      },
    });

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '这是什么' })),
      }),
    );
    const contexts: Record<string, string> = {
      b1: '页面正文：把截图转成文字。',
      g1: 'README 正文：支持 PDF 与表格识别。',
    };

    await classifyItems({
      db,
      client: model,
      taxonomy: TAXONOMY,
      contextFor: async (row) => contexts[row.id] ?? null,
    });

    const prompt = model.prompts[0].map((message) => message.content).join('\n');
    expect(prompt).toContain('把截图转成文字');
    expect(prompt).toContain('支持 PDF 与表格识别');
    expect(prompt).toContain('"topics":["ocr","pdf"]');
  });

  it('still classifies when a context lookup fails', async () => {
    insertItem(db, 'b1', { source: 'browser' });

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );

    const result = await classifyItems({
      db,
      client: model,
      taxonomy: TAXONOMY,
      contextFor: async () => {
        throw new Error('page unavailable');
      },
    });

    expect(result.processed).toBe(1);
    const prompt = model.prompts[0].map((message) => message.content).join('\n');
    expect(prompt).toContain('标题 b1');
  });

  it('leaves items without a matching tag pending and proposes new tags', async () => {
    insertItem(db, 'ok');
    insertItem(db, 'miss');

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) =>
          item.id === 'miss'
            ? {
                id: item.id,
                tags: [],
                newTags: [{ name: 'OCR', description: '文字识别与文档扫描' }],
                summary: 'OCR 工具',
              }
            : { id: item.id, tags: ['AI'], summary: 'AI 工具' },
        ),
      }),
    );

    const result = await classifyItems({ db, client: model, taxonomy: TAXONOMY });

    expect(result.unmatched).toBe(1);
    expect(result.proposedTags).toEqual([
      { name: 'OCR', description: '文字识别与文档扫描' },
    ]);
    const miss = db
      .prepare('SELECT ai_state, ai_summary FROM items WHERE id = ?')
      .get('miss') as { ai_state: string; ai_summary: string | null };
    expect(miss).toEqual({ ai_state: 'none', ai_summary: null });
    const ok = db
      .prepare('SELECT ai_state FROM items WHERE id = ?')
      .get('ok') as { ai_state: string };
    expect(ok.ai_state).toBe('suggested');
  });

  it('splits a batch when the fetched text exceeds the character budget', async () => {
    for (let index = 0; index < 12; index += 1) {
      insertItem(db, `g${index}`, {
        source: 'github',
        metadata: { full_name: `acme/repo-${index}` },
      });
    }

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );

    await classifyItems({
      db,
      client: model,
      taxonomy: TAXONOMY,
      contextFor: async () => '长'.repeat(1000),
      batchSize: 12,
      maxChars: 7000,
    });

    expect(model.batches.length).toBeGreaterThan(1);
    for (const batch of model.batches) expect(batch.length).toBeLessThan(12);
  });

  it('caps the default batch at 12 items', async () => {
    for (let index = 0; index < 30; index += 1) insertItem(db, `t${index}`);
    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );

    await classifyItems({ db, client: model, taxonomy: TAXONOMY });

    expect(model.batches.map((batch) => batch.length)).toEqual([12, 12, 6]);
  });

  it('never touches an accepted item', async () => {
    for (let index = 0; index < 3; index += 1) insertItem(db, `t${index}`);
    insertItem(db, 'accepted', { ai_state: 'accepted' });
    db.prepare("UPDATE items SET ai_tags = '[\"我的\"]', ai_summary = '我的摘要' WHERE id = 'accepted'").run();

    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );
    await classifyItems({ db, client: model, taxonomy: TAXONOMY });

    expect(model.batches.flat()).not.toContain('accepted');
    const row = db
      .prepare('SELECT ai_tags, ai_summary, ai_state FROM items WHERE id = ?')
      .get('accepted') as { ai_tags: string; ai_summary: string; ai_state: string };
    expect(JSON.parse(row.ai_tags)).toEqual(['我的']);
    expect(row.ai_summary).toBe('我的摘要');
    expect(row.ai_state).toBe('accepted');
  });

  it('stops between batches when paused', async () => {
    for (let index = 0; index < 65; index += 1) insertItem(db, `p${index}`);
    const model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );

    let checks = 0;
    const result = await classifyItems({
      db,
      client: model,
      taxonomy: TAXONOMY,
      batchSize: 30,
      shouldPause: () => checks++ >= 1,
    });

    expect(result).toMatchObject({ paused: true, processed: 30 });
    expect(model.batches).toHaveLength(1);
    const remaining = db
      .prepare("SELECT count(*) AS n FROM items WHERE ai_state = 'none'")
      .get() as { n: number };
    expect(remaining.n).toBe(35);
  });

  it('throws when a batch fails, keeping earlier work', async () => {
    for (let index = 0; index < 35; index += 1) insertItem(db, `f${index}`);
    let calls = 0;
    const model = new FakeModel((items) => {
      calls += 1;
      if (calls === 2) throw new Error('model crashed');
      return fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      });
    });

    await expect(
      classifyItems({ db, client: model, taxonomy: TAXONOMY, batchSize: 30 }),
    ).rejects.toThrow('model crashed');
    const suggested = db
      .prepare("SELECT count(*) AS n FROM items WHERE ai_state = 'suggested'")
      .get() as { n: number };
    expect(suggested.n).toBe(30);
  });
});

describe('AI routes', () => {
  let db: Database;
  let app: ReturnType<typeof buildApp>;
  let model: FakeModel;

  beforeEach(async () => {
    db = createDb(':memory:');
    for (let index = 0; index < 35; index += 1) insertItem(db, `r${index}`);
    model = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({ id: item.id, tags: ['AI'], summary: '摘要' })),
      }),
    );
    app = buildApp({
      db,
      lmClientFactory: () => model,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function waitForJob(id: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/ai/jobs/${id}` });
      const job = res.json();
      if (job.status === 'done' || job.status === 'failed') return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('job did not finish');
  }

  it('stores settings and rejects unknown keys', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_model: 'qwen' } },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json().settings.lmstudio_model).toBe('qwen');

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { nope: 'x' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('proposes a taxonomy and then runs a classification job', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_model: 'fake-model' } },
    });

    const proposalModel = new FakeModel(
      fenced({
        tags: Array.from({ length: 12 }, (_, index) => ({
          name: `标签${index}`,
          description: `定义${index}`,
        })),
      }),
    );
    const proposalApp = buildApp({ db, lmClientFactory: () => proposalModel });
    await proposalApp.ready();
    const proposal = await proposalApp.inject({ method: 'POST', url: '/api/ai/taxonomy' });
    expect(proposal.statusCode).toBe(200);
    expect(proposal.json().tags).toHaveLength(12);
    await proposalApp.close();

    const beforeConfirm = await app.inject({ method: 'POST', url: '/api/ai/classify' });
    expect(beforeConfirm.statusCode).toBe(400);

    const taxonomyJson = JSON.stringify(TAXONOMY);
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { taxonomy: taxonomyJson } },
    });

    const started = await app.inject({ method: 'POST', url: '/api/ai/classify' });
    expect(started.statusCode).toBe(200);
    const job = await waitForJob(started.json().job.id);
    expect(job).toMatchObject({ status: 'done', total: 35, done: 35 });
  });

  it('appends proposed tags and records unmatched items when a job finishes', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        settings: { lmstudio_model: 'fake-model', taxonomy: JSON.stringify(TAXONOMY) },
      },
    });
    const proposing = new FakeModel((items) =>
      fenced({
        results: items.map((item) => ({
          id: item.id,
          tags: [],
          newTags: [{ name: 'OCR', description: '文字识别与文档扫描' }],
          summary: 'OCR 工具',
        })),
      }),
    );
    const proposingApp = buildApp({ db, lmClientFactory: () => proposing });
    await proposingApp.ready();

    const started = await proposingApp.inject({ method: 'POST', url: '/api/ai/classify' });
    let job: { status: string } = { status: 'running' };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await proposingApp.inject({
        method: 'GET',
        url: `/api/ai/jobs/${started.json().job.id}`,
      });
      job = res.json();
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status).toBe('done');

    const settings = (await proposingApp.inject({ method: 'GET', url: '/api/settings' })).json()
      .settings as Record<string, string>;
    const proposal = JSON.parse(settings.taxonomy_proposal) as Array<{ name: string }>;
    expect(proposal.map((tag) => tag.name)).toContain('OCR');
    expect(JSON.parse(settings.ai_last_summary)).toMatchObject({
      unmatched: 35,
      proposed: 1,
    });
    await proposingApp.close();
  });

  it('marks a job failed when the model call fails', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_model: 'fake-model', taxonomy: JSON.stringify(TAXONOMY) } },
    });
    const failing = new FakeModel(() => {
      throw new Error('LM Studio is not running');
    });
    const failingApp = buildApp({ db, lmClientFactory: () => failing });
    await failingApp.ready();

    const started = await failingApp.inject({ method: 'POST', url: '/api/ai/classify' });
    const job = await waitForJob(started.json().job.id);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('LM Studio');
    await failingApp.close();
  });

  it('pauses jobs orphaned by a restart and exposes the latest job', async () => {
    db.prepare(
      `INSERT INTO ai_jobs (id, kind, status, total, done, created_at, updated_at)
       VALUES ('orphan', 'classify', 'running', 35, 10,
         '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`,
    ).run();

    const restarted = buildApp({ db, lmClientFactory: () => model });
    await restarted.ready();

    const latest = await restarted.inject({ method: 'GET', url: '/api/ai/jobs/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().job).toMatchObject({ id: 'orphan', status: 'paused', done: 10 });

    const printed = await restarted.inject({ method: 'GET', url: '/api/ai/jobs/orphan' });
    expect(printed.json().status).toBe('paused');
    await restarted.close();
  });

  it('refuses to start a second classification while one is running', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_model: 'fake-model', taxonomy: JSON.stringify(TAXONOMY) } },
    });
    db.prepare(
      `INSERT INTO ai_jobs (id, kind, status, total, done, created_at, updated_at)
       VALUES ('busy', 'classify', 'running', 35, 0,
         '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`,
    ).run();

    const res = await app.inject({ method: 'POST', url: '/api/ai/classify' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('运行');
  });

  it('returns a clear error when taxonomy generation cannot reach LM Studio', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { lmstudio_model: 'fake-model' } },
    });
    const offline = new FakeModel(() => {
      throw new Error('LM Studio 连接失败');
    });
    const offlineApp = buildApp({ db, lmClientFactory: () => offline });
    await offlineApp.ready();

    const res = await offlineApp.inject({ method: 'POST', url: '/api/ai/taxonomy' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('LM Studio');
    await offlineApp.close();
  });
});
