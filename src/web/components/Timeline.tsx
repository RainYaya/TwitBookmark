import type { Item, ItemPatch } from '../lib/api.js';
import { ItemCard } from './ItemCard.js';

export interface DateGroup {
  key: string;
  label: string;
  items: Item[];
}

const dayFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function groupByDate(items: Item[]): DateGroup[] {
  const groups = new Map<string, DateGroup>();
  for (const item of items) {
    const date = new Date(item.saved_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayFormat.format(date), items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export interface TimelineProps {
  items: Item[];
  onPatch?: (item: Item, patch: ItemPatch) => void;
  onTag?: (item: Item) => void;
  onOpen?: (item: Item) => void;
  onDetail?: (item: Item) => void;
}

export function Timeline({ items, onPatch, onTag, onOpen, onDetail }: TimelineProps) {
  const groups = groupByDate(items);
  return (
    <div className="timeline">
      {groups.map((group) => (
        <section className="timeline-group" key={group.key}>
          <h2 className="date-heading">{group.label}</h2>
          {group.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onPatch={onPatch ? (patch) => onPatch(item, patch) : undefined}
              onTag={onTag ? () => onTag(item) : undefined}
              onOpen={onOpen ? () => onOpen(item) : undefined}
              onDetail={onDetail ? () => onDetail(item) : undefined}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
