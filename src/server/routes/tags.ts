import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { getItemDto } from './items.js';

const tagName = z.string().trim().min(1).max(40);
const createTagSchema = z.object({ name: tagName }).strict();
const renameTagSchema = z.object({ name: tagName }).strict();
const setTagsSchema = z.object({ tags: z.array(tagName).max(30) }).strict();

interface TagRow {
  id: number;
  name: string;
  count: number;
}

const SELECT_TAG = `
  SELECT t.id, t.name, COALESCE((
    SELECT count(*) FROM item_tags it JOIN items i ON i.id = it.item_id
    WHERE it.tag_id = t.id AND i.deleted_at IS NULL
  ), 0) AS count
  FROM tags t
`;

export function registerTagRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/tags', async () => {
    const tags = db.prepare(`${SELECT_TAG} ORDER BY t.name COLLATE NOCASE`).all() as TagRow[];
    return { tags };
  });

  app.post('/api/tags', async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid tag name' });

    db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(
      parsed.data.name,
    );
    const tag = db
      .prepare(`${SELECT_TAG} WHERE t.name = ?`)
      .get(parsed.data.name) as TagRow;
    return tag;
  });

  app.patch('/api/tags/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid tag id' });
    const parsed = renameTagSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid tag name' });

    const exists = db.prepare('SELECT 1 FROM tags WHERE id = ?').get(id);
    if (!exists) return reply.code(404).send({ error: 'not found' });

    try {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(parsed.data.name, id);
    } catch {
      return reply.code(409).send({ error: 'tag already exists' });
    }
    return db.prepare(`${SELECT_TAG} WHERE t.id = ?`).get(id) as TagRow;
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid tag id' });
    const info = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post('/api/items/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = setTagsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid tags' });

    const item = db.prepare('SELECT 1 FROM items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ error: 'not found' });

    const names = [...new Set(parsed.data.tags)];
    const insertTag = db.prepare(
      'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
    );
    const selectTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    const command = db.transaction(() => {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(id);
      for (const name of names) {
        insertTag.run(name);
        const tag = selectTag.get(name) as { id: number };
        db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(
          id,
          tag.id,
        );
      }
      db.prepare(
        `UPDATE items SET ai_state = CASE WHEN ai_state = 'suggested' THEN 'accepted' ELSE ai_state END
         WHERE id = ?`,
      ).run(id);
    });
    command();

    return getItemDto(db, id);
  });
}
