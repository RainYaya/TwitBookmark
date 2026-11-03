// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewStrip } from '../../src/web/components/ReviewStrip.js';
import type { Item } from '../../src/web/lib/api.js';

function oldItem(id: string, body: string): Item {
  return {
    id,
    source: 'twitter',
    title: body,
    url: `https://x.com/a/status/${id}`,
    created_at: '2026-09-01T00:00:00.000Z',
    saved_at: '2026-09-01T00:00:00.000Z',
    saved_source: 'tweet_created',
    imported_at: '2026-09-02T00:00:00.000Z',
    status: 'later',
    read: false,
    is_todo: false,
    todo_done: false,
    metadata: { body, name: 'Alice', screen_name: 'alice' },
    ai_tags: [],
    ai_summary: null,
    summary: null,
    ai_state: 'none',
    last_surfaced_at: null,
    deleted_at: null,
    collection_id: null,
    tags: [],
  };
}

describe('ReviewStrip', () => {
  it('renders the returned old items under a review heading', () => {
    render(
      <ReviewStrip
        items={[oldItem('1', '很久以前的第一条'), oldItem('2', '很久以前的第二条')]}
      />,
    );
    expect(screen.getByRole('heading', { name: '回看' })).toBeInTheDocument();
    expect(screen.getByText('很久以前的第一条')).toBeInTheDocument();
    expect(screen.getByText('很久以前的第二条')).toBeInTheDocument();
  });

  it('shows a quiet empty state', () => {
    render(<ReviewStrip items={[]} />);
    expect(screen.getByText('今天没有要回看的旧收藏。')).toBeInTheDocument();
  });
});
