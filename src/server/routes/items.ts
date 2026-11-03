import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';

const statusSchema = z.enum(['inbox', 'later', 'done', 'reference']);
const sourceSchema = z.enum(['twitter', 'browser', 'github']);

const itemPatchSchema = z
  .object({
    status: statusSchema.optional(),
    read: z.boolean().optional(),
    is_todo: z.boolean().optional(),
    todo_done: z.boolean().optional(),
    summary: z.string().max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });

const querySchema = z.object({
  source: z.union([sourceSchema, z.array(sourceSchema)]).optional(),
  status: statusSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  deleted: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(['delete', 'patch', 'restore']).default('delete'),
  patch: itemPatchSchema.optional(),
});

const acceptAiSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500).optional(),
    source: z.union([sourceSchema, z.array(sourceSchema)]).optional(),
    status: statusSchema.optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    q: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

interface ItemFilters {
  source?: z.infer<typeof sourceSchema> | Array<z.infer<typeof sourceSchema>>;
  status?: z.infer<typeof statusSchema>;
  tag?: string;
  q?: string;
}

function filterClauses(
  query: ItemFilters,
  onlyDeleted: boolean,
): { clauses: string[]; params: unknown[] } {
  const clauses = [onlyDeleted ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (query.source) {
    const sources = Array.isArray(query.source) ? query.source : [query.source];
    clauses.push(`i.source IN (${sources.map(() => '?').join(', ')})`);
    params.push(...sources);
  }
  if (query.status) {
    clauses.push('i.status = ?');
    params.push(query.status);
  }
  if (query.tag) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = i.id AND t.name = ?
       )`,
    );
    params.push(query.tag);
  }
  if (query.q) {
    if (query.q.length >= 3) {
      clauses.push('i.id IN (SELECT id FROM items_fts WHERE items_fts MATCH ?)');
      params.push(`"${query.q.replace(/"/g, '""')}"`);
    } else {
      clauses.push(
        `(i.title LIKE ? OR i.metadata LIKE ? OR COALESCE(i.summary, '') LIKE ? OR COALESCE(i.ai_summary, '') LIKE ?)`,
      );
      const like = `%${query.q}%`;
      params.push(like, like, like, like);
    }
  }

  return { clauses, params };
}

interface ItemRow {
  id: string;
  source: string;
  title: string;
  url: string;
  created_at: string | null;
  saved_at: string;
  saved_source: string | null;
  imported_at: string;
  status: string;
  read: number;
  is_todo: number;
  todo_done: number;
  metadata: string;
  ai_tags: string;
  ai_summary: string | null;
  summary: string | null;
  ai_state: string;
  last_surfaced_at: string | null;
  deleted_at: string | null;
  tags_json: string | null;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toDto(row: ItemRow) {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
    created_at: row.created_at,
    saved_at: row.saved_at,
    saved_source: row.saved_source,
    imported_at: row.imported_at,
    status: row.status,
    read: row.read === 1,
    is_todo: row.is_todo === 1,
    todo_done: row.todo_done === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    ai_tags: parseJson<string[]>(row.ai_tags, []),
    ai_summary: row.ai_summary,
    summary: row.summary,
    ai_state: row.ai_state,
    last_surfaced_at: row.last_surfaced_at,
    deleted_at: row.deleted_at,
    tags: parseJson<string[]>(row.tags_json, []),
  };
}

const SELECT_ITEM = `
  SELECT i.*, (
    SELECT json_group_array(name) FROM (
      SELECT t.name FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = i.id
      ORDER BY t.name
    )
  ) AS tags_json
  FROM items i
`;

function getItem(db: Database, id: string): ItemRow | undefined {
  return db.prepare(`${SELECT_ITEM} WHERE i.id = ?`).get(id) as ItemRow | undefined;
}

export function getItemDto(db: Database, id: string) {
  const row = getItem(db, id);
  return row ? toDto(row) : undefined;
}

function encodeCursor(savedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ savedAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { savedAt: string; id: string } {
  const parsed = z.object({ savedAt: z.string(), id: z.string() }).parse(
    JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
  );
  return parsed;
}

function applyPatch(db: Database, id: string, patch: z.infer<typeof itemPatchSchema>): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.read !== undefined) {
    sets.push('read = ?');
    values.push(patch.read ? 1 : 0);
  }
  if (patch.is_todo !== undefined) {
    sets.push('is_todo = ?');
    values.push(patch.is_todo ? 1 : 0);
  }
  if (patch.todo_done !== undefined) {
    sets.push('todo_done = ?');
    values.push(patch.todo_done ? 1 : 0);
  }
  if (patch.summary !== undefined) {
    sets.push('summary = ?');
    values.push(patch.summary);
  }
  if (sets.length === 0) return false;
  values.push(id);
  const info = db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return info.changes > 0;
}

export function registerItemRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/items', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query' });
    }
    const query = parsed.data;
    const onlyDeleted = query.deleted === '1' || query.deleted === 'true';
    const { clauses, params } = filterClauses(query, onlyDeleted);
    if (query.cursor) {
      let cursor: { savedAt: string; id: string };
      try {
        cursor = decodeCursor(query.cursor);
      } catch {
        return reply.code(400).send({ error: 'invalid cursor' });
      }
      clauses.push('(i.saved_at < ? OR (i.saved_at = ? AND i.id < ?))');
      params.push(cursor.savedAt, cursor.savedAt, cursor.id);
    }

    const rows = db
      .prepare(
        `${SELECT_ITEM} WHERE ${clauses.join(' AND ')}
         ORDER BY i.saved_at DESC, i.id DESC
         LIMIT ?`,
      )
      .all(...params, query.limit + 1) as ItemRow[];

    const page = rows.slice(0, query.limit);
    const body: { items: ReturnType<typeof toDto>[]; nextCursor?: string } = {
      items: page.map(toDto),
    };
    const last = page.at(-1);
    if (rows.length > query.limit && last) {
      body.nextCursor = encodeCursor(last.saved_at, last.id);
    }
    return body;
  });

  app.post('/api/items/accept-ai', async (request, reply) => {
    const parsed = acceptAiSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid accept request' });
    }
    const { ids, ...filters } = parsed.data;
    const { clauses, params } = filterClauses(filters, false);
    clauses.push("i.ai_state = 'suggested'");
    if (ids?.length) {
      clauses.push(`i.id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }

    const rows = db
      .prepare(
        `SELECT i.id, i.ai_tags, i.ai_summary FROM items i
         WHERE ${clauses.join(' AND ')}`,
      )
      .all(...params) as Array<{ id: string; ai_tags: string; ai_summary: string | null }>;

    const insertTag = db.prepare(
      'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
    );
    const selectTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    const link = db.prepare(
      'INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)',
    );
    const update = db.prepare(
      `UPDATE items SET summary = COALESCE(summary, ai_summary), ai_state = 'accepted'
       WHERE id = ?`,
    );
    let updated = 0;
    const run = db.transaction(() => {
      for (const row of rows) {
        let names: unknown = [];
        try {
          names = JSON.parse(row.ai_tags);
        } catch {
          names = [];
        }
        if (Array.isArray(names)) {
          for (const name of names) {
            if (typeof name !== 'string' || !name.trim()) continue;
            insertTag.run(name);
            const tag = selectTag.get(name) as { id: number };
            link.run(row.id, tag.id);
          }
        }
        update.run(row.id);
        updated += 1;
      }
    });
    run();
    return { updated };
  });

  app.patch('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = itemPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid patch' });
    }
    const item = getItem(db, id);
    if (!item) return reply.code(404).send({ error: 'not found' });

    applyPatch(db, id, parsed.data);
    const updated = getItem(db, id);
    return toDto(updated!);
  });

  app.delete('/api/items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = getItem(db, id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    if (!item.deleted_at) {
      db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
    }
    return { ok: true };
  });

  app.post('/api/items/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = getItem(db, id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(id);
    return toDto(getItem(db, id)!);
  });

  app.post('/api/items/bulk', async (request, reply) => {
    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid bulk request' });
    }
    const { ids, action, patch } = parsed.data;
    const placeholders = ids.map(() => '?').join(', ');

    if (action === 'delete') {
      const info = db
        .prepare(
          `UPDATE items SET deleted_at = ? WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
        )
        .run(nowIso(), ...ids);
      return { updated: info.changes };
    }

    if (action === 'restore') {
      const info = db
        .prepare(
          `UPDATE items SET deleted_at = NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`,
        )
        .run(...ids);
      return { updated: info.changes };
    }

    if (!patch) {
      return reply.code(400).send({ error: 'patch is required for action=patch' });
    }
    let updated = 0;
    const run = db.transaction(() => {
      for (const id of ids) {
        if (applyPatch(db, id, patch)) updated += 1;
      }
    });
    run();
    return { updated };
  });
}
