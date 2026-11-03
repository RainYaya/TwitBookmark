import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from './db.js';
import { registerAiRoutes, type LmClientFactory } from './routes/ai.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerItemRoutes } from './routes/items.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSyncRoutes, type GhRunner } from './routes/sync.js';
import { registerTagRoutes } from './routes/tags.js';

export interface AppOptions {
  db: Database;
  ghRunner?: GhRunner;
  now?: () => string;
  lmClientFactory?: LmClientFactory;
  importsDir?: string;
}

export function buildApp({
  db,
  ghRunner,
  now,
  lmClientFactory,
  importsDir,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  registerItemRoutes(app, db);
  registerTagRoutes(app, db);
  registerImportRoutes(app, db, { importsDir });
  registerSyncRoutes(app, db, ghRunner);
  registerReviewRoutes(app, db, now);
  registerSettingsRoutes(app, db);
  registerAiRoutes(app, db, lmClientFactory);
  return app;
}
