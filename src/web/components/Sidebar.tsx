import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ApiClient,
  type Api,
  type Facets,
  type Source,
  type Status,
} from '../lib/api.js';
import { DATA_CHANGED, notifyDataChanged } from '../lib/events.js';

const STATUS_ITEMS: Array<{ value: Status; label: string }> = [
  { value: 'inbox', label: '收件箱' },
  { value: 'later', label: '稍后' },
  { value: 'done', label: '已消化' },
  { value: 'reference', label: '备查' },
];

const SOURCE_ITEMS: Array<{ value: Source; label: string }> = [
  { value: 'twitter', label: '推特' },
  { value: 'browser', label: '浏览器' },
  { value: 'github', label: 'GitHub' },
];

interface DraggedItem {
  id: string;
  tags: string[];
}

function readDrag(event: DragEvent): DraggedItem | null {
  try {
    const raw = event.dataTransfer.getData('application/x-twitbookmark-item');
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DraggedItem>;
    if (typeof value.id !== 'string') return null;
    return { id: value.id, tags: Array.isArray(value.tags) ? value.tags : [] };
  } catch {
    return null;
  }
}

function linkFor(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `/library${search ? `?${search}` : ''}`;
}

export interface SidebarProps {
  client?: Api;
}

export function Sidebar({ client: injected }: SidebarProps) {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);
  const location = useLocation();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFacets(await client.getFacets());
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(DATA_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(DATA_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const active = (params: Record<string, string>) => {
    if (location.pathname !== '/library') return false;
    const current = new URLSearchParams(location.search);
    const keys = Object.keys(params);
    if (current.size !== keys.length) return false;
    return keys.every((key) => current.get(key) === params[key]);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await client.createCollection(name);
      setNewName('');
      setCreating(false);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const rename = async (collection: { id: string; name: string }) => {
    const name = editName.trim();
    if (!name || name === collection.name) {
      setEditing(null);
      return;
    }
    try {
      await client.renameCollection(collection.id, name);
      setEditing(null);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const remove = async (collection: { id: string; name: string }) => {
    try {
      await client.deleteCollection(collection.id);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const dropOn = async (
    event: DragEvent,
    kind: 'collection' | 'tag' | 'status',
    value: string,
  ) => {
    event.preventDefault();
    setDropTarget(null);
    const dragged = readDrag(event);
    if (!dragged) return;
    try {
      if (kind === 'collection') {
        await client.patchItem(dragged.id, { collection_id: value === 'none' ? null : value });
      } else if (kind === 'tag') {
        await client.setTags(dragged.id, [...new Set([...dragged.tags, value])]);
      } else {
        await client.patchItem(dragged.id, { status: value as Status });
      }
      notifyDataChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const dropProps = (key: string, kind: 'collection' | 'tag' | 'status', value: string) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((previous) => (previous === key ? null : previous)),
    onDrop: (event: DragEvent) => void dropOn(event, kind, value),
  });

  const rowClass = (key: string, params: Record<string, string>, extra = '') =>
    [extra, active(params) ? 'is-active' : '', dropTarget === key ? 'is-drop' : '']
      .filter(Boolean)
      .join(' ');

  const counts = facets ?? {
    total: 0,
    deleted: 0,
    untagged: 0,
    unfiled: 0,
    noted: 0,
    aiSuggested: 0,
    statuses: { inbox: 0, later: 0, done: 0, reference: 0 },
    sources: { twitter: 0, browser: 0, github: 0 },
    tags: [],
    collections: [],
  };
  const visibleTags = tagsOpen ? counts.tags : counts.tags.slice(0, 12);

  return (
    <aside className="sidebar" aria-label="导航">
      <section className="sidebar-section">
        <Link to={linkFor({})} className={rowClass('all', {})}>
          <span>全部收藏</span>
          <span className="count">{counts.total}</span>
        </Link>
        {STATUS_ITEMS.map((status) => (
          <Link
            key={status.value}
            to={linkFor({ status: status.value })}
            className={rowClass(status.value, { status: status.value })}
            {...dropProps(status.value, 'status', status.value)}
          >
            <span>{status.label}</span>
            <span className="count">{counts.statuses[status.value]}</span>
          </Link>
        ))}
        <Link
          to={linkFor({ ai: 'suggested' })}
          className={rowClass('ai', { ai: 'suggested' }, 'ai-row')}
        >
          <span>AI 建议</span>
          <span className="count">{counts.aiSuggested}</span>
        </Link>
        <Link
          to={linkFor({ noted: '1' })}
          className={rowClass('noted', { noted: '1' })}
        >
          <span>我的笔记</span>
          <span className="count">{counts.noted}</span>
        </Link>
        <Link to={linkFor({ deleted: '1' })} className={rowClass('deleted', { deleted: '1' })}>
          <span>回收站</span>
          <span className="count">{counts.deleted}</span>
        </Link>
      </section>

      <section className="sidebar-section">
        <h3>来源</h3>
        {SOURCE_ITEMS.map((source) => (
          <Link
            key={source.value}
            to={linkFor({ source: source.value })}
            className={rowClass(`source-${source.value}`, { source: source.value })}
          >
            <span>{source.label}</span>
            <span className="count">{counts.sources[source.value]}</span>
          </Link>
        ))}
      </section>

      <section className="sidebar-section">
        <h3>
          收藏夹
          <button
            type="button"
            className="sidebar-add"
            aria-label="新建收藏夹"
            onClick={() => setCreating((value) => !value)}
          >
            +
          </button>
        </h3>
        {creating ? (
          <form
            className="sidebar-create"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              aria-label="收藏夹名称"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="收藏夹名称"
            />
            <button type="submit">建</button>
          </form>
        ) : null}
        {counts.collections.map((collection) =>
          editing === collection.id ? (
            <form
              key={collection.id}
              className="sidebar-create"
              onSubmit={(event) => {
                event.preventDefault();
                void rename(collection);
              }}
            >
              <input
                autoFocus
                aria-label={`重命名 ${collection.name}`}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
              <button type="submit">存</button>
            </form>
          ) : (
            <div key={collection.id} className="sidebar-row-wrap">
              <Link
                to={linkFor({ collection: collection.id })}
                className={rowClass(`collection-${collection.id}`, { collection: collection.id })}
                {...dropProps(`collection-${collection.id}`, 'collection', collection.id)}
              >
                <span className="folder-mark">▸</span>
                <span className="row-label">{collection.name}</span>
                <span className="count">{collection.count}</span>
              </Link>
              <span className="row-actions">
                <button
                  type="button"
                  aria-label={`重命名 ${collection.name}`}
                  onClick={() => {
                    setEditing(collection.id);
                    setEditName(collection.name);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${collection.name}`}
                  onClick={() => void remove(collection)}
                >
                  ×
                </button>
              </span>
            </div>
          ),
        )}
        <Link
          to={linkFor({ collection: 'none' })}
          className={rowClass('collection-none', { collection: 'none' }, 'muted-row')}
          {...dropProps('collection-none', 'collection', 'none')}
        >
          <span>未归类</span>
          <span className="count">{counts.unfiled}</span>
        </Link>
      </section>

      <section className="sidebar-section">
        <h3>
          标签
          {counts.tags.length > 12 ? (
            <button type="button" className="sidebar-add" onClick={() => setTagsOpen((v) => !v)}>
              {tagsOpen ? '收起' : '更多'}
            </button>
          ) : null}
        </h3>
        {visibleTags.length > 0 ? (
          visibleTags.map((tag) => (
            <Link
              key={tag.name}
              to={linkFor({ tag: tag.name })}
              className={rowClass(`tag-${tag.name}`, { tag: tag.name })}
              {...dropProps(`tag-${tag.name}`, 'tag', tag.name)}
            >
              <span className="row-label">{tag.name}</span>
              <span className="count">{tag.count}</span>
            </Link>
          ))
        ) : (
          <p className="sidebar-hint">接受 AI 建议后，标签会出现在这里。</p>
        )}
      </section>

      {error ? <p className="sidebar-error">{error}</p> : null}
    </aside>
  );
}
