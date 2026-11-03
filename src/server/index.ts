import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { createDb } from './db.js';

const port = Number(process.env.PORT ?? 4317);
const db = createDb(process.env.DB_PATH ?? 'data/bookmarks.db');
const app = buildApp({ db });

const mediaDir = resolve('data/media');
mkdirSync(mediaDir, { recursive: true });
await app.register(fastifyStatic, {
  root: mediaDir,
  prefix: '/media/',
});

const distDir = resolve('dist');
if (existsSync(resolve(distDir, 'index.html'))) {
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
}

await app.listen({ port, host: '127.0.0.1' });
console.log(`TwitBookmark running at http://localhost:${port}`);
