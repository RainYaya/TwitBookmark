import type { Item, Status } from '../lib/api.js';
import { formatLocalDate } from '../lib/dates.js';

const STATUS_LABEL: Record<Status, string> = {
  inbox: '收件箱',
  later: '稍后',
  done: '已消化',
  reference: '备查',
};

const SOURCE_LABEL = {
  twitter: '推特',
  browser: '浏览器',
  github: 'GitHub',
} as const;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function placeOf(item: Item): string {
  if (item.source === 'github') {
    const name = item.metadata.full_name;
    if (typeof name === 'string') return name;
    return item.url.replace(/^https?:\/\/github\.com\//, '');
  }
  return hostOf(item.url);
}

export interface LibraryTableProps {
  items: Item[];
  selected?: Set<string>;
  cursorId?: string | null;
  onRowClick?: (item: Item) => void;
  onRestore?: (item: Item) => void;
  onAcceptAi?: (item: Item) => void;
  showRestore?: boolean;
}

export function LibraryTable({
  items,
  selected,
  cursorId,
  onRowClick,
  onRestore,
  onAcceptAi,
  showRestore,
}: LibraryTableProps) {
  return (
    <div className="table-scroll">
      <table className="library-table">
      <thead>
        <tr>
          <th>标题</th>
          <th>来源</th>
          <th>位置</th>
          <th>标签</th>
          <th>状态</th>
          <th>日期</th>
          {showRestore ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isSelected = selected?.has(item.id) ?? false;
          return (
            <tr
              key={item.id}
              data-testid="library-row"
              data-status={item.status}
              aria-selected={isSelected}
              className={[
                isSelected ? 'is-selected' : '',
                item.id === cursorId ? 'is-cursor' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onRowClick?.(item)}
            >
              <td className="cell-title">
                <a href={item.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                  {item.title}
                </a>
                {item.summary ? <div className="item-summary">{item.summary}</div> : null}
                {item.ai_state === 'suggested' &&
                (item.ai_tags.length > 0 || item.ai_summary) ? (
                  <div className="ai-suggest" data-testid="ai-suggest">
                    <span className="ai-label">AI 建议</span>
                    {item.ai_tags.map((tag) => (
                      <span className="tag ai-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                    {item.ai_summary ? (
                      <span className="ai-summary">{item.ai_summary}</span>
                    ) : null}
                    {onAcceptAi ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onAcceptAi(item);
                        }}
                      >
                        接受 AI
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td>{SOURCE_LABEL[item.source]}</td>
              <td className="muted">{placeOf(item)}</td>
              <td>
                <span className="tag-list">
                  {item.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </span>
              </td>
              <td>
                <span className="status-chip" data-status={item.status}>
                  {STATUS_LABEL[item.status]}
                </span>
              </td>
              <td className="date-cell">{formatLocalDate(item.saved_at)}</td>
              {showRestore ? (
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRestore?.(item);
                    }}
                  >
                    恢复
                  </button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
      </table>
    </div>
  );
}
