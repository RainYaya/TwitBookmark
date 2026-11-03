import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';

export const SETTING_KEYS = [
  'lmstudio_base_url',
  'lmstudio_model',
  'taxonomy',
  'taxonomy_proposal',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const bodySchema = z
  .object({
    settings: z.record(z.string(), z.string()),
  })
  .strict();

export function readSettings(db: Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function writeSetting(db: Database, key: SettingKey, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function registerSettingsRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/settings', async () => ({ settings: readSettings(db) }));

  app.put('/api/settings', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid settings' });

    const entries = Object.entries(parsed.data.settings);
    const unknown = entries.find(([key]) => !SETTING_KEYS.includes(key as SettingKey));
    if (unknown) {
      return reply.code(400).send({ error: `unknown setting: ${unknown[0]}` });
    }

    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    db.transaction(() => {
      for (const [key, value] of entries) upsert.run(key, value);
    })();

    return { settings: readSettings(db) };
  });
}
