import type { AdminFirestoreSalesOrder } from './admin-sales-orders';
import {
  getInvoicePeriodBounds,
  invoiceDateTimeSortMs,
  invoiceStatusLabel,
} from './invoices';
import {
  yesOneStageLabelForAudience,
  yesOneStageStatusClass,
  type YesOneStageAudience,
  type YesOneStageFilter,
} from './salesOrderWorkflow';
import type { SalesOrderSealKind } from './salesOrderSeals';
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
  salespersonName: string | null;
  date: string | null;
  createdTime?: string | null;
  sortAt: number;
  amount: number;
  currencyCode: string;
  statusRaw: string;
  statusLabel: string;
  statusClass: string;
  /** Dealer cart → Zoho Draft awaiting admin action. */
  isOrderPlaced: boolean;
  /** Stage seal stamp for list rows (null when none). */
  sealKind: SalesOrderSealKind | null;
  /** Line rates customized for this SO. */
  priceCustomized: boolean;
  category: InvoiceCategory | null;
  categories: InvoiceCategory[];
  categoryAmounts: Partial<Record<InvoiceCategory, number>>;
  freightSku?: string | null;
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

/** Numeric SO suffix for sorting (`SO-19874` → 19874). */
export function salesOrderNumberSortValue(value: string | null | undefined): number {
  const match = String(value ?? '').match(/(\d+)\s*$/);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
}

/** Highest sales-order number first. */
export function compareSalesOrderNumberDesc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const diff = salesOrderNumberSortValue(b) - salesOrderNumberSortValue(a);
  if (diff) return diff;
  return String(b ?? '').localeCompare(String(a ?? ''), undefined, { numeric: true });
}

/** Dealer cart Draft that still needs admin attention. */
export function isDealerOrderPlaced(so: Pick<
  AdminFirestoreSalesOrder,
  'yesOneStage' | 'yesOneCreatedFromCart' | 'status' | 'referenceNumber'
>): boolean {
  const stage = String(so.yesOneStage || '').trim();
  if (stage === 'review') return true;
  if (so.yesOneCreatedFromCart && (!stage || stage === 'review')) return true;
  const zohoStatus = String(so.status || '').toLowerCase().replace(/\s+/g, '_');
  const isDraft = zohoStatus === 'draft' || zohoStatus === 'pending';
  const ref = String(so.referenceNumber || '');
  if (isDraft && /^YES-ORD-/i.test(ref) && !stage) return true;
  return false;
}

export function sealKindForSalesOrder(so: Pick<
  AdminFirestoreSalesOrder,
  'yesOneStage' | 'yesOneCreatedFromCart' | 'status' | 'referenceNumber'
>): SalesOrderSealKind | null {
  const stage = String(so.yesOneStage || '').trim();
  if (isDealerOrderPlaced(so) || stage === 'review') return 'under_review';
  if (stage === 'ready_for_payment') return 'awaiting_payment';
  if (stage === 'payment_submitted') return 'under_review';
  if (stage === 'completed') return 'invoiced';
  const zoho = String(so.status || '').toLowerCase().replace(/\s+/g, '_');
  if (zoho === 'invoiced') return 'invoiced';
  return null;
}

function resolveYesOneStage(so: AdminFirestoreSalesOrder): string {
  const stage = String(so.yesOneStage || '').trim();
  if (stage) return stage;
  if (isDealerOrderPlaced(so)) return 'review';
  return '';
}

function displayStatusForSo(
  so: AdminFirestoreSalesOrder,
  audience: YesOneStageAudience,
): {
  statusRaw: string;
  statusLabel: string;
  statusClass: string;
  isOrderPlaced: boolean;
  sealKind: SalesOrderSealKind | null;
} {
  const stage = resolveYesOneStage(so);
  const orderPlaced = isDealerOrderPlaced(so);
  const sealKind = sealKindForSalesOrder(so);

  if (
    stage === 'review'
    || stage === 'ready_for_payment'
    || stage === 'payment_submitted'
    || stage === 'completed'
    || stage === 'void'
  ) {
    return {
      statusRaw: stage,
      statusLabel: yesOneStageLabelForAudience(stage, audience),
      statusClass: yesOneStageStatusClass(stage),
      isOrderPlaced: orderPlaced || stage === 'review',
      sealKind,
    };
  }

  return {
    statusRaw: so.status,
    statusLabel: invoiceStatusLabel(so.status),
    statusClass: `invoices-status invoices-status--${String(so.status || 'draft').toLowerCase().replace(/\s+/g, '_')}`,
    isOrderPlaced: false,
    sealKind,
  };
}

export function mapZohoOrderToUnified(
  so: AdminFirestoreSalesOrder,
  basePath: string,
  audience: YesOneStageAudience = 'admin',
): UnifiedSalesOrderRow {
  const display = displayStatusForSo(so, audience);
  return {
    key: `zoho:${so.id}`,
    source: 'zoho',
    id: so.id,
    href: `${basePath}/sales-orders/${so.id}`,
    primaryNumber: so.salesOrderNumber || so.id,
    partyName: so.customerName || so.customerId || '—',
    customerId: so.customerId || null,
    salespersonName: so.salespersonName?.trim() || null,
    date: so.date,
    createdTime: so.createdTime ?? null,
    sortAt: invoiceDateTimeSortMs(so.date, so.createdTime) || parseDayTs(so.syncedAt),
    amount: Number(so.total ?? 0),
    currencyCode: so.currencyCode || 'INR',
    statusRaw: display.statusRaw,
    statusLabel: display.statusLabel,
    statusClass: display.statusClass,
    isOrderPlaced: display.isOrderPlaced,
    sealKind: display.sealKind,
    priceCustomized: Boolean(so.yesOnePriceCustomized),
    category: so.salesOrderCategory,
    categories: so.categories,
    categoryAmounts: so.categoryAmounts,
    freightSku: so.freightSku ?? null,
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
  options: { includePortalDuplicates?: boolean; audience?: YesOneStageAudience } = {},
): UnifiedSalesOrderRow[] {
  const audience = options.audience ?? 'admin';
  return zoho
    .map(row => mapZohoOrderToUnified(row, basePath, audience))
    .sort((a, b) => compareSalesOrderNumberDesc(a.primaryNumber, b.primaryNumber));
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
  if (raw === 'review' || raw === 'order_placed' || row.isOrderPlaced) return 'review';
  if (raw === 'ready_for_payment') return 'pay';
  if (raw === 'payment_submitted') return 'verify';
  if (raw === 'completed') return 'done';
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

export function countYesOneStages(rows: UnifiedSalesOrderRow[]): Record<YesOneStageFilter, number> {
  const counts: Record<YesOneStageFilter, number> = {
    review: 0,
    ready_for_payment: 0,
    payment_submitted: 0,
    completed: 0,
  };
  for (const row of rows) {
    const key = row.statusRaw as YesOneStageFilter;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

export function filterUnifiedSalesOrders(
  rows: UnifiedSalesOrderRow[],
  options: {
    search?: string;
    source?: UnifiedSalesOrderSource | 'all';
    statusChip?: UnifiedStatusChip;
    yesOneStage?: YesOneStageFilter | 'all';
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

  if (options.yesOneStage && options.yesOneStage !== 'all') {
    next = next.filter(row => row.statusRaw === options.yesOneStage);
  }

  const selectedCategory = options.category && options.category !== 'all'
    ? options.category
    : null;
  if (selectedCategory) {
    next = next.filter(row => row.categories.includes(selectedCategory));
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
        ...row.categories,
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

  // YesOne workflow stages use the full Review → SO → Pay → Verify → Done chain.
  const yesOneWorkflow = ['review', 'ready_for_payment', 'payment_submitted', 'completed']
    .includes(String(row.statusRaw || ''));
  const skippedIds = yesOneWorkflow
    ? undefined
    : new Set(['review', 'pay', 'verify']);
  const allDone = stage === 'done';
  const steps = buildUnifiedSteps({ stage, skippedIds, allDone });
  const so = steps.find(step => step.id === 'so');
  if (so && so.state === 'skipped') {
    so.state = allDone ? 'done' : 'current';
  }
  // On Pay/Verify, SO step is already done (Draft exists).
  if (yesOneWorkflow && (stage === 'pay' || stage === 'verify')) {
    if (so && so.state !== 'done') so.state = 'done';
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
