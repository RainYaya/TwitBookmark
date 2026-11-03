import { execFile } from 'node:child_process';
import { load } from 'cheerio';

export interface ContextRow {
  id: string;
  title: string;
  url: string;
  source: string;
  metadata: string;
}

export type GhRunner = (args: string[]) => Promise<string>;

export interface ContextDeps {
  fetchImpl?: typeof fetch;
  runGh?: GhRunner;
  timeoutMs?: number;
  maxChars?: number;
}

const README_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 6000;
const MAX_DOWNLOAD_BYTES = 512 * 1024;

function defaultRunGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { timeout: README_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function normalizeText(input: string): string {
  return input
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPageText(html: string, maxChars = 1200): string | null {
  const $ = load(html);
  $('script,style,noscript,svg,iframe,canvas,form,nav,header,footer,aside').remove();

  const description =
    ($('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content') ??
      '').trim();

  let main = '';
  for (const selector of ['article', 'main', '[role="main"]']) {
    $(selector).each((_, element) => {
      const text = normalizeText($(element).text());
      if (text.length > main.length) main = text;
    });
  }
  if (main.length === 0) main = normalizeText($('body').text());

  const combined = normalizeText([description, main].filter(Boolean).join('\n'));
  const text = combined.slice(0, maxChars).trim();
  return text.length > 0 ? text : null;
}

function decodeHtml(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer.slice(0, MAX_DOWNLOAD_BYTES));
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function fetchPageText(
  url: string,
  deps: ContextDeps = {},
): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (isPrivateHost(target.hostname)) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxChars = deps.maxChars ?? 1000;
  try {
    const response = await fetchImpl(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(deps.timeoutMs ?? PAGE_TIMEOUT_MS),
      headers: {
        'user-agent': 'TwitBookmark/1.0 (local bookmark workbench)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) return null;
    const buffer = await response.arrayBuffer();
    const html = decodeHtml(buffer, type);
    return extractPageText(html, maxChars);
  } catch {
    return null;
  }
}

export function cleanReadme(raw: string): string {
  return normalizeText(
    raw
      .replace(/<!--[\s\S]*?-->/g, '')
      .split('\n')
      .filter(
        (line) =>
          !/^\s*\[!\[/.test(line) &&
          !/^\s*!\[/.test(line) &&
          !/<img\b/i.test(line),
      )
      .join('\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' '),
  );
}

export async function fetchReadme(
  fullName: string,
  deps: ContextDeps = {},
): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null;
  const runGh = deps.runGh ?? defaultRunGh;
  const maxChars = deps.maxChars ?? 1000;
  try {
    const raw = await runGh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${fullName}/readme`,
    ]);
    const cleaned = cleanReadme(raw);
    return cleaned.slice(0, maxChars).trim() || null;
  } catch {
    return null;
  }
}

function repoFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

function metadataOf(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function itemContext(
  row: ContextRow,
  deps: ContextDeps = {},
): Promise<string | null> {
  if (row.source === 'github') {
    const metadata = metadataOf(row.metadata);
    const fullName =
      typeof metadata.full_name === 'string' && metadata.full_name.length > 0
        ? metadata.full_name
        : repoFromUrl(row.url);
    if (!fullName) return null;
    return fetchReadme(fullName, deps);
  }
  if (row.source === 'browser') return fetchPageText(row.url, deps);
  return null;
}
