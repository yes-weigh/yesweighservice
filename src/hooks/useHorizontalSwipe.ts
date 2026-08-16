import { useEffect, type RefObject } from 'react';

const MIN_DISTANCE = 64;

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

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const onEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchend', onEnd);
    };
  }, [ref, enabled, onSwipeLeft, onSwipeRight]);
}
