// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Library from '../../src/web/routes/Library.js';
import type { Api, Item, Tag } from '../../src/web/lib/api.js';

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    source: 'browser',
    title: `书签 ${id}`,
    url: `https://example.com/${id}`,
    created_at: '2026-11-01T00:00:00.000Z',
    saved_at: '2026-11-01T00:00:00.000Z',
    saved_source: 'browser_added',
    imported_at: '2026-11-02T00:00:00.000Z',
    status: 'inbox',
    read: false,
    is_todo: false,
    todo_done: false,
    metadata: {},
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

function makeClient(initial: Item[], tags: Tag[] = []): Api & {
  listItems: ReturnType<typeof vi.fn>;
  bulk: ReturnType<typeof vi.fn>;
} {
  let items = [...initial];
  const listItems = vi.fn(async (params: Record<string, unknown> = {}) => {
    let rows = [...items];
    const sources = params.source as string[] | undefined;
    if (sources?.length) rows = rows.filter((row) => sources.includes(row.source));
    if (params.status) rows = rows.filter((row) => row.status === params.status);
    if (params.q) rows = rows.filter((row) => row.title.includes(String(params.q)));
    return { items: rows };
  });
  const bulk = vi.fn(async ({ ids, action }: { ids: string[]; action: string }) => {
    if (action === 'delete') {
      items = items.filter((row) => !ids.includes(row.id));
    }
    return { updated: ids.length };
  });
  return {
    listItems,
    bulk,
    patchItem: vi.fn(async (id: string, patch: Partial<Item>) => ({
      ...items.find((row) => row.id === id)!,
      ...patch,
    })),
    deleteItem: vi.fn(async () => undefined),
    restore: vi.fn(async (id: string) => items.find((row) => row.id === id)!),
    listTags: vi.fn(async () => tags),
    createTag: vi.fn(async (name: string) => ({ id: 1, name, count: 0 })),
    setTags: vi.fn(async (id: string, names: string[]) => ({
      ...items.find((row) => row.id === id)!,
      tags: names,
    })),
    acceptAi: vi.fn(async () => ({ updated: 1 })),
  } as unknown as Api & { listItems: ReturnType<typeof vi.fn>; bulk: ReturnType<typeof vi.fn> };
}

describe('Library', () => {
  it('renders items from the API client', async () => {
    const client = makeClient([
      item('a', { title: 'Example A', tags: ['工具'] }),
      item('b', {
        title: 'owner/repo',
        source: 'github',
        url: 'https://github.com/owner/repo',
        status: 'later',
      }),
    ]);
    render(<Library client={client} />);

    expect(await screen.findByText('Example A')).toBeInTheDocument();
    expect(screen.getAllByText('owner/repo').length).toBeGreaterThan(0);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('工具')).toBeInTheDocument();
  });

  it('refetches with source and search filters', async () => {
    const user = userEvent.setup();
    const client = makeClient([item('a'), item('b', { source: 'github' })]);
    render(<Library client={client} />);
    await screen.findByText('书签 a');

    await user.selectOptions(screen.getByLabelText('来源'), 'github');
    await waitFor(() =>
      expect(client.listItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: ['github'] }),
      ),
    );

    const search = screen.getByLabelText('搜索');
    await user.type(search, 'agent{Enter}');
    await waitFor(() =>
      expect(client.listItems).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'agent' })),
    );
  });

  it('cleans up ten rows at a time with the keyboard', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 12 }, (_, index) => item(String(index).padStart(2, '0')));
    const client = makeClient(items);
    render(<Library client={client} />);
    await screen.findByText('书签 00');

    await user.click(screen.getByRole('button', { name: '清理模式' }));
    expect(await screen.findAllByTestId('library-row')).toHaveLength(10);

    fireEvent.keyDown(document, { key: ' ' });
    expect(screen.getAllByTestId('library-row')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(document, { key: 'a' });
    const selected = screen
      .getAllByTestId('library-row')
      .filter((row) => row.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(10);

    fireEvent.keyDown(document, { key: 'd' });
    await waitFor(() =>
      expect(client.bulk).toHaveBeenCalledWith(
        expect.objectContaining({ ids: items.slice(0, 10).map((row) => row.id), action: 'delete' }),
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId('library-row')).toHaveLength(2));
  });

  it('exits cleanup mode with Escape', async () => {
    const user = userEvent.setup();
    const client = makeClient([item('a'), item('b')]);
    render(<Library client={client} />);
    await screen.findByText('书签 a');

    await user.click(screen.getByRole('button', { name: '清理模式' }));
    expect(await screen.findByText(/清理模式中/)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/清理模式中/)).not.toBeInTheDocument());
  });

  it('shows AI suggestions and accepts them per item', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      item('a', {
        ai_state: 'suggested',
        ai_tags: ['AI', '工具'],
        ai_summary: 'AI 摘要',
      }),
    ]);
    render(<Library client={client} />);

    expect(await screen.findByText('AI 建议')).toBeInTheDocument();
    expect(screen.getByText('AI 摘要')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '接受 AI' }));

    await waitFor(() =>
      expect(client.acceptAi).toHaveBeenCalledWith(expect.objectContaining({ ids: ['a'] })),
    );
  });

  it('accepts suggestions for the current filter', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      item('a', { ai_state: 'suggested', ai_tags: ['AI'], ai_summary: '摘要' }),
    ]);
    render(<Library client={client} />);
    await screen.findByText('AI 建议');

    await user.click(screen.getByRole('button', { name: '接受当前筛选建议' }));
    await waitFor(() =>
      expect(client.acceptAi).toHaveBeenCalledWith(
        expect.objectContaining({ source: ['browser', 'github'] }),
      ),
    );
  });

  it('loads the next page with the cursor', async () => {
    const user = userEvent.setup();
    const client = makeClient([item('a'), item('b')]);
    client.listItems.mockImplementation(async (params: Record<string, unknown> = {}) =>
      params.cursor
        ? { items: [item('b')] }
        : { items: [item('a')], nextCursor: 'next-page' },
    );
    render(<Library client={client} />);

    await screen.findByText('书签 a');
    expect(screen.queryByText('书签 b')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('书签 b')).toBeInTheDocument();
    expect(client.listItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'next-page' }),
    );
  });

  it('undoes a status change with u', async () => {
    const user = userEvent.setup();
    const client = makeClient([item('a')]);
    render(<Library client={client} />);
    await screen.findByText('书签 a');
    await user.click(screen.getByRole('button', { name: '清理模式' }));

    fireEvent.keyDown(document, { key: 's' });
    await waitFor(() =>
      expect(client.patchItem).toHaveBeenCalledWith('a', { status: 'later' }),
    );

    fireEvent.keyDown(document, { key: 'u' });
    await waitFor(() =>
      expect(client.patchItem).toHaveBeenLastCalledWith('a', { status: 'inbox' }),
    );

    fireEvent.keyDown(document, { key: 'd' });
    await waitFor(() =>
      expect(client.bulk).toHaveBeenCalledWith({ ids: ['a'], action: 'delete' }),
    );
    fireEvent.keyDown(document, { key: 'u' });
    await waitFor(() =>
      expect(client.bulk).toHaveBeenLastCalledWith({ ids: ['a'], action: 'restore' }),
    );
  });

  it('batch restores items in the trash view', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/library?deleted=1');
    const client = makeClient([
      item('a', { deleted_at: '2026-11-02T00:00:00.000Z' }),
      item('b', { deleted_at: '2026-11-02T00:00:00.000Z' }),
    ]);
    render(<Library client={client} />);
    await screen.findByText('回收站');

    await user.click(screen.getByRole('button', { name: '批量选择' }));
    fireEvent.keyDown(document, { key: 'a' });
    await user.click(screen.getByRole('button', { name: '恢复所选' }));

    await waitFor(() =>
      expect(client.bulk).toHaveBeenCalledWith({ ids: ['a', 'b'], action: 'restore' }),
    );
    window.history.replaceState({}, '', '/');
  });

  it('does not run cleanup keys while the tag picker is open', async () => {
    const user = userEvent.setup();
    const client = makeClient([item('a')], [{ id: 1, name: '工具', count: 1 }]);
    render(<Library client={client} />);
    await screen.findByText('书签 a');
    await user.click(screen.getByRole('button', { name: '清理模式' }));
    fireEvent.keyDown(document, { key: 't' });
    expect(await screen.findByRole('dialog', { name: '选择标签' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'd' });
    expect(client.bulk).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '选择标签' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/清理模式中/)).toBeInTheDocument();
  });

  it('applies batch tags as a delta and undoes them', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      item('a', { tags: ['甲'] }),
      item('b', { tags: ['乙'] }),
    ]);
    render(<Library client={client} />);
    await screen.findByText('书签 a');
    await user.click(screen.getByRole('button', { name: '清理模式' }));
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 't' });
    await screen.findByRole('dialog', { name: '选择标签' });
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(client.setTags).toHaveBeenCalledWith('a', ['甲']);
      expect(client.setTags).toHaveBeenCalledWith('b', ['乙']);
    });
    await screen.findByRole('button', { name: '撤销上一步 (u)' });

    fireEvent.keyDown(document, { key: 'u' });
    await waitFor(() => {
      expect(client.setTags).toHaveBeenLastCalledWith('b', ['乙']);
      expect(client.setTags).toHaveBeenCalledWith('a', ['甲']);
    });
  });
});
