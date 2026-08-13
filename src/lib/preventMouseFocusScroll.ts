import type { MouseEvent } from 'react';

/**
 * Safari / macOS: mousedown focuses a list row or tile, then scroll-into-view
 * jumps the list to the top and the click never fires. preventDefault skips
 * that focus without blocking onClick. Keyboard focus (Tab) is unchanged.
 */
export function preventMouseFocusScroll(event: MouseEvent) {
  event.preventDefault();
}
