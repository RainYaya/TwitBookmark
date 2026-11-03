import { describe, expect, it, vi } from 'vitest';
import { fetchPageText, fetchReadme } from '../src/server/ai/context.js';

const PAGE = `<!doctype html>
<html>
  <head>
    <title>OCR 工具</title>
    <meta name="description" content="把图片转成文字" />
    <style>body { color: red }</style>
  </head>
  <body>
    <nav>首页 菜单</nav>
    <article>
      <h1>PaddleOCR</h1>
      <p>支持中文和表格识别。</p>
      <script>alert('tracking')</script>
    </article>
  </body>
</html>`;

describe('fetchPageText', () => {
  it('extracts the readable text and description from an HTML page', async () => {
    const fetchImpl = vi.fn(async () => new Response(PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    const text = await fetchPageText('https://example.com/ocr', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(text).toContain('把图片转成文字');
    expect(text).toContain('PaddleOCR');
    expect(text).toContain('支持中文和表格识别');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('首页 菜单');
  });

  it('refuses non-http, private and non-HTML targets without fetching them', async () => {
    const fetchImpl = vi.fn(async () => new Response(''));

    expect(await fetchPageText('file:///etc/passwd', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(await fetchPageText('http://localhost:1234/', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(await fetchPageText('http://192.168.1.1/', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    const pdf = vi.fn(async () => new Response('%PDF', {
      headers: { 'content-type': 'application/pdf' },
    }));
    expect(await fetchPageText('https://example.com/a.pdf', { fetchImpl: pdf as unknown as typeof fetch })).toBeNull();
  });

  it('returns null when the page cannot be loaded', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchPageText('https://example.com/x', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it('truncates long page text', async () => {
    const long = `<html><body><article>${'长'.repeat(5000)}</article></body></html>`;
    const fetchImpl = vi.fn(async () => new Response(long, {
      headers: { 'content-type': 'text/html' },
    }));
    const text = await fetchPageText('https://example.com/long', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxChars: 300,
    });
    expect(text).toHaveLength(300);
  });

  it('drops navigation and footer text when there is no article container', async () => {
    const html = `<html><body>
      <nav>首页 菜单</nav>
      <div><h1>SQLite WAL</h1><p>预写日志模式。</p></div>
      <footer>版权信息</footer>
    </body></html>`;
    const fetchImpl = vi.fn(async () => new Response(html, {
      headers: { 'content-type': 'text/html' },
    }));

    const text = await fetchPageText('https://example.com/wal', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(text).toContain('预写日志模式');
    expect(text).not.toContain('首页 菜单');
    expect(text).not.toContain('版权信息');
  });

  it('decodes a page whose encoding is declared as GBK', async () => {
    const prefix = new TextEncoder().encode('<html><body><article>');
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const suffix = new TextEncoder().encode('</article></body></html>');
    const body = new Uint8Array(prefix.length + gbk.length + suffix.length);
    body.set(prefix, 0);
    body.set(gbk, prefix.length);
    body.set(suffix, prefix.length + gbk.length);

    const fetchImpl = vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'text/html; charset=gbk' },
    }));

    const text = await fetchPageText('https://example.com/gbk', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(text).toContain('中文');
  });
});

describe('fetchReadme', () => {
  it('reads the README through gh and drops badge clutter', async () => {
    const runGh = vi.fn(async () => [
      '# immich',
      '',
      '[![build](https://img.shields.io/build)](https://ci.example.com)',
      '[![stars](https://img.shields.io/stars)](https://example.com)',
      '',
      'Self-hosted photo and video backup.',
      '',
      '## Features',
      '',
      '- Mobile apps',
    ].join('\n'));

    const text = await fetchReadme('immich-app/immich', { runGh });

    expect(runGh).toHaveBeenCalledWith([
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      'repos/immich-app/immich/readme',
    ]);
    expect(text).toContain('Self-hosted photo and video backup');
    expect(text).toContain('Mobile apps');
    expect(text).not.toContain('img.shields.io');
  });

  it('returns null when gh fails', async () => {
    const runGh = vi.fn(async () => {
      throw new Error('not found');
    });
    expect(await fetchReadme('nobody/nothing', { runGh })).toBeNull();
  });

  it('truncates long READMEs', async () => {
    const runGh = vi.fn(async () => 'x'.repeat(5000));
    const text = await fetchReadme('a/b', { runGh, maxChars: 200 });
    expect(text).toHaveLength(200);
  });
});
