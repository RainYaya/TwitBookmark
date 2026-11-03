import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiClient,
  type AcceptAiPayload,
  type Api,
  type Item,
  type ItemPatch,
  type ItemQuery,
  type Status,
  type Tag,
} from '../lib/api.js';
import { useKeymap } from '../lib/keys.js';
import { DATA_CHANGED, notifyDataChanged } from '../lib/events.js';
import { LibraryTable } from '../components/LibraryTable.js';
import { ItemDetail } from '../components/ItemDetail.js';
import { TagPicker } from '../components/TagPicker.js';

const SCREEN = 10;

type Undo =
  | { kind: 'patch'; changes: Array<{ id: string; patch: ItemPatch }> }
  | { kind: 'restore'; ids: string[] }
  | { kind: 'tags'; changes: Array<{ id: string; tags: string[] }> };

export interface LibraryProps {
  client?: Api;
}

export default function Library({ client: injected }: LibraryProps) {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);
  const initial =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const deleted = initial.get('deleted') === '1';
  const collectionFilter = initial.get('collection') ?? '';
  const aiFilter = initial.get('ai') ?? '';
  const notedFilter = initial.get('noted') === '1';

  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<Tag[]>([]);
  const sourceFilter = initial.get('source') ?? '';
  const statusFilter = initial.get('status') ?? '';
  const tagFilter = initial.get('tag') ?? '';
  const [qDraft, setQDraft] = useState(initial.get('q') ?? '');
  const [q, setQ] = useState(initial.get('q') ?? '');
  const [cleanup, setCleanup] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerItems, setPickerItems] = useState<Item[] | null>(null);
  const [pickerBase, setPickerBase] = useState<string[]>([]);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [collectionName, setCollectionName] = useState('');
  const [detail, setDetail] = useState<Item | null>(null);

  const queryFor = useCallback(
    (extra: Partial<ItemQuery> = {}): ItemQuery => {
      const query: ItemQuery = { limit: cleanup ? 200 : 50, ...extra };
      if (deleted) query.deleted = true;
      query.source = sourceFilter
        ? [sourceFilter as 'twitter' | 'browser' | 'github']
        : ['twitter', 'browser', 'github'];
      if (statusFilter) query.status = statusFilter as Status;
      if (tagFilter) query.tag = tagFilter;
      if (collectionFilter) query.collection = collectionFilter;
      if (aiFilter === 'suggested' || aiFilter === 'none' || aiFilter === 'accepted') {
        query.ai = aiFilter;
      }
      if (notedFilter) query.noted = true;
      if (q) query.q = q;
      return query;
    },
    [cleanup, deleted, notedFilter, q, sourceFilter, statusFilter, tagFilter, collectionFilter, aiFilter],
  );

  useEffect(() => {
    let active = true;
    client
      .listTags()
      .then((next) => {
        if (active) setTags(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener(DATA_CHANGED, refresh);
    return () => window.removeEventListener(DATA_CHANGED, refresh);
  }, []);

  useEffect(() => {
    if (!collectionFilter || collectionFilter === 'none') return;
    let active = true;
    client
      .listCollections()
      .then((collections) => {
        if (active) {
          setCollectionName(
            collections.find((collection) => collection.id === collectionFilter)?.name ?? '',
          );
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, collectionFilter]);

  useEffect(() => {
    let active = true;

    setError(null);
    client
      .listItems(queryFor())
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setCursor(0);
        setSelected(new Set());
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [client, queryFor, deleted, cleanup, reload]);

  const screenStart = Math.floor(cursor / SCREEN) * SCREEN;
  const visible = cleanup ? items.slice(screenStart, screenStart + SCREEN) : items;

  const targets = useCallback((): Item[] => {
    const picked = items.filter((item) => selected.has(item.id));
    if (picked.length > 0) return picked;
    const current = items[cursor];
    return current ? [current] : [];
  }, [items, selected, cursor]);

  const toggleCurrent = useCallback(() => {
    const current = items[cursor];
    if (!current) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(current.id)) next.delete(current.id);
      else next.add(current.id);
      return next;
    });
  }, [items, cursor]);

  const removeTargets = useCallback(async () => {
    if (deleted) return;
    const list = targets();
    if (list.length === 0) return;
    const ids = list.map((item) => item.id);
    try {
      await client.bulk({ ids, action: 'delete' });
      const next = items.filter((item) => !ids.includes(item.id));
      setItems(next);
      setSelected(new Set());
      setCursor(Math.min(cursor, Math.max(0, next.length - 1)));
      setUndo({ kind: 'restore', ids });
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, cursor, deleted, items, targets]);

  const restoreTargets = useCallback(async () => {
    if (!deleted) return;
    const list = targets();
    if (list.length === 0) return;
    const ids = list.map((item) => item.id);
    try {
      await client.bulk({ ids, action: 'restore' });
      setItems((previous) => previous.filter((item) => !ids.includes(item.id)));
      setSelected(new Set());
      setCursor(0);
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, deleted, targets]);

  const applyStatus = useCallback(
    async (status: Status) => {
      const list = targets();
      if (list.length === 0) return;
      try {
        const updated = await Promise.all(
          list.map((item) => client.patchItem(item.id, { status })),
        );
        const byId = new Map(updated.map((item) => [item.id, item]));
        setItems((previous) => previous.map((item) => byId.get(item.id) ?? item));
        setSelected(new Set());
        setUndo({
          kind: 'patch',
          changes: list.map((item) => ({
            id: item.id,
            patch: { status: item.status },
          })),
        });
        notifyDataChanged();
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    [client, targets],
  );

  const openCurrent = useCallback(() => {
    const current = items[cursor];
    if (current) window.open(current.url, '_blank', 'noopener');
  }, [items, cursor]);

  const openPicker = useCallback(() => {
    const list = targets();
    if (list.length === 0) return;
    setPickerItems(list);
    setPickerBase([...new Set(list.flatMap((item) => item.tags))]);
  }, [targets]);

  const undoLast = useCallback(async () => {
    if (!undo) return;
    try {
      if (undo.kind === 'patch') {
        const updated = await Promise.all(
          undo.changes.map((change) => client.patchItem(change.id, change.patch)),
        );
        const byId = new Map(updated.map((item) => [item.id, item]));
        setItems((previous) => previous.map((item) => byId.get(item.id) ?? item));
      } else if (undo.kind === 'tags') {
        const updated = await Promise.all(
          undo.changes.map((change) => client.setTags(change.id, change.tags)),
        );
        const byId = new Map(updated.map((item) => [item.id, item]));
        setItems((previous) => previous.map((item) => byId.get(item.id) ?? item));
      } else {
        await client.bulk({ ids: undo.ids, action: 'restore' });
        setReload((value) => value + 1);
      }
      setUndo(null);
      setSelected(new Set());
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, undo]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const page = await client.listItems(queryFor({ cursor: nextCursor }));
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client, nextCursor, queryFor]);

  const acceptOne = useCallback(
    async (item: Item) => {
      try {
        await client.acceptAi({ ids: [item.id] });
        setReload((value) => value + 1);
        notifyDataChanged();
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    [client],
  );

  const saveDetail = useCallback(
    async (changes: ItemPatch) => {
      if (!detail) return;
      try {
        const updated = await client.patchItem(detail.id, changes);
        setItems((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
        setDetail(updated);
        notifyDataChanged();
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    [client, detail],
  );

  const saveDetailTags = useCallback(
    async (names: string[]) => {
      if (!detail) return;
      try {
        const updated = await client.setTags(detail.id, names);
        setItems((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
        setDetail(updated);
        client
          .listTags()
          .then(setTags)
          .catch(() => undefined);
        notifyDataChanged();
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    [client, detail],
  );

  const acceptCurrent = useCallback(async () => {    const payload: AcceptAiPayload = {
      source: sourceFilter
        ? [sourceFilter as 'twitter' | 'browser' | 'github']
        : ['twitter', 'browser', 'github'],
    };
    if (statusFilter) payload.status = statusFilter as Status;
    if (tagFilter) payload.tag = tagFilter;
    if (collectionFilter) payload.collection = collectionFilter;
    if (aiFilter === 'suggested' || aiFilter === 'none' || aiFilter === 'accepted') {
      payload.ai = aiFilter;
    }
    if (q) payload.q = q;
    try {
      await client.acceptAi(payload);
      setReload((value) => value + 1);
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [aiFilter, client, collectionFilter, q, sourceFilter, statusFilter, tagFilter]);

  useKeymap(
    {
      j: () => setCursor((value) => Math.min(value + 1, Math.max(0, items.length - 1))),
      k: () => setCursor((value) => Math.max(0, value - 1)),
      ' ': toggleCurrent,
      a: () => setSelected(new Set(visible.map((item) => item.id))),
      d: () => void removeTargets(),
      t: openPicker,
      u: () => void undoLast(),
      ...(deleted
        ? { r: () => void restoreTargets() }
        : {
            s: () => void applyStatus('later'),
            e: () => void applyStatus('reference'),
            c: () => void applyStatus('done'),
          }),
      Enter: openCurrent,
      o: openCurrent,
      Escape: () => {
        setCleanup(false);
        setSelected(new Set());
      },
    },
    { enabled: cleanup && !pickerItems },
  );

  useKeymap(
    { u: () => void undoLast() },
    { enabled: !cleanup && !pickerItems && undo !== null },
  );

  const saveTags = async (names: string[]) => {
    const list = pickerItems ?? [];
    const base = new Set(pickerBase);
    const nextSet = new Set(names);
    const added = names.filter((name) => !base.has(name));
    const removed = pickerBase.filter((name) => !nextSet.has(name));
    try {
      const updated = await Promise.all(
        list.map((item) => {
          const next = new Set(item.tags);
          for (const name of added) next.add(name);
          for (const name of removed) next.delete(name);
          return client.setTags(item.id, [...next]);
        }),
      );
      const byId = new Map(updated.map((item) => [item.id, item]));
      setItems((previous) => previous.map((item) => byId.get(item.id) ?? item));
      setUndo({
        kind: 'tags',
        changes: list.map((item) => ({ id: item.id, tags: [...item.tags] })),
      });
      setPickerItems(null);
      const nextTags = await client.listTags();
      setTags(nextTags);
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQ(qDraft.trim());
  };

  const hasSuggestions = items.some(
    (item) => item.ai_state === 'suggested' && (item.ai_tags.length > 0 || item.ai_summary),
  );

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>
            {deleted
              ? '回收站'
              : notedFilter
                ? '我的笔记'
                : aiFilter === 'suggested'
                  ? 'AI 建议'
                  : collectionFilter === 'none'
                    ? '未归类'
                    : collectionFilter
                      ? collectionName || '收藏夹'
                      : '全部收藏'}
          </h1>
          <p className="muted">
            {deleted
              ? '移除的条目都在这里，可随时恢复。'
              : aiFilter === 'suggested'
                ? 'AI 给出的标签与摘要，接受后进入正式标签。'
                : '推特书签、浏览器收藏和 GitHub 星标。'}
          </p>
        </div>
        <div className="page-actions">
          {!deleted && hasSuggestions ? (
            <button type="button" className="primary" onClick={() => void acceptCurrent()}>
              接受当前筛选建议
            </button>
          ) : null}
          <button
            type="button"
            className={cleanup ? 'active' : ''}
            onClick={() => {
              setCleanup((value) => !value);
              setSelected(new Set());
            }}
          >
            {deleted
              ? cleanup
                ? '退出选择'
                : '批量选择'
              : cleanup
                ? '退出清理'
                : '清理模式'}
          </button>
        </div>
      </header>

      <section className="filters" aria-label="筛选">
        <p className="filters-hint">从左侧选择分类，或直接搜索。</p>
        <form className="search" onSubmit={submitSearch}>
          <input
            aria-label="搜索"
            value={qDraft}
            onChange={(event) => setQDraft(event.target.value)}
            placeholder="搜索标题、正文、摘要"
          />
          <button type="submit">搜索</button>
        </form>
        {tagFilter ? <span className="filter-chip">标签：{tagFilter}</span> : null}
        {collectionFilter && collectionFilter !== 'none' ? (
          <span className="filter-chip">收藏夹：{collectionName || '…'}</span>
        ) : null}
        {collectionFilter === 'none' ? (
          <span className="filter-chip">未归类</span>
        ) : null}
        {aiFilter === 'suggested' ? <span className="filter-chip">AI 建议</span> : null}
        {notedFilter ? <span className="filter-chip">我的笔记</span> : null}
      </section>

      {error ? <p className="error">{error}</p> : null}

      {cleanup ? (
        <section className="cleanup" aria-label="清理模式">
          <div className="cleanup-bar">
            <span>
              清理模式中 · {items.length === 0 ? '0' : screenStart + 1}–
              {Math.min(screenStart + SCREEN, items.length)} / {items.length}
            </span>
            <span className="muted">
              {deleted
                ? 'j/k 移动 · Space 选择 · a 全屏 · r 恢复 · Esc 退出'
                : 'j/k 移动 · Space 选择 · a 全屏 · d 移除 · t 标签 · s 稍后 · e 备查 · c 已消化 · Enter 打开 · Esc 退出'}
            </span>
          </div>
          {selected.size > 0 ? (
            <p className="selection-count">已选 {selected.size} 条</p>
          ) : null}
          <div className="inline-actions">
            {deleted ? (
              <button type="button" onClick={() => void restoreTargets()}>
                恢复所选
              </button>
            ) : null}
            {undo ? (
              <button type="button" className="ghost" onClick={() => void undoLast()}>
                撤销上一步 (u)
              </button>
            ) : null}
          </div>
          <LibraryTable
            items={visible}
            selected={selected}
            cursorId={items[cursor]?.id}
            onAcceptAi={deleted ? undefined : (item) => void acceptOne(item)}
            onRowClick={(item) => setCursor(items.findIndex((row) => row.id === item.id))}
          />
          {items.length === 0 ? (
            <p className="empty">{deleted ? '回收站是空的。' : '这里已经清空了。'}</p>
          ) : null}
          {nextCursor ? (
            <button type="button" onClick={() => void loadMore()}>
              加载更多
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <LibraryTable
            items={items}
            onAcceptAi={deleted ? undefined : (item) => void acceptOne(item)}
            onRowClick={(item) => {
              if (!cleanup) setDetail(item);
            }}
            onRestore={
              deleted
                ? (item) => {
                    client
                      .restore(item.id)
                      .then(() => setReload((value) => value + 1))
                      .catch((reason: Error) => setError(reason.message));
                  }
                : undefined
            }
            showRestore={deleted}
          />
          {items.length === 0 ? <p className="empty">没有条目。</p> : null}
          {nextCursor ? (
            <button type="button" onClick={() => void loadMore()}>
              加载更多
            </button>
          ) : null}
        </>
      )}

      {pickerItems ? (
        <TagPicker
          tags={tags}
          selected={pickerBase}
          onSave={(names) => void saveTags(names)}
          onClose={() => setPickerItems(null)}
        />
      ) : null}

      {detail ? (
        <ItemDetail
          key={detail.id}
          item={detail}
          onClose={() => setDetail(null)}
          onPatch={(changes) => void saveDetail(changes)}
          onSetTags={deleted ? undefined : (names) => void saveDetailTags(names)}
          tagOptions={tags}
          onAcceptAi={
            detail.ai_state === 'suggested'
              ? () => {
                  void acceptOne(detail);
                  setDetail(null);
                }
              : undefined
          }
        />
      ) : null}
    </main>
  );
}
