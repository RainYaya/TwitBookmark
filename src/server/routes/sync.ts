import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import type { Database } from '../db.js';
import { importGithubStars } from '../importers/github.js';

export type GhRunner = () => Promise<unknown>;

export function fetchGithubStarsFromGh(): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'gh',
      ['api', 'user/starred?per_page=100', '--paginate', '--slurp'],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolvePromise(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

export function registerSyncRoutes(
  app: FastifyInstance,
  db: Database,
  ghRunner: GhRunner = fetchGithubStarsFromGh,
): void {
  app.post('/api/sync/github', async (_request, reply) => {
    try {
      const pages = await ghRunner();
      const stats = importGithubStars(db, pages);
      return { ...stats, fetched: stats.seen };
    } catch {
      return reply.code(502).send({ error: 'gh command failed; check that gh is installed and logged in' });
    }
  });
}
