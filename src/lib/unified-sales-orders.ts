import type { AdminFirestoreSalesOrder } from './admin-sales-orders';
import {
  getInvoicePeriodBounds,
  invoiceStatusLabel,
} from './invoices';
import type { InvoiceCategory, KpiPeriod } from '../types/invoices';

export type UnifiedSalesOrderSource = 'zoho';

export type UnifiedSalesOrderSort = 'date' | 'syncedAt';

export interface UnifiedSalesOrderRow {
  key: string;
  source: UnifiedSalesOrderSource;
  id: string;
  href: string;
  primaryNumber: string;
  partyName: string;
  customerId: string | null;
  date: string | null;
  sortAt: number;
  amount: number;
  currencyCode: string;
  statusRaw: string;
  statusLabel: string;
  statusClass: string;
  category: InvoiceCategory | null;
  qty: number | null;
  /** Zoho reference number when present. */
  portalOrderNumber: string | null;
  zohoSalesOrderId: string | null;
  portalOrderId: string | null;
}

function parseDayTs(value: string | null | undefined): number {
  if (!value) return 0;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

export function mapZohoOrderToUnified(
  so: AdminFirestoreSalesOrder,
  basePath: string,
): UnifiedSalesOrderRow {
  return {
    key: `zoho:${so.id}`,
    source: 'zoho',
    id: so.id,
    href: `${basePath}/sales-orders/${so.id}`,
    primaryNumber: so.salesOrderNumber || so.id,
    partyName: so.customerName || so.customerId || '—',
    customerId: so.customerId || null,
    date: so.date,
    sortAt: parseDayTs(so.date) || parseDayTs(so.syncedAt),
    amount: Number(so.total ?? 0),
    currencyCode: so.currencyCode || 'INR',
    statusRaw: so.status,
    statusLabel: invoiceStatusLabel(so.status),
    statusClass: `invoices-status invoices-status--${String(so.status || 'draft').toLowerCase().replace(/\s+/g, '_')}`,
    category: so.salesOrderCategory,
    qty: so.itemQuantity,
    portalOrderNumber: so.referenceNumber,
    zohoSalesOrderId: so.id,
    portalOrderId: null,
  };
}

/** Map Zoho sales orders into unified list rows. */
export function mergeUnifiedSalesOrders(
  _portalIgnored: unknown[],
  zoho: AdminFirestoreSalesOrder[],
  basePath: string,
  _options: { includePortalDuplicates?: boolean } = {},
): UnifiedSalesOrderRow[] {
  return zoho
    .map(row => mapZohoOrderToUnified(row, basePath))
    .sort((a, b) => b.sortAt - a.sortAt);
}

export type UnifiedStageId = 'review' | 'so' | 'pay' | 'verify' | 'done' | 'rejected';

export type UnifiedStatusChip = 'all' | UnifiedStageId;

export const UNIFIED_PIPELINE_STEPS = [
  { id: 'review', label: 'Review' },
  { id: 'so', label: 'SO' },
  { id: 'pay', label: 'Pay' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Done' },
] as const;

export const UNIFIED_STATUS_CHIPS: Array<{ id: UnifiedStatusChip; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'so', label: 'SO' },
  { id: 'done', label: 'Done' },
  { id: 'rejected', label: 'Rejected' },
];

const PIPELINE_INDEX: Record<Exclude<UnifiedStageId, 'rejected'>, number> = {
  review: 0,
  so: 1,
  pay: 2,
  verify: 3,
  done: 4,
};

function normalizeZohoStatus(status: string): string {
  return String(status || 'draft').toLowerCase().replace(/\s+/g, '_');
}

export function getUnifiedStage(row: UnifiedSalesOrderRow): UnifiedStageId {
  const raw = normalizeZohoStatus(row.statusRaw);
  if (raw === 'void' || raw === 'cancelled' || raw === 'canceled') return 'rejected';
  if (raw === 'draft') return 'so';
  if (
    raw === 'invoiced'
    || raw.includes('invoice')
    || raw === 'closed'
    || raw === 'fulfilled'
    || raw === 'shipped'
  ) {
    return 'done';
  }
  return 'so';
}

export function filterUnifiedSalesOrders(
  rows: UnifiedSalesOrderRow[],
  options: {
    search?: string;
    source?: UnifiedSalesOrderSource | 'all';
    statusChip?: UnifiedStatusChip;
    category?: InvoiceCategory | 'all';
    period?: KpiPeriod;
  },
): UnifiedSalesOrderRow[] {
  let next = rows;

  if (options.source && options.source !== 'all') {
    next = next.filter(row => row.source === options.source);
  }

  if (options.statusChip && options.statusChip !== 'all') {
    next = next.filter(row => getUnifiedStage(row) === options.statusChip);
  }

  if (options.category && options.category !== 'all') {
    next = next.filter(row => row.category === options.category);
  }

  if (options.period) {
    const bounds = getInvoicePeriodBounds(options.period);
    if (bounds) {
      next = next.filter(row => {
        if (!row.date) return false;
        const ts = parseDayTs(row.date);
        if (!ts) return false;
        return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
      });
    }
  }

  const needle = options.search?.trim().toLowerCase() ?? '';
  if (needle) {
    next = next.filter(row => {
      const haystack = [
        row.primaryNumber,
        row.partyName,
        row.id,
        row.statusRaw,
        row.statusLabel,
        row.category,
        row.portalOrderNumber,
        row.zohoSalesOrderId,
        row.source,
        getUnifiedStage(row),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  return next;
}

export function countUnifiedStages(rows: UnifiedSalesOrderRow[]): Record<string, number> {
  const map: Record<string, number> = { all: rows.length };
  for (const chip of UNIFIED_STATUS_CHIPS) {
    if (chip.id === 'all') continue;
    map[chip.id] = 0;
  }
  for (const row of rows) {
    const stage = getUnifiedStage(row);
    map[stage] = (map[stage] || 0) + 1;
  }
  return map;
}

export function summarizeUnifiedAmounts(rows: UnifiedSalesOrderRow[]): {
  count: number;
  totalAmount: number;
  currencyCode: string | null;
} {
  const currencies = [...new Set(rows.map(row => row.currencyCode || 'INR'))];
  return {
    count: rows.length,
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    currencyCode: currencies.length === 1 ? currencies[0] : null,
  };
}

export type UnifiedProgressStepState = 'done' | 'current' | 'upcoming' | 'failed' | 'skipped';

export interface UnifiedProgressStep {
  id: string;
  label: string;
  state: UnifiedProgressStepState;
}

export interface UnifiedOrderProgress {
  steps: UnifiedProgressStep[];
  tone: 'zoho' | 'failed';
  stage: UnifiedStageId;
  currentLabel: string;
}

function buildUnifiedSteps(options: {
  stage: UnifiedStageId;
  skippedIds?: ReadonlySet<string>;
  allDone?: boolean;
}): UnifiedProgressStep[] {
  const { stage, skippedIds, allDone } = options;
  if (stage === 'rejected') {
    return UNIFIED_PIPELINE_STEPS.map((def, index) => ({
      ...def,
      state: (index === 0 ? 'failed' : 'upcoming') as UnifiedProgressStepState,
    }));
  }

  const currentIndex = PIPELINE_INDEX[stage];
  return UNIFIED_PIPELINE_STEPS.map((def, index) => {
    if (skippedIds?.has(def.id)) {
      return { ...def, state: 'skipped' as const };
    }
    if (allDone || stage === 'done') {
      return { ...def, state: 'done' as const };
    }
    if (index < currentIndex) return { ...def, state: 'done' as const };
    if (index === currentIndex) return { ...def, state: 'current' as const };
    return { ...def, state: 'upcoming' as const };
  });
}

export function getUnifiedOrderProgress(row: UnifiedSalesOrderRow): UnifiedOrderProgress {
  const stage = getUnifiedStage(row);

  if (stage === 'rejected') {
    return {
      steps: buildUnifiedSteps({ stage }),
      tone: 'failed',
      stage,
      currentLabel: row.statusLabel,
    };
  }

  const skippedIds = new Set(['review', 'pay', 'verify']);
  const allDone = stage === 'done';
  const steps = buildUnifiedSteps({ stage, skippedIds, allDone });
  const so = steps.find(step => step.id === 'so');
  if (so && so.state === 'skipped') {
    so.state = allDone ? 'done' : 'current';
  }

  return {
    steps,
    tone: 'zoho',
    stage,
    currentLabel: allDone
      ? 'Done'
      : UNIFIED_PIPELINE_STEPS[PIPELINE_INDEX[stage]]?.label ?? row.statusLabel,
  };
}
