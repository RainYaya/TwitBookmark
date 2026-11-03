import { describe, expect, it } from 'vitest';
import { formatLocalDate, formatLocalDateTime } from '../../src/web/lib/dates.js';

describe('local date formatting', () => {
  it('formats by the local day, not the UTC slice', () => {
    const midnight = new Date(2026, 0, 1, 0, 30);
    expect(formatLocalDate(midnight.toISOString())).toBe('2026-01-01');
    expect(formatLocalDateTime(midnight.toISOString())).toBe('2026-01-01 00:30');
  });

  it('falls back quietly for missing or invalid values', () => {
    expect(formatLocalDate(null)).toBe('');
    expect(formatLocalDate('not-a-date')).toBe('not-a-date');
  });
});
