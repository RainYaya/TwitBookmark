import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiClient,
  type Api,
  type Item,
  type ItemPatch,
  type ItemQuery,
  type Status,
  type Tag,
} from '../lib/api.js';
import { ItemDetail } from '../components/ItemDetail.js';
import { QuickPass } from '../components/QuickPass.js';
import { ReviewStrip } from '../components/ReviewStrip.js';
import { TagPicker } from '../components/TagPicker.js';
import { Timeline } from '../components/Timeline.js';
import { notifyDataChanged } from '../lib/events.js';

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'inbox', label: '收件箱' },
  { value: 'later', label: '稍后' },
  { value: 'done', label: '已消化' },
  { value: 'reference', label: '备查' },
];

export interface TwitterProps {
  client?: Api;
}

export default function Twitter({ client: injected }: TwitterProps) {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);
  const [items, setItems] = useState<Item[]>([]);
  const [review, setReview] = useState<Item[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [quick, setQuick] = useState(false);
  const [target, setTarget] = useState<Item | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    const query: ItemQuery = { source: ['twitter'], limit: 100 };
    if (statusFilter) query.status = statusFilter as Status;
    if (tagFilter) query.tag = tagFilter;
    if (q) query.q = q;
    const page = await client.listItems(query);
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }, [client, statusFilter, tagFilter, q]);

  const loadReview = useCallback(async () => {
    setReview(await client.getDailyReview(3));
  }, [client]);

  useEffect(() => {
    let active = true;
    loadItems().catch((reason: Error) => {
      if (active) setError(reason.message);
    });
    client
      .listTags()
      .then((next) => {
        if (active) setTags(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, loadItems]);

  useEffect(() => {
    let active = true;
    loadReview().catch((reason: Error) => {
      if (active) setError(reason.message);
    });
    return () => {
      active = false;
    };
  }, [loadReview]);

  const refresh = () => {
    void loadItems();
    void loadReview();
  };

  const inbox = items.filter((item) => item.status === 'inbox');

  const patch = async (item: Item, changes: ItemPatch) => {
    try {
      const updated = await client.patchItem(item.id, changes);
      setItems((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setReview((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setDetail((previous) => (previous?.id === updated.id ? updated : previous));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const acceptAi = async (item: Item) => {
    try {
      await client.acceptAi({ ids: [item.id] });
      if (detail?.id === item.id) setDetail(null);
      refresh();
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const acceptCurrent = async () => {
    try {
      await client.acceptAi({
        source: ['twitter'],
        ...(statusFilter ? { status: statusFilter as Status } : {}),
        ...(tagFilter ? { tag: tagFilter } : {}),
        ...(q ? { q } : {}),
      });
      refresh();
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const saveTags = async (names: string[]) => {    if (!target) return;
    try {
      const updated = await client.setTags(target.id, names);
      setItems((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setReview((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setDetail((previous) => (previous?.id === updated.id ? updated : previous));
      setTarget(null);
      setTags(await client.listTags());
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const saveDetailTags = async (names: string[]) => {
    if (!detail) return;
    try {
      const updated = await client.setTags(detail.id, names);
      setItems((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setReview((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setDetail(updated);
      setTags(await client.listTags());
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const query: ItemQuery = { source: ['twitter'], limit: 100, cursor: nextCursor };
      if (statusFilter) query.status = statusFilter as Status;
      if (tagFilter) query.tag = tagFilter;
      if (q) query.q = q;
      const page = await client.listItems(query);
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQ(qDraft.trim());
  };

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>推特流</h1>
          <p className="muted">按推文发布时间排列；旧推文也会进待处理队列。</p>
        </div>
        <div className="page-actions">
          <span className="inbox-count">待处理 {inbox.length} 条</span>
          <button type="button" onClick={() => void acceptCurrent()}>
            接受当前筛选建议
          </button>
          <button
            type="button"
            className="primary"
            disabled={inbox.length === 0}
            onClick={() => setQuick(true)}
          >
            快速过一遍
          </button>
        </div>
      </header>

      <section className="filters" aria-label="筛选">
        <label>
          <span>状态</span>
          <select
            aria-label="状态"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">全部</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>标签</span>
          <select
            aria-label="标签"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">全部</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <form className="search" onSubmit={submitSearch}>
          <input
            aria-label="搜索"
            value={qDraft}
            onChange={(event) => setQDraft(event.target.value)}
            placeholder="搜索推文正文、摘要"
          />
          <button type="submit">搜索</button>
        </form>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {quick ? (
        <QuickPass
          items={items}
          client={client}
          onClose={() => {
            setQuick(false);
            refresh();
          }}
        />
      ) : items.length > 0 ? (
        <>
          <Timeline
            items={items}
            onPatch={(item, changes) => void patch(item, changes)}
            onTag={(item) => setTarget(item)}
            onDetail={(item) => setDetail(item)}
            onAcceptAi={(item) => void acceptAi(item)}
          />
          {nextCursor ? (
            <button type="button" onClick={() => void loadMore()}>
              加载更多
            </button>
          ) : null}
          <ReviewStrip
            items={review}
            onPatch={(item, changes) => void patch(item, changes)}
            onTag={(item) => setTarget(item)}
            onAcceptAi={(item) => void acceptAi(item)}
          />
        </>
      ) : (
        <p className="empty">还没有导入推特书签。</p>
      )}

      {detail ? (
        <ItemDetail
          item={detail}
          onClose={() => setDetail(null)}
          onPatch={(changes) => void patch(detail, changes)}
          onSetTags={(names) => void saveDetailTags(names)}
          tagOptions={tags}
          onAcceptAi={() => void acceptAi(detail)}
        />
      ) : null}

      {target ? (
        <TagPicker
          tags={tags}
          selected={target.tags}
          onSave={(names) => void saveTags(names)}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </main>
  );
}
