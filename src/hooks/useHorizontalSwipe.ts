import { useEffect, type RefObject } from 'react';

const MIN_DISTANCE = 64;

function shouldIgnore(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [data-no-swipe]'));
}

export function useHorizontalSwipe(
  ref: RefObject<HTMLElement | null>,
  handlers: {
    onSwipeRight?: () => void;
    onSwipeLeft?: () => void;
    enabled?: boolean;
  },
): void {
  const { onSwipeRight, onSwipeLeft, enabled = true } = handlers;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const finish = (clientX: number, clientY: number) => {
      if (!tracking) return;
      tracking = false;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (shouldIgnore(event.target)) return;
      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
    };

    const onPointerUp = (event: PointerEvent) => {
      finish(event.clientX, event.clientY);
    };

    node.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [ref, enabled, onSwipeLeft, onSwipeRight]);
}
