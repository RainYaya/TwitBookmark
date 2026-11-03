import { useId, useState } from 'react';
import type { Item, ItemPatch, Tag } from '../lib/api.js';
import { formatLocalDate } from '../lib/dates.js';
import { useKeymap } from '../lib/keys.js';

interface MediaEntry {
  type?: string;
  thumb?: string | null;
  original?: string | null;
}

function assetUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  return `/${path}`;
}

export interface ItemDetailProps {
  item: Item;
  onClose: () => void;
  onPatch: (patch: ItemPatch) => void;
  onAcceptAi?: () => void;
  onSetTags?: (names: string[]) => void;
  tagOptions?: Tag[];
}

export function ItemDetail({
  item,
  onClose,
  onPatch,
  onAcceptAi,
  onSetTags,
  tagOptions = [],
}: ItemDetailProps) {
  const [summary, setSummary] = useState(item.summary ?? '');
  const [tagDraft, setTagDraft] = useState('');
  const tagListId = useId();
  const media = Array.isArray(item.metadata.media)
    ? (item.metadata.media as MediaEntry[])
    : [];
  const body =
    typeof item.metadata.body === 'string' && item.metadata.body.trim()
      ? item.metadata.body
      : item.title;

  useKeymap({ Escape: onClose });

  const addTag = (event: React.FormEvent) => {
    event.preventDefault();
    const name = tagDraft.trim();
    if (!name || !onSetTags) return;
    onSetTags([...new Set([...item.tags, name])]);
    setTagDraft('');
  };

  const removeTag = (name: string) => {
    onSetTags?.(item.tags.filter((tag) => tag !== name));
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal item-detail"
        role="dialog"
        aria-label="条目详情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="item-detail-head">
          <div>
            <h2>{item.title}</h2>
            <p className="muted small">{formatLocalDate(item.saved_at)}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <p className="item-body">{body}</p>

        {media.length > 0 ? (
          <div className="item-media">
            {media.map((entry, index) =>
              entry.thumb ? (
                <img
                  key={`${entry.thumb}-${index}`}
                  src={assetUrl(entry.thumb)}
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

        <div className="summary-editor">
          <label className="field">
            <span>我的笔记</span>
            <textarea
              aria-label="我的笔记"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={4}
              placeholder="写下这是做什么的、以后怎么用，比如「安卓和 Windows 通信，可以在 Windows 上看安卓系统」"
            />
          </label>
          <button type="button" className="primary" onClick={() => onPatch({ summary: summary.trim() || null })}>
            保存笔记
          </button>
        </div>

        {item.ai_state === 'suggested' &&
        (item.ai_tags.length > 0 || item.ai_summary) ? (
          <div className="ai-suggest">
            <span className="ai-label">AI 建议</span>
            {item.ai_tags.map((tag) => (
              <span className="tag ai-tag" key={tag}>
                {tag}
              </span>
            ))}
            {item.ai_summary ? <span className="ai-summary">{item.ai_summary}</span> : null}
            {onAcceptAi ? (
              <button type="button" className="link-button" onClick={onAcceptAi}>
                接受 AI
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="detail-tags">
          <span className="detail-label">标签</span>
          <div className="tag-list">
            {item.tags.map((tag) =>
              onSetTags ? (
                <button
                  type="button"
                  className="tag tag-editable"
                  key={tag}
                  aria-label={`移除标签 ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  {tag}
                  <span aria-hidden="true"> ×</span>
                </button>
              ) : (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ),
            )}
            {item.tags.length === 0 ? <span className="muted small">还没有标签</span> : null}
          </div>
          {onSetTags ? (
            <form className="tag-add" onSubmit={addTag}>
              <input
                aria-label="添加标签"
                list={tagOptions.length > 0 ? tagListId : undefined}
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                placeholder="输入标签，回车添加"
              />
              {tagOptions.length > 0 ? (
                <datalist id={tagListId}>
                  {tagOptions.map((tag) => (
                    <option key={tag.id} value={tag.name} />
                  ))}
                </datalist>
              ) : null}
              <button type="submit" className="ghost" disabled={!tagDraft.trim()}>
                添加
              </button>
            </form>
          ) : null}
        </div>

        <div className="modal-actions">
          <a href={item.url} target="_blank" rel="noreferrer">
            打开原链接
          </a>
        </div>
      </div>
    </div>
  );
}
