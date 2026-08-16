import { fetchAllAdminInvoicesInRange, type AdminFirestoreInvoice } from './admin-invoices';
import { ensureDealersCached } from './dealer-cache';
import { invoiceAmountExclGst, toDateInputValue } from './invoices';
import { canonicalIndiaState, UNSPECIFIED_STATE } from './indiaStates';

export type StateSalesRow = {
  state: string;
  sales: number;
  invoiceCount: number;
  dealers: number;
  activeDealers: number;
  inactiveDealers: number;
  share: number;
};

type DealerForState = {
  id: string;
  billingState?: string | null;
  portalUserId?: string | null;
};

export function formatCompactInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function lastSixMonthsRange(now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  const start = new Date(now);
  start.setMonth(start.getMonth() - 6);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

function rangeCovers(outer: { start: string; end: string }, inner: { start: string; end: string }) {
  return outer.start <= inner.start && outer.end >= inner.end;
}

function recentCustomerIds(invoices: AdminFirestoreInvoice[]): Set<string> {
  const ids = new Set<string>();
  for (const inv of invoices) {
    const id = String(inv.customerId ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

function dealerHasRecentSales(dealer: DealerForState, recentIds: Set<string>): boolean {
  if (recentIds.has(dealer.id)) return true;
  const portalId = dealer.portalUserId?.trim();
  return Boolean(portalId && recentIds.has(portalId));
}

export function aggregateSalesByState(
  invoices: AdminFirestoreInvoice[],
  dealers: DealerForState[],
  recentIds: Set<string>,
): StateSalesRow[] {
  const byState = new Map<string, StateSalesRow>();

  const row = (state: string): StateSalesRow => {
    let next = byState.get(state);
    if (!next) {
      next = {
        state,
        sales: 0,
        invoiceCount: 0,
        dealers: 0,
        activeDealers: 0,
        inactiveDealers: 0,
        share: 0,
      };
      byState.set(state, next);
    }
    return next;
  };

  for (const inv of invoices) {
    const state = canonicalIndiaState(inv.billingState);
    const rec = row(state);
    rec.sales += invoiceAmountExclGst(inv);
    rec.invoiceCount += 1;
  }

  for (const dealer of dealers) {
    const state = canonicalIndiaState(dealer.billingState);
    if (state === UNSPECIFIED_STATE) continue;
    const rec = row(state);
    rec.dealers += 1;
    if (dealerHasRecentSales(dealer, recentIds)) rec.activeDealers += 1;
  }

  const mapped = [...byState.values()].filter(r => r.state !== UNSPECIFIED_STATE);
  const totalSales = mapped.reduce((sum, r) => sum + r.sales, 0);
  for (const rec of mapped) {
    rec.inactiveDealers = rec.dealers - rec.activeDealers;
    rec.share = totalSales > 0 ? rec.sales / totalSales : 0;
  }

  return mapped.sort((a, b) => b.sales - a.sales || a.state.localeCompare(b.state));
}

export async function loadSalesByState(options: {
  dateStart: string;
  dateEnd: string;
}): Promise<{ rows: StateSalesRow[]; truncated: boolean; totalSales: number }> {
  const period = { start: options.dateStart, end: options.dateEnd };
  const sixMonths = lastSixMonthsRange();
  const periodCoversSix = rangeCovers(period, sixMonths);

  const [periodResult, recentResult, dealers] = await Promise.all([
    fetchAllAdminInvoicesInRange({
      sort: 'date',
      category: 'all',
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      listCollection: 'invoiceSummaries',
    }),
    periodCoversSix
      ? Promise.resolve(null)
      : fetchAllAdminInvoicesInRange({
        sort: 'date',
        category: 'all',
        dateStart: sixMonths.start,
        dateEnd: sixMonths.end,
        listCollection: 'invoiceSummaries',
      }),
    ensureDealersCached(),
  ]);

  const recentSource = recentResult?.rows ?? periodResult.rows;
  const recentIds = recentCustomerIds(
    recentSource.filter(inv => {
      const day = String(inv.date ?? '').slice(0, 10);
      return day >= sixMonths.start && day <= sixMonths.end;
    }),
  );
  const rows = aggregateSalesByState(periodResult.rows, dealers, recentIds);
  const totalSales = rows.reduce((sum, r) => sum + r.sales, 0);
  return { rows, truncated: periodResult.truncated, totalSales };
}
