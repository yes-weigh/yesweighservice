import { toDateInputValue } from './invoices';

export type DashboardPeriodPreset = 'today' | 'month' | 'year' | 'custom';

export const DASHBOARD_PERIOD_OPTIONS: Array<{ value: DashboardPeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

export function defaultDashboardCustomRange(now = new Date()): { start: string; end: string } {
  return {
    start: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toDateInputValue(now),
  };
}

export function resolveDashboardPeriodBounds(
  preset: DashboardPeriodPreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { start: string; end: string } {
  if (preset === 'today') {
    const key = toDateInputValue(now);
    return { start: key, end: key };
  }
  if (preset === 'month') {
    return {
      start: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toDateInputValue(now),
    };
  }
  if (preset === 'year') {
    return {
      start: toDateInputValue(new Date(now.getFullYear(), 0, 1)),
      end: toDateInputValue(now),
    };
  }

  const from = customFrom.trim();
  const to = customTo.trim();
  const fallback = defaultDashboardCustomRange(now);
  let start = from || fallback.start;
  let end = to || fallback.end;
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  return { start, end };
}

export function formatDashboardPeriodLabel(start: string, end: string): string {
  const format = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  if (start === end) return format(start);
  return `${format(start)} – ${format(end)}`;
}
