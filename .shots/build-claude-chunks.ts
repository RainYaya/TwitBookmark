import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchReadme } from '../src/server/ai/context.js';

const db = new Database('data/bookmarks.db', { readonly: true });
const outDir = resolve('.shots/claude-classify');
mkdirSync(outDir, { recursive: true });

const taxonomy = [
  { name: 'AI与模型', description: '大模型、Agent、推理与 AI 应用' },
  { name: '开发工具', description: '编辑器、CLI、Git、调试与开发效率' },
  { name: '前端与UI', description: 'Web 前端、组件库、样式与交互' },
  { name: '后端与数据库', description: '服务端、语言框架、API、数据库与存储' },
  { name: '运维与网络', description: '服务器、部署、网络、代理与云服务' },
  { name: '安全与逆向', description: '安全研究、逆向、破解与风控' },
  { name: 'OCR与文档', description: '文字识别、PDF、文档转换与处理' },
  { name: '数据处理', description: '爬虫、解析、数据清洗与可视化' },
  { name: '设计素材', description: '图标、图片、封面与设计资源' },
  { name: '游戏与模拟器', description: '游戏、模拟器、攻略与 Mod' },
  { name: '动漫与影视', description: '动画、番剧、影视与字幕资源' },
  { name: '成人内容', description: '成人影片与相关站点' },
  { name: '音乐与音频', description: '音乐、播客、音频工具与资源' },
  { name: '阅读与写作', description: '文章、博客、书籍与写作' },
  { name: '学习与教程', description: '课程、教程、指南与算法学习' },
  { name: '效率与办公', description: '笔记、剪贴板、办公与自动化' },
  { name: '资源下载', description: '网盘、BT、磁力与下载工具' },
  { name: '社区与论坛', description: '论坛、社区与讨论区' },
  { name: '生活与消费', description: '生活、健康、购物与旅行' },
  { name: '自托管与硬件', description: '自建服务、NAS、Docker 与硬件 DIY' },
  { name: '浏览器扩展', description: '浏览器插件与用户脚本' },
  { name: '移动与桌面', description: '手机 App、桌面软件与系统工具' },
];

writeFileSync(resolve(outDir, 'taxonomy.json'), JSON.stringify(taxonomy, null, 2));

interface Row {
  id: string;
  source: string;
  title: string;
  url: string;
  metadata: string;
}

const rows = db
  .prepare(
    `SELECT id, source, title, url, metadata FROM items
     WHERE deleted_at IS NULL
     ORDER BY saved_at DESC, id DESC`,
  )
  .all() as Row[];

function metadataOf(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function repoOf(row: Row, metadata: Record<string, unknown>): string | null {
  if (typeof metadata.full_name === 'string') return metadata.full_name;
  try {
    const url = new URL(row.url);
    if (!/github\.com$/.test(url.hostname)) return null;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

const needReadme: Array<{ index: number; repo: string }> = [];
rows.forEach((row, index) => {
  if (row.source !== 'github') return;
  const metadata = metadataOf(row.metadata);
  const description = typeof metadata.description === 'string' ? metadata.description : '';
  const repo = repoOf(row, metadata);
  if (repo && description.trim().length < 20) needReadme.push({ index, repo });
});

console.log('fetching READMEs', needReadme.length);
const readmes = new Map<number, string>();
for (let start = 0; start < needReadme.length; start += 4) {
  const slice = needReadme.slice(start, start + 4);
  const results = await Promise.all(
    slice.map(async (entry) => ({
      index: entry.index,
      text: await fetchReadme(entry.repo, { maxChars: 700 }),
    })),
  );
  for (const result of results) {
    if (result.text) readmes.set(result.index, result.text);
  }
  process.stdout.write('.');
}
process.stdout.write('\n');

const records = rows.map((row, index) => {
  const metadata = metadataOf(row.metadata);
  const record: Record<string, unknown> = {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
  };
  if (row.source === 'github') {
    if (typeof metadata.description === 'string' && metadata.description.trim()) {
      record.description = metadata.description.trim();
    }
    if (typeof metadata.language === 'string' && metadata.language) {
      record.language = metadata.language;
    }
    if (Array.isArray(metadata.topics) && metadata.topics.length > 0) {
      record.topics = metadata.topics.filter((topic) => typeof topic === 'string').slice(0, 10);
    }
    const readme = readmes.get(index);
    if (readme) record.text = readme;
  }
  if (row.source === 'twitter' && typeof metadata.body === 'string' && metadata.body.trim()) {
    record.text = metadata.body.trim().slice(0, 300);
  }
  if (row.source === 'browser') {
    try {
      record.hostname = new URL(row.url).hostname.replace(/^www\./, '');
    } catch {
      // leave it out
    }
  }
  return record;
});

const chunkCount = 18;
const size = Math.ceil(records.length / chunkCount);
const manifest: Array<{ chunk: string; count: number }> = [];
for (let chunk = 0; chunk < chunkCount; chunk += 1) {
  const slice = records.slice(chunk * size, (chunk + 1) * size);
  const name = `items-${String(chunk + 1).padStart(2, '0')}.jsonl`;
  writeFileSync(resolve(outDir, name), slice.map((record) => JSON.stringify(record)).join('\n') + '\n');
  manifest.push({ chunk: name, count: slice.length });
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('records', records.length, 'chunks', manifest.map((entry) => entry.count).join(','));
db.close();
