// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuickPass } from '../../src/web/components/QuickPass.js';
import type { Api, Item } from '../../src/web/lib/api.js';

function tweet(id: string): Item {
  return {
    id,
    source: 'twitter',
    title: `tweet ${id}`,
    url: `https://x.com/a/status/${id}`,
    created_at: '2026-11-02T00:00:00.000Z',
    saved_at: '2026-11-02T00:00:00.000Z',
    saved_source: 'tweet_created',
    imported_at: '2026-11-02T00:00:00.000Z',
    status: 'inbox',
    read: false,
    is_todo: false,
    todo_done: false,
    metadata: { body: `正文 ${id}`, name: 'Alice', screen_name: 'alice' },
    ai_tags: [],
    ai_summary: null,
    summary: null,
    ai_state: 'none',
    last_surfaced_at: null,
    deleted_at: null,
    tags: [],
  };
}

function makeClient(items: Item[]) {
  return {
    client: {
      listItems: vi.fn(async () => ({ items })),
      patchItem: vi.fn(async (id: string, patch: Partial<Item>) => ({
        ...items.find((row) => row.id === id)!,
        ...patch,
      })),
      deleteItem: vi.fn(async () => undefined),
      bulk: vi.fn(async () => ({ updated: 0 })),
      restore: vi.fn(async (id: string) => items.find((row) => row.id === id)!),
      listTags: vi.fn(async () => []),
      createTag: vi.fn(async (name: string) => ({ id: 1, name, count: 0 })),
      setTags: vi.fn(async (id: string, tags: string[]) => ({
        ...items.find((row) => row.id === id)!,
        tags,
      })),
    } as unknown as Api,
  };
}

describe('QuickPass', () => {
  it('marks read with x and advances', async () => {
    const { client } = makeClient([tweet('1'), tweet('2'), tweet('3')]);
    render(<QuickPass items={[tweet('1'), tweet('2'), tweet('3')]} client={client} onClose={() => undefined} />);

    expect(screen.getByText('正文 1')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'x' });

    await waitFor(() => expect(client.patchItem).toHaveBeenCalledWith('1', { read: true }));
    expect(screen.getByText('正文 2')).toBeInTheDocument();
  });

  it('marks done with c and shows the summary at the end', async () => {
    const { client } = makeClient([tweet('1'), tweet('2'), tweet('3')]);
    render(<QuickPass items={[tweet('1'), tweet('2'), tweet('3')]} client={client} onClose={() => undefined} />);

    fireEvent.keyDown(document, { key: 'c' });
    fireEvent.keyDown(document, { key: 'c' });
    fireEvent.keyDown(document, { key: 'c' });

    await waitFor(() => expect(client.patchItem).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/快速过一遍完成/)).toBeInTheDocument();
    expect(screen.getByText('已消化 3')).toBeInTheDocument();
  });

  it('removes with d and restores the previous item with u', async () => {
    const { client } = makeClient([tweet('1'), tweet('2'), tweet('3')]);
    render(<QuickPass items={[tweet('1'), tweet('2'), tweet('3')]} client={client} onClose={() => undefined} />);

    fireEvent.keyDown(document, { key: 'd' });
    await waitFor(() => expect(client.deleteItem).toHaveBeenCalledWith('1'));
    expect(screen.getByText('正文 2')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'u' });
    await waitFor(() => expect(client.restore).toHaveBeenCalledWith('1'));
    expect(screen.getByText('正文 1')).toBeInTheDocument();
  });

  it('makes the card checkboxes work and advance', async () => {
    const user = userEvent.setup();
    const items = [tweet('1'), tweet('2')];
    const { client } = makeClient(items);
    render(<QuickPass items={items} client={client} onClose={() => undefined} />);

    await user.click(screen.getByRole('checkbox', { name: '看过' }));
    await waitFor(() => expect(client.patchItem).toHaveBeenCalledWith('1', { read: true }));
    expect(screen.getByText('正文 2')).toBeInTheDocument();
  });

  it('undoes a tag change with u', async () => {
    const items = [tweet('1'), tweet('2')];
    const { client } = makeClient(items);
    (client.listTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, name: '工具', count: 0 },
    ]);
    render(<QuickPass items={items} client={client} onClose={() => undefined} />);

    fireEvent.keyDown(document, { key: 't' });
    const dialog = await screen.findByRole('dialog', { name: '选择标签' });
    await userEvent.setup().click(
      screen.getByRole('checkbox', { name: /工具/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(client.setTags).toHaveBeenCalledWith('1', ['工具']));
    expect(screen.getByText('正文 2')).toBeInTheDocument();
    await screen.findByRole('button', { name: '撤销上一步 (u)' });

    fireEvent.keyDown(document, { key: 'u' });
    await waitFor(() => expect(client.setTags).toHaveBeenLastCalledWith('1', []));
    expect(screen.getByText('正文 1')).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
  });
});
