import type { Item, ItemPatch, Status } from '../lib/api.js';
import { formatLocalDate } from '../lib/dates.js';

const STATUS_LABEL: Record<Status, string> = {
  inbox: '收件箱',
  later: '稍后',
  done: '已消化',
  reference: '备查',
};

interface MediaEntry {
  type?: string;
  thumb?: string | null;
  original?: string | null;
}

function mediaOf(item: Item): MediaEntry[] {
  const raw = item.metadata.media;
  return Array.isArray(raw) ? (raw as MediaEntry[]) : [];
}

function textOf(item: Item): string {
  const body = item.metadata.body;
  return typeof body === 'string' && body.trim() ? body : item.title;
}

function assetUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  return `/${path}`;
}

export interface ItemCardProps {
  item: Item;
  onPatch?: (patch: ItemPatch) => void;
  onTag?: () => void;
  onOpen?: () => void;
  onDetail?: () => void;
}

export function ItemCard({ item, onPatch, onTag, onOpen, onDetail }: ItemCardProps) {
  const name = typeof item.metadata.name === 'string' ? item.metadata.name : '';
  const screenName =
    typeof item.metadata.screen_name === 'string' ? item.metadata.screen_name : '';
  const avatar =
    typeof item.metadata.avatar_url === 'string' ? item.metadata.avatar_url : null;
  const media = mediaOf(item);

  return (
    <article className="item-card" data-testid="item-card" data-status={item.status}>
      <header className="item-card-head">
        {avatar ? (
          <img className="avatar" src={assetUrl(avatar)} alt="" loading="lazy" />
        ) : null}
        <div>
          <span className="author">{name || screenName || '未知作者'}</span>
          {screenName ? <span className="handle"> @{screenName}</span> : null}
        </div>
        <time className="muted">{formatLocalDate(item.saved_at)}</time>
      </header>

      <p className="item-body">{textOf(item)}</p>

      {item.summary ? <p className="item-summary">{item.summary}</p> : null}

      {item.ai_state === 'suggested' &&
      (item.ai_tags.length > 0 || item.ai_summary) ? (
        <div className="ai-suggest" data-testid="ai-suggest">
          <span className="ai-label">AI 建议</span>
          {item.ai_tags.map((tag) => (
            <span className="tag ai-tag" key={tag}>
              {tag}
            </span>
          ))}
          {item.ai_summary ? <span className="ai-summary">{item.ai_summary}</span> : null}
        </div>
      ) : null}

      {media.length > 0 ? (
        <div className="item-media">
          {media.map((entry, index) =>
            entry.thumb ? (
              <img
                key={`${entry.thumb}-${index}`}
                src={entry.thumb.startsWith('/') ? entry.thumb : `/${entry.thumb}`}
                alt="媒体"
                loading="lazy"
              />
            ) : (
              <span className="media-placeholder" key={`placeholder-${index}`}>
                媒体未下载
              </span>
            ),
          )}
        </div>
      ) : null}

      <footer className="item-card-foot">
        <label className="check">
          <input
            type="checkbox"
            checked={item.read}
            onChange={() => onPatch?.({ read: !item.read })}
          />
          <span>看过</span>
        </label>

        {item.is_todo ? (
          <label className="check">
            <input
              type="checkbox"
              checked={item.todo_done}
              onChange={() => onPatch?.({ todo_done: !item.todo_done })}
            />
            <span>做了</span>
          </label>
        ) : (
          <button type="button" className="link-button" onClick={() => onPatch?.({ is_todo: true })}>
            标为待办
          </button>
        )}

        <span className="status-badge">{STATUS_LABEL[item.status]}</span>

        <span className="tag-list">
          {item.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>

        {onTag ? (
          <button type="button" className="link-button" onClick={onTag}>
            标签
          </button>
        ) : null}

        {onDetail ? (
          <button type="button" className="link-button" onClick={onDetail}>
            详情
          </button>
        ) : null}

        <button
          type="button"
          className="link-button"
          onClick={onOpen ?? (() => window.open(item.url, '_blank', 'noopener'))}
        >
          打开原推
        </button>
      </footer>
    </article>
  );
}
