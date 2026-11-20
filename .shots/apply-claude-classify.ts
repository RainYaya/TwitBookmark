import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('.shots/claude-classify');
const write = process.argv.includes('--write');

const taxonomy = JSON.parse(readFileSync(resolve(dir, 'taxonomy.json'), 'utf8')) as Array<{
  name: string;
  description: string;
}>;
const names = new Set(taxonomy.map((tag) => tag.name));

interface Out {
  id: string;
  tags: string[];
  summary: string;
}

const files = readdirSync(dir)
  .filter((name) => /^out-\d+\.jsonl$/.test(name))
  .sort();
if (files.length !== 18) {
  console.error(`expected 18 output files, found ${files.length}: ${files.join(', ')}`);
  process.exit(1);
}

const errors: string[] = [];
const warnings: string[] = [];
const results = new Map<string, Out>();
const counts = new Map<string, number>();

for (const file of files) {
  const lines = readFileSync(resolve(dir, file), 'utf8')
    .split('\n')
    .filter((line) => line.trim());
  const inputLines = readFileSync(resolve(dir, file.replace(/^out-/, 'items-')), 'utf8')
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length !== inputLines.length) {
    errors.push(`${file}: ${lines.length} lines, input has ${inputLines.length}`);
  }
  lines.forEach((line, index) => {
    let value: Out;
    try {
      value = JSON.parse(line) as Out;
    } catch {
      errors.push(`${file}:${index + 1} invalid JSON`);
      return;
    }
    const expected = JSON.parse(inputLines[index] ?? '{}') as { id?: string };
    if (typeof value.id !== 'string' || !value.id) {
      errors.push(`${file}:${index + 1} missing id`);
      return;
    }
    if (expected.id && expected.id !== value.id) {
      errors.push(`${file}:${index + 1} id ${value.id} out of order (expected ${expected.id})`);
    }
    if (results.has(value.id)) {
      errors.push(`${file}:${index + 1} duplicate id ${value.id}`);
    }
    if (!Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 3) {
      errors.push(`${file}:${index + 1} ${value.id} has ${value.tags?.length ?? 0} tags`);
      return;
    }
    for (const tag of value.tags) {
      if (typeof tag !== 'string' || !names.has(tag)) {
        errors.push(`${file}:${index + 1} ${value.id} unknown tag ${JSON.stringify(tag)}`);
      }
    }
    if (new Set(value.tags).size !== value.tags.length) {
      warnings.push(`${file}:${index + 1} ${value.id} duplicate tags`);
    }
    const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
    if (!summary) {
      errors.push(`${file}:${index + 1} ${value.id} empty summary`);
    } else if ([...summary].length > 120) {
      warnings.push(`${file}:${index + 1} ${value.id} summary ${[...summary].length} chars`);
    }
    results.set(value.id, { id: value.id, tags: value.tags, summary });
    for (const tag of value.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  });
}

const db = new Database('data/bookmarks.db', { readonly: !write });
const rows = db
  .prepare('SELECT id FROM items WHERE deleted_at IS NULL')
  .all() as Array<{ id: string }>;
const dbIds = new Set(rows.map((row) => row.id));
const missing = [...dbIds].filter((id) => !results.has(id));
const extra = [...results.keys()].filter((id) => !dbIds.has(id));
if (missing.length) errors.push(`${missing.length} live items missing, e.g. ${missing.slice(0, 5).join(', ')}`);
if (extra.length) errors.push(`${extra.length} unknown ids, e.g. ${extra.slice(0, 5).join(', ')}`);

console.log('files', files.length, 'results', results.size, 'db live', dbIds.size);
console.log('tag distribution');
for (const tag of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag[0]}\t${tag[1]}`);
}
if (warnings.length) {
  console.log(`warnings ${warnings.length}`);
  for (const warning of warnings.slice(0, 20)) console.log('  ' + warning);
}
if (errors.length) {
  console.log(`ERRORS ${errors.length}`);
  for (const error of errors) console.log('  ' + error);
  db.close();
  process.exit(1);
}

if (!write) {
  console.log('validation passed (dry run; pass --write to apply)');
  db.close();
  process.exit(0);
}

const apply = db.transaction(() => {
  const update = db.prepare(
    `UPDATE items SET ai_tags = ?, ai_summary = ?, ai_state = 'suggested'
     WHERE id = ? AND ai_state = 'none'`,
  );
  let updated = 0;
  for (const value of results.values()) {
    updated += update.run(JSON.stringify(value.tags), value.summary, value.id).changes;
  }
  const setSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const current = db.prepare("SELECT value FROM settings WHERE key = 'taxonomy'").get() as
    | { value: string }
    | undefined;
  const json = JSON.stringify(taxonomy);
  if (!current || current.value === '[]' || current.value === '') {
    setSetting.run('taxonomy', json);
  }
  setSetting.run('taxonomy_proposal', json);
  setSetting.run(
    'ai_last_summary',
    JSON.stringify({ unmatched: 0, proposed: 0, processed: updated, at: new Date().toISOString() }),
  );
  return updated;
});

console.log('updated', apply());
db.close();
