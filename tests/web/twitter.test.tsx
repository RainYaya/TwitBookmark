// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Twitter from '../../src/web/routes/Twitter.js';
import type { Api, Item } from '../../src/web/lib/api.js';
import { groupByDate } from '../../src/web/components/Timeline.js';

function tweet(id: string, savedAt: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    source: 'twitter',
    title: `tweet ${id}`,
    url: `https://x.com/a/status/${id}`,
    created_at: savedAt,
    saved_at: savedAt,
    saved_source: 'tweet_created',
    imported_at: '2026-11-02T00:00:00.000Z',
    status: 'inbox',
    read: false,
    is_todo: false,
    todo_done: false,
    metadata: {
      body: `推文正文 ${id}`,
      name: 'Alice',
      screen_name: 'alice',
      avatar_url: 'https://example.com/avatar.jpg',
    },
    ai_tags: [],
    ai_summary: null,
    summary: null,
    ai_state: 'none',
    last_surfaced_at: null,
    deleted_at: null,
    tags: [],
    ...overrides,
  };
}

function makeClient(items: Item[]): Api {
  return {
    listItems: vi.fn(async () => ({ items })),
    patchItem: vi.fn(async (id, patch) => ({ ...items.find((row) => row.id === id)!, ...patch })),
    deleteItem: vi.fn(async () => undefined),
    bulk: vi.fn(async () => ({ updated: 0 })),
    restore: vi.fn(async (id) => items.find((row) => row.id === id)!),
    listTags: vi.fn(async () => []),
    createTag: vi.fn(async (name) => ({ id: 1, name, count: 0 })),
    renameTag: vi.fn(async (id, name) => ({ id, name, count: 0 })),
    deleteTag: vi.fn(async () => undefined),
    acceptAi: vi.fn(async () => ({ updated: 0 })),
    setTags: vi.fn(async (id, tags) => ({ ...items.find((row) => row.id === id)!, tags })),
    getDailyReview: vi.fn(async () => []),
  };
}

describe('groupByDate', () => {
  it('groups by local day with the newest day first', () => {
    const groups = groupByDate([
      tweet('a', '2026-11-02T10:00:00.000Z'),
      tweet('b', '2026-11-02T08:00:00.000Z'),
      tweet('c', '2026-11-01T10:00:00.000Z'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['c']);
    expect(groups[0].label).toContain('11月2日');
  });
});

describe('Twitter timeline', () => {
  it('renders date groups newest first and shows the inbox count', async () => {
    const items = [
      tweet('a', '2026-11-02T10:00:00.000Z'),
      tweet('b', '2026-11-02T08:00:00.000Z', { status: 'later' }),
      tweet('c', '2026-11-01T10:00:00.000Z', {
        metadata: {
          body: '带图片的推文',
          name: 'Bob',
          screen_name: 'bob',
          avatar_url: 'https://example.com/bob.jpg',
          media: [{ type: 'photo', thumb: 'media/pic.jpg', original: 'https://x.com/pic.jpg' }],
        },
      }),
    ];
    render(<Twitter client={makeClient(items)} />);

    expect(await screen.findByText('待处理 2 条')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0].textContent).toContain('11月2日');
    expect(headings[1].textContent).toContain('11月1日');
    expect(screen.getByText('推文正文 a')).toBeInTheDocument();
    const image = screen.getByAltText('媒体') as HTMLImageElement;
    expect(image.getAttribute('src')).toContain('media/pic.jpg');
    expect(screen.getAllByText('稍后').length).toBeGreaterThan(0);
  });

  it('filters the stream by status, tag and search', async () => {
    const user = userEvent.setup();
    const client = makeClient([tweet('a', '2026-11-02T10:00:00.000Z')]);
    render(<Twitter client={client} />);
    await screen.findByText('推文正文 a');

    await user.selectOptions(screen.getByLabelText('状态'), 'later');
    await waitFor(() =>
      expect(client.listItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: ['twitter'], status: 'later' }),
      ),
    );

    const search = screen.getByLabelText('搜索');
    await user.type(search, 'agent{Enter}');
    await waitFor(() =>
      expect(client.listItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'agent', status: 'later' }),
      ),
    );
  });

  it('shows AI suggestions and opens a detail panel with the summary', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      tweet('a', '2026-11-02T10:00:00.000Z', {
        summary: '人工摘要',
        ai_tags: ['AI', '工具'],
        ai_summary: 'AI 摘要',
        ai_state: 'suggested',
      }),
    ]);
    render(<Twitter client={client} />);
    await screen.findByText('推文正文 a');

    expect(screen.getByText('AI 建议')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '详情' }));

    const dialog = await screen.findByRole('dialog', { name: '条目详情' });
    expect(dialog).toHaveTextContent('人工摘要');
    expect(dialog).toHaveTextContent('AI 摘要');

    const summary = screen.getByLabelText('摘要');
    await user.clear(summary);
    await user.type(summary, '新的摘要');
    await user.click(screen.getByRole('button', { name: '保存摘要' }));
    await waitFor(() =>
      expect(client.patchItem).toHaveBeenCalledWith('a', { summary: '新的摘要' }),
    );
  });

  it('loads the next page with the cursor', async () => {
    const user = userEvent.setup();
    const client = makeClient([tweet('a', '2026-11-02T10:00:00.000Z')]);
    (client.listItems as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: Record<string, unknown> = {}) =>
        params.cursor
          ? { items: [tweet('old', '2026-10-01T10:00:00.000Z')] }
          : { items: [tweet('a', '2026-11-02T10:00:00.000Z')], nextCursor: 'next' },
    );
    render(<Twitter client={client} />);
    await screen.findByText('推文正文 a');

    await user.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('推文正文 old')).toBeInTheDocument();
    expect(client.listItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'next' }),
    );
  });
});
