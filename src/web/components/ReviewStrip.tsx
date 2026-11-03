import type { Item, ItemPatch } from '../lib/api.js';
import { ItemCard } from './ItemCard.js';

export interface ReviewStripProps {
  items: Item[];
  onPatch?: (item: Item, patch: ItemPatch) => void;
  onTag?: (item: Item) => void;
}

export function ReviewStrip({ items, onPatch, onTag }: ReviewStripProps) {
  return (
    <section className="review-strip" aria-label="回看">
      <h2>回看</h2>
      {items.length === 0 ? (
        <p className="muted">今天没有要回看的旧收藏。</p>
      ) : (
        <div className="review-items">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onPatch={onPatch ? (patch) => onPatch(item, patch) : undefined}
              onTag={onTag ? () => onTag(item) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
