import { useState } from 'react';
import type { Tag } from '../lib/api.js';
import { useKeymap } from '../lib/keys.js';

export interface TagPickerProps {
  tags: Tag[];
  selected: string[];
  onSave: (names: string[]) => void;
  onClose: () => void;
}

export function TagPicker({ tags, selected, onSave, onClose }: TagPickerProps) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selected));
  const [draft, setDraft] = useState('');

  useKeymap({ Escape: onClose });

  const toggle = (name: string) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const names = new Set(chosen);
    const fresh = draft.trim();
    if (fresh) names.add(fresh);
    onSave([...names]);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="选择标签"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>标签</h2>
        <form onSubmit={submit}>
          <div className="tag-choices">
            {tags.length === 0 ? <p className="muted">还没有标签，直接在下面输入新建。</p> : null}
            {tags.map((tag) => (
              <label className="check" key={tag.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(tag.name)}
                  onChange={() => toggle(tag.name)}
                />
                <span>{tag.name}</span>
                <span className="muted">{tag.count}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>新标签</span>
            <input
              aria-label="新标签"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="输入后保存"
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
