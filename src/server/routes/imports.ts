import type { FastifyInstance } from 'fastify';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Database } from '../db.js';
import { importBrowser } from '../importers/browser.js';
import { importTwitter, parseTwitterExport } from '../importers/twitter.js';

export interface ImportRoutesOptions {
  importsDir?: string;
}

const bodySchema = z
  .object({
    json: z.unknown().optional(),
    html: z.string().optional(),
    path: z.string().optional(),
  })
  .strict();

function readProjectFile(path: string): string {
  const root = process.cwd();
  const absolute = resolve(root, path);
  const lowerRoot = root.toLowerCase();
  const lowerAbsolute = absolute.toLowerCase();
  if (lowerAbsolute !== lowerRoot && !lowerAbsolute.startsWith(lowerRoot + sep)) {
    throw new Error('path outside project');
  }
  return readFileSync(absolute, 'utf8');
}

export function registerImportRoutes(
  app: FastifyInstance,
  db: Database,
  options: ImportRoutesOptions = {},
): void {
  const importsDir = options.importsDir ?? 'data/imports';

  app.get('/api/import/scan', async () => {
    let entries;
    try {
      entries = readdirSync(importsDir, { withFileTypes: true });
    } catch {
      return { files: [] };
    }

    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(importsDir, entry.name);
        const stat = statSync(full);
        const kind = entry.name.endsWith('.json')
          ? 'twitter'
          : /\.html?$/i.test(entry.name)
            ? 'browser'
            : 'other';
        return {
          name: entry.name,
          path: full,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
          kind,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { files };
  });

  app.post('/api/import/twitter', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });

    let raw: unknown;
    try {
      if (parsed.data.json !== undefined) {
        raw = parsed.data.json;
      } else if (parsed.data.path) {
        raw = JSON.parse(readProjectFile(parsed.data.path));
      } else {
        return reply.code(400).send({ error: 'json or path is required' });
      }
    } catch {
      return reply.code(400).send({ error: 'cannot read import file' });
    }

    if (!Array.isArray(raw)) {
      return reply.code(400).send({ error: 'twitter export must be an array' });
    }
    const entries = parseTwitterExport(raw);
    if (entries.length === 0 && raw.length > 0) {
      return reply.code(400).send({ error: 'no valid twitter entries' });
    }
    return importTwitter(db, entries);
  });

  app.post('/api/import/browser', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });

    let html: string;
    if (parsed.data.html !== undefined) {
      html = parsed.data.html;
    } else if (parsed.data.path) {
      try {
        html = readProjectFile(parsed.data.path);
      } catch {
        return reply.code(400).send({ error: 'cannot read import file' });
      }
    } else {
      return reply.code(400).send({ error: 'html or path is required' });
    }
    return importBrowser(db, html);
  });
}
