import { rmSync } from 'node:fs';
import { createDb } from '../src/server/db.js';

const path = '.shots/demo.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
const db = createDb(path);
const now = new Date('2026-11-02T12:00:00.000Z');
const iso = (daysAgo: number, hour = 9) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const insertItem = db.prepare(`
  INSERT INTO items (id, source, title, url, created_at, saved_at, saved_source, imported_at,
    status, read, metadata, ai_tags, ai_summary, summary, ai_state, deleted_at)
  VALUES (@id, @source, @title, @url, @created_at, @saved_at, @saved_source, @imported_at,
    @status, @read, @metadata, @ai_tags, @ai_summary, @summary, @ai_state, @deleted_at)
`);

const topics = [
  ['SQLite 的 WAL 模式与实践', '把 journal_mode 改成 WAL 之后，读写并发明显顺畅了。这篇把 checkpoint 的时机讲得很清楚。'],
  ['React 19 的表单状态', 'useActionState 和 useOptimistic 能把提交中的状态收在一个地方，配合服务端 action 很顺手。'],
  ['本地向量检索的最小方案', 'sqlite-vec 加上一个 384 维的小模型，个人知识库就够用了，不用上向量数据库。'],
  ['Vim 的文本对象比想象中多', 'ci(、da"、yip 这些组合用熟以后，改代码基本不碰鼠标。'],
  ['用 Fastify 搭一个本地服务', '插件体系清晰，schema 校验直接接 zod，静态文件和 SPA 回退也不复杂。'],
  ['LM Studio 的 OpenAI 兼容接口', '本地加载模型后开服务，base_url 指向 1234，批量分类跑起来完全够用。'],
  ['书签整理的一个笨办法', '每周挑十条旧的，看完就删或归档，比一次性大扫除可持续。'],
  ['CSS 里的 color-mix', '把纸张色和背景色混一点，切深浅色的时候不用维护两套色板。'],
  ['Playwright 的 webServer', '测试前自动构建并起服务，CI 和本地用同一套命令，省掉手工准备。'],
  ['TypeScript 的 satisfies', '既保留字面量类型又能检查结构，配置对象写起来比 as const 自然。'],
];

let count = 0;
for (let i = 0; i < 30; i += 1) {
  const [title, body] = topics[i % topics.length];
  const suggested = i < 8;
  insertItem.run({
    id: `tw-${String(i).padStart(2, '0')}`,
    source: 'twitter',
    title,
    url: `https://x.com/reader/status/1000${i}`,
    created_at: iso(i % 10, 8 + (i % 6)),
    saved_at: iso(i % 10, 8 + (i % 6)),
    saved_source: 'tweet_created',
    imported_at: iso(0, 12),
    status: i % 4 === 0 ? 'later' : i % 5 === 0 ? 'done' : 'inbox',
    read: i % 3 === 0 ? 1 : 0,
    metadata: JSON.stringify({
      name: ['林间', '阿岚', 'Kai', '小满'][i % 4],
      screen_name: ['forest', 'alan', 'kai', 'xiaoman'][i % 4],
      avatar_url: null,
      body,
      media: [],
    }),
    ai_tags: JSON.stringify(suggested ? [['工具', '数据库'], ['前端', 'React'], ['AI', '本地模型']][i % 3] : []),
    ai_summary: suggested ? '一条关于本地工具链的实践笔记，值得对照自己的配置看一遍。' : null,
    summary: i % 7 === 0 ? '留着自己再读。' : null,
    ai_state: suggested ? 'suggested' : i < 12 ? 'accepted' : 'none',
    deleted_at: null,
  });
  count += 1;
}

const browserTitles = [
  'Designing Data-Intensive Applications',
  'SQLite Documentation — WAL',
  'MDN — Fetch API',
  'React Reference',
  'Fastify 官方文档',
  'CSS Tricks — color-mix',
  'TypeScript Handbook',
  'Vim Help — Text Objects',
  'LM Studio Docs',
  'Playwright Test Runner',
];
for (let i = 0; i < 80; i += 1) {
  const suggested = i < 8;
  insertItem.run({
    id: `br-${String(i).padStart(2, '0')}`,
    source: 'browser',
    title: browserTitles[i % browserTitles.length],
    url: `https://example.com/reading/${i}`,
    created_at: null,
    saved_at: iso(11 + (i % 20), 10),
    saved_source: 'browser_added',
    imported_at: iso(0, 12),
    status: i % 6 === 0 ? 'reference' : 'inbox',
    read: 0,
    metadata: JSON.stringify({
      description: '浏览器收藏夹里翻到的一篇长文，先放进来慢慢看。',
      folder: '技术阅读',
    }),
    ai_tags: JSON.stringify(suggested ? [['AI', '工具'], ['前端'], ['阅读', '数据库']][i % 3] : []),
    ai_summary: suggested ? '浏览器收藏里的一篇技术长文，建议先读摘要再决定是否深读。' : null,
    summary: null,
    ai_state: suggested ? 'suggested' : 'none',
    deleted_at: null,
  });
  count += 1;
}

for (let i = 0; i < 6; i += 1) {
  insertItem.run({
    id: `trash-${i}`,
    source: 'browser',
    title: `不再需要的收藏 ${i + 1}`,
    url: `https://example.com/old/${i}`,
    created_at: null,
    saved_at: iso(30 + i, 10),
    saved_source: 'browser_added',
    imported_at: iso(0, 12),
    status: 'inbox',
    read: 0,
    metadata: JSON.stringify({ description: '旧收藏', folder: '未整理' }),
    ai_tags: '[]',
    ai_summary: null,
    summary: null,
    ai_state: 'none',
    deleted_at: iso(1, 11),
  });
  count += 1;
}

const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
const tagIds: Record<string, number> = {};
for (const name of ['工具', '前端', '数据库', 'AI', '阅读']) {
  const info = insertTag.run(name);
  tagIds[name] = Number(info.lastInsertRowid);
}
const link = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
for (let i = 0; i < 8; i += 1) {
  const names = [['工具', '数据库'], ['前端', 'AI'], ['阅读']][i % 3];
  for (const name of names) link.run(`tw-${String(i).padStart(2, '0')}`, tagIds[name]);
}
for (const name of ['工具', '前端', '数据库', 'AI', '阅读']) link.run(`br-00`, tagIds[name]);
for (let i = 1; i < 8; i += 1) {
  const names = [['AI', '工具'], ['前端'], ['阅读', '数据库']][i % 3];
  for (const name of names) link.run(`br-${String(i).padStart(2, '0')}`, tagIds[name]);
}

db.prepare(
  `INSERT INTO ai_jobs (id, kind, status, total, done, error, created_at, updated_at)
   VALUES ('job-demo', 'classify', 'paused', ?, 12, NULL, ?, ?)`,
).run(count, iso(0, 11), iso(0, 11));

db.prepare("INSERT INTO settings (key, value) VALUES ('lmstudio_base_url', 'http://localhost:1234/v1')").run();
db.prepare("INSERT INTO settings (key, value) VALUES ('lmstudio_model', 'qwen2.5-7b-instruct')").run();
db.prepare(
  "INSERT INTO settings (key, value) VALUES ('taxonomy', '[{\"name\":\"工具\",\"description\":\"软件与工具\"},{\"name\":\"前端\",\"description\":\"Web 前端\"},{\"name\":\"数据库\",\"description\":\"数据存储\"},{\"name\":\"AI\",\"description\":\"模型与智能体\"},{\"name\":\"阅读\",\"description\":\"长文与书\"}]')",
).run();

console.log({ items: count });
