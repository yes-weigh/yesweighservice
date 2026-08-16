import { useEffect, useRef, type RefObject } from 'react';

const MIN_DISTANCE = 40;
const MIN_VELOCITY = 0.38;
const WHEEL_THRESHOLD = 70;
const WHEEL_RESET_MS = 160;
const WHEEL_COOLDOWN_MS = 650;
const LOCK_RATIO = 1.15;

function shouldIgnore(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [data-no-swipe]'));
}

export type SwipeDirection = 'left' | 'right';

export function useHorizontalSwipe(
  ref: RefObject<HTMLElement | null>,
  handlers: {
    onSwipeRight?: () => void;
    onSwipeLeft?: () => void;
    onSwipeProgress?: (deltaX: number) => void;
    onSwipeEnd?: (committed: SwipeDirection | null) => void;
    enabled?: boolean;
  },
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const enabled = handlers.enabled ?? true;

  useEffect(() => {
    const node = ref.current?.closest('main') ?? ref.current;
    if (!node || !enabled) return undefined;

    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;
    let locked: 'h' | 'v' | null = null;
    let didSwipe = false;
    let accumX = 0;
    let accumY = 0;
    let wheelTimer: number | null = null;
    let coolUntil = 0;

    const trigger = (direction: SwipeDirection) => {
      didSwipe = true;
      if (direction === 'right') handlersRef.current.onSwipeRight?.();
      else handlersRef.current.onSwipeLeft?.();
      handlersRef.current.onSwipeEnd?.(direction);
    };

    const cancelDrag = () => {
      if (!tracking && locked !== 'h') return;
      tracking = false;
      locked = null;
      handlersRef.current.onSwipeEnd?.(null);
    };

    const finishPointer = (clientX: number, clientY: number) => {
      if (!tracking) return;
      tracking = false;
      const wasLocked = locked;
      locked = null;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const elapsed = Math.max(1, Date.now() - startAt);
      const velocity = dx / elapsed;
      const farEnough = Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * LOCK_RATIO;
      const flicked = Math.abs(velocity) >= MIN_VELOCITY && Math.abs(dx) > Math.abs(dy);
      if (wasLocked === 'h' && (farEnough || flicked)) {
        trigger(dx > 0 ? 'right' : 'left');
        return;
      }
      handlersRef.current.onSwipeEnd?.(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (shouldIgnore(event.target)) return;
      startX = event.clientX;
      startY = event.clientY;
      startAt = Date.now();
      tracking = true;
      locked = null;
      didSwipe = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        locked = Math.abs(dx) > Math.abs(dy) * LOCK_RATIO ? 'h' : 'v';
        if (locked === 'v') {
          tracking = false;
          return;
        }
      }
      if (locked !== 'h') return;
      if (event.cancelable) event.preventDefault();
      handlersRef.current.onSwipeProgress?.(dx);
    };

    const onPointerUp = (event: PointerEvent) => {
      finishPointer(event.clientX, event.clientY);
    };

    const onPointerCancel = () => {
      cancelDrag();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!didSwipe) return;
      event.preventDefault();
      event.stopPropagation();
      didSwipe = false;
    };

    const resetWheel = () => {
      accumX = 0;
      accumY = 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (Date.now() < coolUntil || shouldIgnore(event.target)) return;
      accumX += event.deltaX;
      accumY += event.deltaY;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
      }
      if (Math.abs(accumX) >= WHEEL_THRESHOLD && Math.abs(accumX) > Math.abs(accumY) * LOCK_RATIO) {
        coolUntil = Date.now() + WHEEL_COOLDOWN_MS;
        trigger(accumX < 0 ? 'right' : 'left');
        resetWheel();
        return;
      }
      if (wheelTimer) window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(resetWheel, WHEEL_RESET_MS);
    };

    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      if (wheelTimer) window.clearTimeout(wheelTimer);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, [ref, enabled]);
}
