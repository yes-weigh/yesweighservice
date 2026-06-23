import type { NavigateFunction } from 'react-router-dom';

type HistoryState = {
  idx?: number;
};

/** True when the browser history stack has a prior in-app entry (React Router sets `idx`). */
export function canNavigateBackInApp(): boolean {
  const state = window.history.state as HistoryState | null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

/** Prefer browser history (PWA / hardware back); fall back to a parent route when stack is empty. */
export function navigateBack(navigate: NavigateFunction, fallback: string): void {
  if (canNavigateBackInApp()) {
    navigate(-1);
    return;
  }
  navigate(fallback);
}
