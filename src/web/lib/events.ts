export const DATA_CHANGED = 'twitbookmark:data-changed';

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED));
}
