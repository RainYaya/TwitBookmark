import { useEffect, useRef } from 'react';

export type KeyHandler = (event: KeyboardEvent) => void;

export interface KeymapOptions {
  enabled?: boolean;
  prefixTimeout?: number;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

export function useKeymap(
  handlers: Record<string, KeyHandler>,
  options: KeymapOptions = {},
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const enabled = options.enabled ?? true;
  const prefixTimeout = options.prefixTimeout ?? 1000;

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) && event.key !== 'Escape') return;

      const key = event.key;
      if (pending) {
        const combo = `${pending} ${key}`;
        const handler = handlersRef.current[combo];
        clearPending();
        if (handler) {
          event.preventDefault();
          handler(event);
        }
        return;
      }

      const direct = handlersRef.current[key];
      if (direct) {
        event.preventDefault();
        direct(event);
        return;
      }

      const isPrefix = Object.keys(handlersRef.current).some((name) =>
        name.startsWith(`${key} `),
      );
      if (isPrefix) {
        pending = key;
        event.preventDefault();
        timer = setTimeout(clearPending, prefixTimeout);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, [enabled, prefixTimeout]);
}
