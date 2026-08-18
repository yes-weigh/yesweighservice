import { YESONE_STAGE_FILTERS, type YesOneStageFilter } from './salesOrderWorkflow';
import type { AdminSalesOrderSort } from './admin-sales-orders';
import type { InvoiceCategory, SalesRangePreset } from '../types/invoices';
import { INVOICE_CATEGORIES } from '../types/invoices';

const STORAGE_PREFIX = 'yesweigh.salesOrders.returnFocus:';
const MAX_AGE_MS = 30 * 60 * 1000;

export const FROM_SALES_ORDER_LIST_STATE = { fromSalesOrderList: true as const };

type SavedDealer = {
  id: string;
  label: string;
  portalUserId: string | null;
};

export type SalesOrderListReturnFocus = {
  search: string;
  stageFilter: YesOneStageFilter | 'all';
  category: InvoiceCategory | 'all';
  rangePreset: SalesRangePreset;
  sort: AdminSalesOrderSort;
  dealers: SavedDealer[];
  aggregate: boolean;
  page: number;
  pageCursorIds: Array<string | null>;
  scrollTop: number;
  openedOrderId: string | null;
  savedAt: number;
};

function storageKey(listKey: string): string {
  return `${STORAGE_PREFIX}${listKey}`;
}

const RANGE_PRESETS = new Set<SalesRangePreset>([
  7, 30, 90, 365,
  'lifetime',
  'current_month',
  'previous_month',
  'financial_year',
  'previous_financial_year',
]);

function parseStageFilter(value: unknown): YesOneStageFilter | 'all' {
  if (value === 'all') return 'all';
  if (typeof value === 'string' && (YESONE_STAGE_FILTERS as string[]).includes(value)) {
    return value as YesOneStageFilter;
  }
  return 'all';
}

function parseCategoryFilter(value: unknown): InvoiceCategory | 'all' {
  if (value === 'all') return 'all';
  if (typeof value === 'string' && (INVOICE_CATEGORIES as readonly string[]).includes(value)) {
    return value as InvoiceCategory;
  }
  return 'all';
}

function parseRangePreset(value: unknown): SalesRangePreset {
  if (typeof value === 'number' && RANGE_PRESETS.has(value as SalesRangePreset)) {
    return value as SalesRangePreset;
  }
  if (typeof value === 'string' && RANGE_PRESETS.has(value as SalesRangePreset)) {
    return value as SalesRangePreset;
  }
  return 'financial_year';
}

function parseDealers(value: unknown): SavedDealer[] {
  if (!Array.isArray(value)) return [];
  const next: SavedDealer[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const id = String((row as SavedDealer).id ?? '').trim();
    if (!id) continue;
    next.push({
      id,
      label: String((row as SavedDealer).label ?? '').trim() || id,
      portalUserId: (row as SavedDealer).portalUserId ?? null,
    });
  }
  return next;
}

export function isFromSalesOrderList(state: unknown): boolean {
  return Boolean(
    state
    && typeof state === 'object'
    && (state as { fromSalesOrderList?: boolean }).fromSalesOrderList === true,
  );
}

export function rememberSalesOrderListReturn(
  listKey: string,
  focus: Omit<SalesOrderListReturnFocus, 'savedAt'>,
): void {
  try {
    const payload: SalesOrderListReturnFocus = { ...focus, savedAt: Date.now() };
    sessionStorage.setItem(storageKey(listKey), JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function peekSalesOrderListReturn(
  listKey: string,
  maxAgeMs = MAX_AGE_MS,
): SalesOrderListReturnFocus | null {
  try {
    const raw = sessionStorage.getItem(storageKey(listKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SalesOrderListReturnFocus>;
    if (Date.now() - Number(parsed.savedAt || 0) > maxAgeMs) {
      sessionStorage.removeItem(storageKey(listKey));
      return null;
    }
    const page = Math.max(1, Math.floor(Number(parsed.page) || 1));
    return {
      search: String(parsed.search ?? ''),
      stageFilter: parseStageFilter(parsed.stageFilter),
      category: parseCategoryFilter(parsed.category),
      rangePreset: parseRangePreset(parsed.rangePreset),
      sort: parsed.sort === 'oldest' || parsed.sort === 'latest' || parsed.sort === 'syncedAt'
        ? parsed.sort
        : 'latest',
      dealers: parseDealers(parsed.dealers),
      aggregate: Boolean(parsed.aggregate),
      page,
      pageCursorIds: Array.isArray(parsed.pageCursorIds)
        ? parsed.pageCursorIds.map(id => (id ? String(id) : null))
        : [null],
      scrollTop: Math.max(0, Number(parsed.scrollTop) || 0),
      openedOrderId: parsed.openedOrderId ? String(parsed.openedOrderId) : null,
      savedAt: Number(parsed.savedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearSalesOrderListOpenedRow(listKey: string): void {
  try {
    const current = peekSalesOrderListReturn(listKey);
    if (!current?.openedOrderId) return;
    rememberSalesOrderListReturn(listKey, { ...current, openedOrderId: null });
  } catch {
    // ignore
  }
}
