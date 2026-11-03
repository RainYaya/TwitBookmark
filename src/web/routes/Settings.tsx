import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiClient,
  type AiJob,
  type ImportFile,
  type ImportStats,
  type SettingsApi,
  type Tag,
  type TaxonomyTag,
} from '../lib/api.js';
import { KEY_BINDINGS } from '../components/Keymap.js';
import { formatLocalDateTime } from '../lib/dates.js';

export interface SettingsProps {
  client?: SettingsApi;
}

function parseTags(raw: string | undefined): TaxonomyTag[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is TaxonomyTag =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as TaxonomyTag).name === 'string',
      )
      .map((entry) => ({
        name: entry.name,
        description: typeof entry.description === 'string' ? entry.description : '',
      }));
  } catch {
    return [];
  }
}

interface LastSummary {
  unmatched: number;
  proposed: number;
}

function parseSummary(raw: string | undefined): LastSummary | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastSummary>;
    if (typeof value?.unmatched === 'number' && typeof value?.proposed === 'number') {
      return { unmatched: value.unmatched, proposed: value.proposed };
    }
  } catch {
    // ignore malformed summaries
  }
  return null;
}

function statsText(stats: ImportStats): string {
  return `新增 ${stats.inserted} · 更新 ${stats.updated} · 跳过 ${stats.skipped}`;
}

export default function Settings({ client: injected }: SettingsProps) {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);
  const [baseUrl, setBaseUrl] = useState('http://localhost:1234/v1');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxonomyTag[]>([]);
  const [existingTags, setExistingTags] = useState<Tag[]>([]);
  const [tagDrafts, setTagDrafts] = useState<Record<number, string>>({});
  const [newTag, setNewTag] = useState({ name: '', description: '' });
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [stats, setStats] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [lastSummary, setLastSummary] = useState<LastSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const twitterInput = useRef<HTMLInputElement>(null);
  const browserInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    client
      .getSettings()
      .then((settings) => {
        if (!active) return;
        setBaseUrl(settings.lmstudio_base_url || 'http://localhost:1234/v1');
        setModel(settings.lmstudio_model || '');
        const proposal = parseTags(settings.taxonomy_proposal);
        setTaxonomy(proposal.length > 0 ? proposal : parseTags(settings.taxonomy));
        setLastSummary(parseSummary(settings.ai_last_summary));
      })
      .catch((reason: Error) => active && setError(reason.message));

    client
      .scanImports()
      .then((next) => active && setFiles(next))
      .catch(() => undefined);
    client
      .listModels()
      .then((next) => active && setModels(next))
      .catch(() => undefined);
    client
      .listTags()
      .then((next) => {
        if (!active) return;
        setExistingTags(next);
        setTagDrafts(Object.fromEntries(next.map((tag) => [tag.id, tag.name])));
      })
      .catch(() => undefined);
    client
      .getLatestJob()
      .then((latest) => active && latest && setJob(latest))
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'running')) return;
    const timer = setInterval(async () => {
      try {
        const latest = await client.getJob(job.id);
        setJob(latest);
        if (latest.status === 'done') {
          const settings = await client.getSettings().catch(() => null);
          if (settings) {
            const proposal = parseTags(settings.taxonomy_proposal);
            if (proposal.length > 0) setTaxonomy(proposal);
            setLastSummary(parseSummary(settings.ai_last_summary));
          }
        }
      } catch {
        // keep polling
      }
    }, 800);
    return () => clearInterval(timer);
  }, [client, job]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = () =>
    run(async () => {
      await client.putSettings({
        lmstudio_base_url: baseUrl,
        lmstudio_model: model,
      });
      setMessage('设置已保存');
    });

  const refreshModels = () =>
    run(async () => {
      setModels(await client.listModels());
      setMessage('模型列表已刷新');
    });

  const scan = () =>
    run(async () => {
      setFiles(await client.scanImports());
    });

  const importFile = (file: ImportFile) =>
    run(async () => {
      if (file.kind === 'twitter') {
        setStats(statsText(await client.importTwitterPath(file.path)));
      } else if (file.kind === 'browser') {
        setStats(statsText(await client.importBrowserPath(file.path)));
      } else {
        setMessage('这个文件类型不支持导入');
      }
    });

  const importTwitterFile = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      const json = JSON.parse(await file.text()) as unknown;
      setStats(statsText(await client.importTwitter(json)));
    });

  const importBrowserFile = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      setStats(statsText(await client.importBrowser(await file.text())));
    });

  const syncGithub = () =>
    run(async () => {
      const result = await client.syncGithub();
      setStats(`${statsText(result)} · 抓取 ${result.fetched} 条`);
    });

  const propose = () =>
    run(async () => {
      const tags = await client.proposeTaxonomy();
      setTaxonomy(tags);
      setMessage('标签提案已生成，删改后确认。');
    });

  const confirmTaxonomy = () =>
    run(async () => {
      const json = JSON.stringify(taxonomy);
      await client.putSettings({ taxonomy: json, taxonomy_proposal: json });
      setMessage('标签已确认');
    });

  const startClassify = () =>
    run(async () => {
      setJob(await client.classify());
    });

  const pause = () =>
    run(async () => {
      if (job) setJob(await client.pauseJob(job.id));
    });

  const resume = () =>
    run(async () => {
      if (job) setJob(await client.resumeJob(job.id));
    });

  const addTag = () => {
    const name = newTag.name.trim();
    if (!name) return;
    setTaxonomy((previous) => [
      ...previous,
      { name, description: newTag.description.trim() },
    ]);
    setNewTag({ name: '', description: '' });
  };

  const renameExisting = (tag: Tag) =>
    run(async () => {
      const name = (tagDrafts[tag.id] ?? '').trim();
      if (!name || name === tag.name) return;
      await client.renameTag(tag.id, name);
      const next = await client.listTags();
      setExistingTags(next);
      setTagDrafts(Object.fromEntries(next.map((entry) => [entry.id, entry.name])));
      setMessage('标签已改名');
    });

  const deleteExisting = (tag: Tag) =>
    run(async () => {
      await client.deleteTag(tag.id);
      setExistingTags((previous) => previous.filter((entry) => entry.id !== tag.id));
      setMessage('标签已删除');
    });

  return (
    <main className="page settings">
      <header className="page-header">
        <div>
          <h1>设置</h1>
          <p className="muted">导入、GitHub 同步和本地 AI 分类。</p>
        </div>
      </header>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="settings-section">
        <h2>导入</h2>
        <div className="inline-actions">
          <button type="button" onClick={scan}>
            扫描 data/imports
          </button>
          <button type="button" onClick={() => twitterInput.current?.click()}>
            选择推特 JSON
          </button>
          <input
            ref={twitterInput}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="推特 JSON 文件"
            onChange={(event) => void importTwitterFile(event.target.files?.[0])}
          />
          <button type="button" onClick={() => browserInput.current?.click()}>
            选择浏览器 HTML
          </button>
          <input
            ref={browserInput}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            aria-label="浏览器 HTML 文件"
            onChange={(event) => void importBrowserFile(event.target.files?.[0])}
          />
        </div>
        <p className="muted small">把导出文件放进 data/imports 后点扫描，或直接选择文件。</p>

        {files.length > 0 ? (
          <table className="scan-table">
            <thead>
              <tr>
                <th>文件</th>
                <th>类型</th>
                <th>大小</th>
                <th>修改时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path} data-testid={`scan-${file.name}`}>
                  <td className="mono">{file.name}</td>
                  <td>
                    {file.kind === 'twitter'
                      ? '推特'
                      : file.kind === 'browser'
                        ? '浏览器'
                        : '其他'}
                  </td>
                  <td className="mono">{Math.round(file.size / 1024)} KB</td>
                  <td>{formatLocalDateTime(file.modified_at)}</td>
                  <td>
                    {file.kind === 'other' ? (
                      <span className="muted small">不支持</span>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() => void importFile(file)}
                      >
                        导入
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">还没有扫描到文件。</p>
        )}
        {stats ? <p className="notice">{stats}</p> : null}
      </section>

      <section className="settings-section">
        <h2>GitHub</h2>
        <div className="inline-actions">
          <button type="button" className="primary" onClick={() => void syncGithub()} disabled={busy}>
            同步 GitHub 星标
          </button>
        </div>
        <p className="muted small">
          使用本机已登录的 gh CLI，只新增和更新，不会取消任何 star。
        </p>
      </section>

      <section className="settings-section">
        <h2>LM Studio</h2>
        <div className="settings-grid">
          <label className="field">
            <span>地址</span>
            <input
              aria-label="LM Studio 地址"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>模型</span>
            <select
              aria-label="模型"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">未选择</option>
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => void refreshModels()} disabled={busy}>
            刷新模型
          </button>
          <button type="button" className="primary" onClick={() => void saveSettings()} disabled={busy}>
            保存设置
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>标签体系</h2>
        <div className="inline-actions">
          <button type="button" onClick={() => void propose()} disabled={busy}>
            生成标签提案
          </button>
          <button type="button" className="primary" onClick={() => void confirmTaxonomy()} disabled={busy}>
            确认标签
          </button>
        </div>

        {taxonomy.length > 0 ? (
          <table className="taxonomy-table">
            <tbody>
              {taxonomy.map((tag, index) => (
                <tr key={`${index}-${tag.name}`} data-testid={`taxonomy-${tag.name}`}>
                  <td>
                    <input
                      aria-label={`标签名 ${tag.name}`}
                      value={tag.name}
                      onChange={(event) =>
                        setTaxonomy((previous) =>
                          previous.map((entry, position) =>
                            position === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`标签定义 ${tag.name}`}
                      value={tag.description}
                      onChange={(event) =>
                        setTaxonomy((previous) =>
                          previous.map((entry, position) =>
                            position === index
                              ? { ...entry, description: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setTaxonomy((previous) =>
                          previous.filter((_, position) => position !== index),
                        )
                      }
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">还没有标签。先生成提案，或直接添加。</p>
        )}

        <div className="inline-actions">
          <input
            aria-label="新标签名"
            placeholder="新标签名"
            value={newTag.name}
            onChange={(event) => setNewTag((value) => ({ ...value, name: event.target.value }))}
          />
          <input
            aria-label="新标签定义"
            placeholder="一句定义"
            value={newTag.description}
            onChange={(event) =>
              setNewTag((value) => ({ ...value, description: event.target.value }))
            }
          />
          <button type="button" onClick={addTag}>
            添加
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>已有标签</h2>
        {existingTags.length > 0 ? (
          <table className="taxonomy-table">
            <tbody>
              {existingTags.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <input
                      aria-label={`已有标签 ${tag.name}`}
                      value={tagDrafts[tag.id] ?? tag.name}
                      onChange={(event) =>
                        setTagDrafts((previous) => ({
                          ...previous,
                          [tag.id]: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="muted mono">{tag.count}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void renameExisting(tag)}
                    >
                      改名
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void deleteExisting(tag)}
                    >
                      删除标签
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">还没有使用中的标签。</p>
        )}
      </section>

      <section className="settings-section">
        <h2>分类</h2>
        <div className="inline-actions">
          <button type="button" className="primary" onClick={() => void startClassify()} disabled={busy}>
            开始分类
          </button>
          {job?.status === 'running' ? (
            <button type="button" onClick={() => void pause()}>
              暂停
            </button>
          ) : null}
          {job?.status === 'paused' ? (
            <button type="button" onClick={() => void resume()}>
              继续
            </button>
          ) : null}
        </div>
        {job ? (
          <p className="mono small">
            任务 {job.status} · {job.done}/{job.total}
            {job.error ? ` · ${job.error}` : ''}
          </p>
        ) : null}
        {lastSummary && (lastSummary.unmatched > 0 || lastSummary.proposed > 0) ? (
          <p className="notice">
            上次分类：未归类 {lastSummary.unmatched} 条
            {lastSummary.proposed > 0
              ? `，已把 ${lastSummary.proposed} 个新标签加入上方「标签体系」，确认后再点一次「开始分类」即可补上。`
              : '，可在上方标签体系里补充更具体的标签。'}
          </p>
        ) : null}
        <p className="muted small">
          AI 只生成建议，不会覆盖你已确认的标签和摘要；重跑也只处理还没分类的条目。
        </p>
      </section>

      <section className="settings-section">
        <h2>键位</h2>
        <table className="keymap-inline">
          <tbody>
            {KEY_BINDINGS.map(([key, action]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h2>数据</h2>
        <p className="muted small">
          数据库 data/bookmarks.db，媒体 data/media，导入文件 data/imports。所有数据都在本机。
        </p>
      </section>
    </main>
  );
}
