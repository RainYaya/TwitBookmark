import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { nowIso } from '../lib/time.js';
import { getItemDto } from './items.js';

const querySchema = z.object({
  count: z.coerce.number().int().min(1).max(10).default(3),
});

export function registerReviewRoutes(
  app: FastifyInstance,
  db: Database,
  now: () => string = nowIso,
): void {
  app.get('/api/review/daily', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid count' });

    const current = now();
    const cutoff = new Date(
      new Date(current).getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rows = db
      .prepare(
        `SELECT i.id FROM items i
         WHERE i.deleted_at IS NULL
           AND i.status IN ('later', 'reference')
           AND (i.last_surfaced_at IS NULL OR i.last_surfaced_at <= ?)
         ORDER BY (i.last_surfaced_at IS NOT NULL) ASC, i.last_surfaced_at ASC, RANDOM()
         LIMIT ?`,
      )
      .all(cutoff, parsed.data.count) as Array<{ id: string }>;

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      db.prepare(
        `UPDATE items SET last_surfaced_at = ? WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ).run(current, ...ids);
    }

    const items = rows.flatMap((row) => {
      const dto = getItemDto(db, row.id);
      return dto ? [dto] : [];
    });
    return { items };
  });
}
