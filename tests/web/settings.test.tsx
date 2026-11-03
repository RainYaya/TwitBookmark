// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Settings from '../../src/web/routes/Settings.js';
import type { SettingsApi } from '../../src/web/lib/api.js';

function makeClient() {
  const settings: Record<string, string> = {
    lmstudio_base_url: 'http://localhost:1234/v1',
    lmstudio_model: 'm1',
    taxonomy_proposal: JSON.stringify([
      { name: 'AI', description: '人工智能' },
      { name: '工具', description: '效率工具' },
    ]),
  };
  const client = {
    getSettings: vi.fn(async () => ({ ...settings })),
    putSettings: vi.fn(async (update: Record<string, string>) => {
      Object.assign(settings, update);
      return { ...settings };
    }),
    listTags: vi.fn(async () => [{ id: 1, name: '工具', count: 2 }]),
    renameTag: vi.fn(async (id: number, name: string) => ({ id, name, count: 2 })),
    deleteTag: vi.fn(async () => undefined),
    getLatestJob: vi.fn(async () => null),
    scanImports: vi.fn(async () => [
      {
        name: 'tweets.json',
        path: 'data/imports/tweets.json',
        size: 100,
        modified_at: '2026-11-02T00:00:00.000Z',
        kind: 'twitter' as const,
      },
      {
        name: 'bookmarks.html',
        path: 'data/imports/bookmarks.html',
        size: 200,
        modified_at: '2026-11-02T00:00:00.000Z',
        kind: 'browser' as const,
      },
    ]),
    listModels: vi.fn(async () => ['m1', 'm2']),
    importTwitterPath: vi.fn(async () => ({
      seen: 48,
      inserted: 48,
      updated: 0,
      skipped: 0,
    })),
    importBrowserPath: vi.fn(async () => ({
      seen: 1730,
      inserted: 1390,
      updated: 0,
      skipped: 340,
    })),
    importTwitter: vi.fn(),
    importBrowser: vi.fn(),
    syncGithub: vi.fn(async () => ({
      seen: 676,
      inserted: 676,
      updated: 0,
      skipped: 0,
      fetched: 676,
    })),
    proposeTaxonomy: vi.fn(async () => []),
    classify: vi.fn(),
    getJob: vi.fn(),
    pauseJob: vi.fn(),
    resumeJob: vi.fn(),
  };
  return { client: client as unknown as SettingsApi, settings };
}

describe('Settings page', () => {
  it('saves the LM Studio model', async () => {
    const user = userEvent.setup();
    const { client } = makeClient();
    render(<Settings client={client} />);

    const select = await screen.findByLabelText('模型');
    await screen.findByRole('option', { name: 'm2' });
    await user.selectOptions(select, 'm2');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() =>
      expect(client.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lmstudio_model: 'm2' }),
      ),
    );
  });

  it('deletes a proposed tag and confirms the taxonomy', async () => {
    const user = userEvent.setup();
    const { client, settings } = makeClient();
    render(<Settings client={client} />);

    const row = await screen.findByTestId('taxonomy-AI');
    await user.click(within(row).getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认标签' }));

    await waitFor(() => {
      const call = (client.putSettings as ReturnType<typeof vi.fn>).mock.calls.find(
        ([update]) => typeof update.taxonomy === 'string',
      );
      expect(call).toBeTruthy();
      const saved = JSON.parse(call![0].taxonomy) as Array<{ name: string }>;
      expect(saved.map((tag) => tag.name)).toEqual(['工具']);
    });
    expect(JSON.parse(settings.taxonomy)).toEqual([
      { name: '工具', description: '效率工具' },
    ]);
  });

  it('imports a scanned file and shows the stats', async () => {
    const user = userEvent.setup();
    const { client } = makeClient();
    render(<Settings client={client} />);

    const row = await screen.findByTestId('scan-tweets.json');
    await user.click(within(row).getByRole('button', { name: '导入' }));

    await waitFor(() =>
      expect(client.importTwitterPath).toHaveBeenCalledWith('data/imports/tweets.json'),
    );
    expect(await screen.findByText(/新增 48/)).toBeInTheDocument();
  });

  it('renames and deletes existing tags', async () => {
    const user = userEvent.setup();
    const { client } = makeClient();
    render(<Settings client={client} />);

    const name = await screen.findByLabelText('已有标签 工具');
    await user.clear(name);
    await user.type(name, '效率');
    await user.click(screen.getByRole('button', { name: '改名' }));
    await waitFor(() => expect(client.renameTag).toHaveBeenCalledWith(1, '效率'));

    await user.click(screen.getByRole('button', { name: '删除标签' }));
    await waitFor(() => expect(client.deleteTag).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByLabelText('已有标签 工具')).not.toBeInTheDocument());
  });

  it('shows the latest classification job after a restart', async () => {
    const { client } = makeClient();
    (client.getLatestJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'job-1',
      kind: 'classify',
      status: 'paused',
      total: 48,
      done: 30,
      error: null,
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-02T00:00:00.000Z',
    });
    render(<Settings client={client} />);

    expect(await screen.findByText(/任务 paused/)).toBeInTheDocument();
    expect(screen.getByText(/30\/48/)).toBeInTheDocument();
  });

  it('syncs GitHub stars', async () => {
    const user = userEvent.setup();
    const { client } = makeClient();
    render(<Settings client={client} />);

    await user.click(screen.getByRole('button', { name: '同步 GitHub 星标' }));
    await waitFor(() => expect(client.syncGithub).toHaveBeenCalled());
    expect(await screen.findByText(/676/)).toBeInTheDocument();
  });
});
