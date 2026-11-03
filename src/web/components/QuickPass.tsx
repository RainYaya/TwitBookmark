import { useState } from 'react';
import type { Api, Item, ItemPatch, Status, Tag } from '../lib/api.js';
import { useKeymap } from '../lib/keys.js';
import { ItemCard } from './ItemCard.js';
import { TagPicker } from './TagPicker.js';

type CounterKey = 'read' | 'done' | 'later' | 'reference' | 'removed';

interface Undo {
  kind: 'patch' | 'delete' | 'tags';
  id: string;
  patch?: ItemPatch;
  tags?: string[];
  index: number;
  counter?: CounterKey;
}

export interface QuickPassProps {
  items: Item[];
  client: Api;
  onClose: () => void;
}

const EMPTY_COUNTS: Record<CounterKey, number> = {
  read: 0,
  done: 0,
  later: 0,
  reference: 0,
  removed: 0,
};

export function QuickPass({ items, client, onClose }: QuickPassProps) {
  const [rows, setRows] = useState(() => items.filter((item) => item.status === 'inbox'));
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState<Record<CounterKey, number>>(EMPTY_COUNTS);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [picker, setPicker] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);

  const current = rows[index];
  const finished = index >= rows.length;

  const advance = () => setIndex((value) => Math.min(value + 1, rows.length));

  const markRead = () => {
    if (!current) return;
    const wasRead = current.read;
    setRows((previous) =>
      previous.map((row) => (row.id === current.id ? { ...row, read: true } : row)),
    );
    if (!wasRead) setCounts((value) => ({ ...value, read: value.read + 1 }));
    setUndo(
      wasRead
        ? null
        : {
            kind: 'patch',
            id: current.id,
            patch: { read: false },
            index,
            counter: 'read',
          },
    );
    advance();
    void client.patchItem(current.id, { read: true }).catch(() => undefined);
  };

  const patchCard = (patch: ItemPatch) => {
    if (!current) return;
    if (patch.read === true) {
      markRead();
      return;
    }
    setRows((previous) =>
      previous.map((row) => (row.id === current.id ? { ...row, ...patch } : row)),
    );
    void client.patchItem(current.id, patch).catch(() => undefined);
  };

  const applyStatus = (status: Status) => {
    if (!current) return;
    const counter: CounterKey = status === 'done' ? 'done' : status === 'later' ? 'later' : 'reference';
    const previousStatus = current.status;
    setRows((previous) =>
      previous.map((row) => (row.id === current.id ? { ...row, status } : row)),
    );
    setCounts((value) => ({ ...value, [counter]: value[counter] + 1 }));
    setUndo({
      kind: 'patch',
      id: current.id,
      patch: { status: previousStatus },
      index,
      counter,
    });
    advance();
    void client.patchItem(current.id, { status }).catch(() => undefined);
  };

  const remove = () => {
    if (!current) return;
    setCounts((value) => ({ ...value, removed: value.removed + 1 }));
    setUndo({ kind: 'delete', id: current.id, index, counter: 'removed' });
    advance();
    void client.deleteItem(current.id).catch(() => undefined);
  };

  const undoLast = async () => {
    if (!undo) return;
    try {
      if (undo.kind === 'delete') {
        await client.restore(undo.id);
      } else if (undo.kind === 'tags') {
        await client.setTags(undo.id, undo.tags ?? []);
      } else if (undo.patch) {
        await client.patchItem(undo.id, undo.patch);
      }
      setRows((previous) =>
        previous.map((row) => {
          if (row.id !== undo.id) return row;
          if (undo.kind === 'tags') return { ...row, tags: undo.tags ?? [] };
          return { ...row, ...(undo.kind === 'patch' ? undo.patch : {}) };
        }),
      );
      const counter = undo.counter;
      if (counter) {
        setCounts((value) => ({
          ...value,
          [counter]: Math.max(0, value[counter] - 1),
        }));
      }
      setIndex(undo.index);
      setUndo(null);
    } catch {
      // keep the item and the undo entry so the user can try again
    }
  };

  const openPicker = async () => {
    if (!current) return;
    setPicker(true);
    try {
      setTags(await client.listTags());
    } catch {
      setTags([]);
    }
  };

  const saveTags = async (names: string[]) => {
    if (!current) return;
    const previousTags = [...current.tags];
    try {
      const updated = await client.setTags(current.id, names);
      setRows((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setPicker(false);
      setUndo({ kind: 'tags', id: current.id, tags: previousTags, index });
      advance();
    } catch {
      setPicker(false);
    }
  };

  useKeymap(
    {
      j: () => setIndex((value) => Math.min(value + 1, Math.max(0, rows.length - 1))),
      k: () => setIndex((value) => Math.max(0, value - 1)),
      x: markRead,
      c: () => applyStatus('done'),
      s: () => applyStatus('later'),
      e: () => applyStatus('reference'),
      d: remove,
      t: () => void openPicker(),
      o: () => {
        if (current) window.open(current.url, '_blank', 'noopener');
      },
      u: () => void undoLast(),
      Escape: onClose,
    },
    { enabled: !picker },
  );

  if (finished) {
    return (
      <section className="quickpass" aria-label="快速过一遍">
        <h2>快速过一遍完成</h2>
        <ul className="quickpass-summary">
          <li>看过 {counts.read}</li>
          <li>已消化 {counts.done}</li>
          <li>稍后 {counts.later}</li>
          <li>备查 {counts.reference}</li>
          <li>移除 {counts.removed}</li>
        </ul>
        <div className="quickpass-actions">
          {undo ? (
            <button type="button" className="ghost" onClick={() => void undoLast()}>
              撤销上一步 (u)
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            回到时间线
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="quickpass" aria-label="快速过一遍">
      <div className="quickpass-bar">
        <span className="mono">
          {index + 1} / {rows.length}
        </span>
        <span className="muted">
          j/k 上下 · x 看过 · c 已消化 · s 稍后 · e 备查 · d 移除 · t 标签 · u 撤销 · Esc 退出
        </span>
      </div>

      {current ? (
        <ItemCard
          item={current}
          onPatch={patchCard}
          onTag={() => void openPicker()}
        />
      ) : null}

      <div className="quickpass-actions">
        {undo ? (
          <button type="button" className="ghost" onClick={() => void undoLast()}>
            撤销上一步 (u)
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={onClose}>
          退出
        </button>
      </div>

      {picker ? (
        <TagPicker
          tags={tags}
          selected={current?.tags ?? []}
          onSave={(names) => void saveTags(names)}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </section>
  );
}
