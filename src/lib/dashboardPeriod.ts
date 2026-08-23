import { toDateInputValue } from './invoices';

export type DashboardPeriodPreset =
  | 'today'
  | 'month'
  | 'last_month'
  | 'year'
  | 'last_year'
  | 'lifetime'
  | 'custom';

export const DASHBOARD_PERIOD_OPTIONS: Array<{ value: DashboardPeriodPreset; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: 'today', label: 'Today' },
  { value: 'last_month', label: 'Last month' },
  { value: 'year', label: 'This year (FY)' },
  { value: 'last_year', label: 'Last year (FY)' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom' },
];

export { DASHBOARD_PERIOD_OPTIONS as DASHBOARD_PERIOD_CHOICES };

const LIFETIME_START = '2000-04-01';

/** India financial year starts 1 April. */
function financialYearStart(now: Date): Date {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 3, 1);
}

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
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: toDateInputValue(start),
      end: toDateInputValue(end),
    };
  }
  if (preset === 'year') {
    return {
      start: toDateInputValue(financialYearStart(now)),
      end: toDateInputValue(now),
    };
  }
  if (preset === 'last_year') {
    const thisFy = financialYearStart(now);
    const start = new Date(thisFy.getFullYear() - 1, 3, 1);
    const end = new Date(thisFy.getFullYear(), 2, 31);
    return {
      start: toDateInputValue(start),
      end: toDateInputValue(end),
    };
  }
  if (preset === 'lifetime') {
    return {
      start: LIFETIME_START,
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

export function dashboardPeriodOptionLabel(preset: DashboardPeriodPreset): string {
  return DASHBOARD_PERIOD_OPTIONS.find(option => option.value === preset)?.label ?? 'Period';
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

export {
  formatDashboardPeriodLabel as formatDashboardPeriodRange,
};
