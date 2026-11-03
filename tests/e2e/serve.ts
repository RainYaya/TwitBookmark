import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from '../../src/server/app.js';
import { createDb } from '../../src/server/db.js';
import { seed } from './seed.js';

const dbPath = process.env.DB_PATH ?? 'data/e2e.db';
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const db = createDb(dbPath);
seed(db);

const mediaDir = resolve('data/media');
mkdirSync(mediaDir, { recursive: true });
const distDir = resolve('dist');
if (!existsSync(resolve(distDir, 'index.html'))) {
  throw new Error('dist/index.html is missing; run pnpm build first');
}

const app = buildApp({ db });
await app.register(fastifyStatic, { root: mediaDir, prefix: '/media/' });
await app.register(fastifyStatic, {
  root: distDir,
  prefix: '/',
  decorateReply: false,
  wildcard: false,
});
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'not found' });
  }
  return reply.sendFile('index.html', distDir);
});

await app.listen({ port: Number(process.env.PORT ?? 4319), host: '127.0.0.1' });
