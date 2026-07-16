export type PeriodPreset = 'month' | 'financial_year' | 'lifetime' | 'custom';

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Indian financial year starts 1 April. */
export function financialYearStart(date: Date): Date {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return new Date(startYear, 3, 1);
}

export function formatIsoLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function resolvePeriodBounds(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { from: string | null; to: string | null } {
  if (preset === 'lifetime') return { from: null, to: null };
  if (preset === 'month') {
    return {
      from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: toIsoDate(now),
    };
  }
  if (preset === 'financial_year') {
    return {
      from: toIsoDate(financialYearStart(now)),
      to: toIsoDate(now),
    };
  }
  return {
    from: customFrom.trim() || null,
    to: customTo.trim() || null,
  };
}

export function inPeriod(date: string, from: string | null, to: string | null): boolean {
  const d = String(date || '').slice(0, 10);
  if (!d) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function formatPeriodLabel(
  preset: PeriodPreset,
  from: string | null,
  to: string | null,
): string {
  if (preset === 'lifetime') return 'Lifetime';
  if (preset === 'month') {
    return from && to
      ? `${formatIsoLabel(from)} - ${formatIsoLabel(to)}`
      : 'This month';
  }
  if (preset === 'financial_year') {
    return from && to
      ? `FY ${formatIsoLabel(from)} - ${formatIsoLabel(to)}`
      : 'This financial year';
  }
  if (from && to) return `${formatIsoLabel(from)} - ${formatIsoLabel(to)}`;
  if (from) return `From ${formatIsoLabel(from)}`;
  if (to) return `Until ${formatIsoLabel(to)}`;
  return 'Pick a custom date range';
}
