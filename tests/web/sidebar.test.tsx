// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../src/web/components/Sidebar.js';
import type { Api, Facets } from '../../src/web/lib/api.js';

function facets(overrides: Partial<Facets> = {}): Facets {
  return {
    total: 10,
    deleted: 2,
    untagged: 6,
    unfiled: 7,
    noted: 3,
    aiSuggested: 5,
    statuses: { inbox: 8, later: 1, done: 1, reference: 0 },
    sources: { twitter: 2, browser: 5, github: 3 },
    tags: [
      { name: 'AI与模型', count: 4 },
      { name: '开发工具', count: 3 },
    ],
    collections: [{ id: 'c1', name: 'OCR 项目', count: 3 }],
    ...overrides,
  };
}

function makeClient(initial: Facets = facets()) {
  let current = initial;
  return {
    getFacets: vi.fn(async () => current),
    createCollection: vi.fn(async (name: string) => {
      current = {
        ...current,
        collections: [...current.collections, { id: 'c2', name, count: 0 }],
      };
      return { id: 'c2', name, position: 2, count: 0 };
    }),
    renameCollection: vi.fn(async (id: string, name: string) => ({ id, name, position: 1, count: 0 })),
    deleteCollection: vi.fn(async () => undefined),
    patchItem: vi.fn(async () => ({})),
    setTags: vi.fn(async () => ({})),
  } as unknown as Api;
}

function drop(target: HTMLElement, payload: { id: string; tags: string[] }) {
  fireEvent.drop(target, {
    dataTransfer: {
      getData: () => JSON.stringify(payload),
    },
  });
}

describe('Sidebar', () => {
  it('shows global counts and links to library views', async () => {
    render(
      <MemoryRouter>
        <Sidebar client={makeClient()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('全部收藏')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('AI 建议').closest('a')).toHaveAttribute(
      'href',
      '/library?ai=suggested',
    );
    expect(screen.getByText('OCR 项目').closest('a')).toHaveAttribute(
      'href',
      '/library?collection=c1',
    );
    expect(screen.getByText('AI与模型').closest('a')).toHaveAttribute(
      'href',
      '/library?tag=AI%E4%B8%8E%E6%A8%A1%E5%9E%8B',
    );
  });

  it('creates a collection from the sidebar', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(
      <MemoryRouter>
        <Sidebar client={client} />
      </MemoryRouter>,
    );
    await screen.findByText('OCR 项目');

    await user.click(screen.getByRole('button', { name: '新建收藏夹' }));
    await user.type(screen.getByLabelText('收藏夹名称'), '前端灵感{Enter}');
    await waitFor(() => expect(client.createCollection).toHaveBeenCalledWith('前端灵感'));
    expect(await screen.findByText('前端灵感')).toBeInTheDocument();
  });

  it('drops an item on a folder to file it, and on a tag to tag it', async () => {
    const client = makeClient();
    render(
      <MemoryRouter>
        <Sidebar client={client} />
      </MemoryRouter>,
    );
    const folder = (await screen.findByText('OCR 项目')).closest('a')!;
    drop(folder, { id: 'item-1', tags: ['AI与模型'] });
    await waitFor(() =>
      expect(client.patchItem).toHaveBeenCalledWith('item-1', { collection_id: 'c1' }),
    );

    const tag = screen.getByText('开发工具').closest('a')!;
    drop(tag, { id: 'item-1', tags: ['AI与模型'] });
    await waitFor(() =>
      expect(client.setTags).toHaveBeenCalledWith('item-1', ['AI与模型', '开发工具']),
    );
  });
});
