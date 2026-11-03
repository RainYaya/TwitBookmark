import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';

const nameSchema = z.string().trim().min(1).max(40);
const createSchema = z.object({ name: nameSchema }).strict();
const renameSchema = z.object({ name: nameSchema }).strict();

interface CollectionRow {
  id: string;
  name: string;
  position: number;
  count: number;
}

const SELECT_COLLECTION = `
  SELECT c.id, c.name, c.position, COALESCE((
    SELECT count(*) FROM items i
    WHERE i.collection_id = c.id AND i.deleted_at IS NULL
  ), 0) AS count
  FROM collections c
`;

function listCollections(db: Database): CollectionRow[] {
  return db
    .prepare(`${SELECT_COLLECTION} ORDER BY c.position ASC, c.created_at ASC, c.name COLLATE NOCASE`)
    .all() as CollectionRow[];
}

function getCollection(db: Database, id: string): CollectionRow | undefined {
  return db.prepare(`${SELECT_COLLECTION} WHERE c.id = ?`).get(id) as CollectionRow | undefined;
}

export function registerCollectionRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/collections', async () => ({ collections: listCollections(db) }));

  app.post('/api/collections', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid collection name' });
    const id = randomUUID();
    try {
      const position = (
        db.prepare('SELECT COALESCE(max(position), 0) + 1 AS next FROM collections').get() as {
          next: number;
        }
      ).next;
      db.prepare(
        'INSERT INTO collections (id, name, position, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, parsed.data.name, position, nowIso());
    } catch {
      return reply.code(409).send({ error: 'collection already exists' });
    }
    return getCollection(db, id);
  });

  app.patch('/api/collections/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = renameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid collection name' });
    if (!getCollection(db, id)) return reply.code(404).send({ error: 'not found' });
    try {
      db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(parsed.data.name, id);
    } catch {
      return reply.code(409).send({ error: 'collection already exists' });
    }
    return getCollection(db, id);
  });

  app.delete('/api/collections/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const info = db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.get('/api/facets', async () => {
    const counts = (column: string, values: string[]) =>
      Object.fromEntries(
        values.map((value) => [
          value,
          (
            db
              .prepare(
                `SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND ${column} = ?`,
              )
              .get(value) as { n: number }
          ).n,
        ]),
      );

    const total = (
      db.prepare('SELECT count(*) AS n FROM items WHERE deleted_at IS NULL').get() as {
        n: number;
      }
    ).n;
    const deleted = (
      db.prepare('SELECT count(*) AS n FROM items WHERE deleted_at IS NOT NULL').get() as {
        n: number;
      }
    ).n;
    const aiSuggested = (
      db
        .prepare("SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND ai_state = 'suggested'")
        .get() as { n: number }
    ).n;
    const untagged = (
      db
        .prepare(
          `SELECT count(*) AS n FROM items i
           WHERE i.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id)`,
        )
        .get() as { n: number }
    ).n;
    const unfiled = (
      db
        .prepare(
          'SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND collection_id IS NULL',
        )
        .get() as { n: number }
    ).n;
    const noted = (
      db
        .prepare(
          "SELECT count(*) AS n FROM items WHERE deleted_at IS NULL AND summary IS NOT NULL AND trim(summary) <> ''",
        )
        .get() as { n: number }
    ).n;
    const tags = db
      .prepare(
        `SELECT t.name, count(i.id) AS count
         FROM tags t
         JOIN item_tags it ON it.tag_id = t.id
         JOIN items i ON i.id = it.item_id AND i.deleted_at IS NULL
         GROUP BY t.id
         ORDER BY count DESC, t.name COLLATE NOCASE`,
      )
      .all() as Array<{ name: string; count: number }>;

    return {
      total,
      deleted,
      untagged,
      unfiled,
      noted,
      aiSuggested,
      statuses: counts('status', ['inbox', 'later', 'done', 'reference']),
      sources: counts('source', ['twitter', 'browser', 'github']),
      tags,
      collections: listCollections(db).map(({ id, name, count }) => ({ id, name, count })),
    };
  });
}
