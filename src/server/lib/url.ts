import { createHash } from 'node:crypto';

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^igshid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^ref_src$/i,
];

export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hostname = url.hostname.toLowerCase();
  url.username = '';
  url.password = '';
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }

  const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of sorted) {
    url.searchParams.append(key, value);
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  let result = url.toString();
  if (url.pathname === '/' && !url.search && !url.hash) {
    result = result.replace(/\/$/, '');
  }
  return result;
}

export function browserId(normalizedUrl: string): string {
  return createHash('sha1').update(normalizedUrl).digest('hex').slice(0, 12);
}
