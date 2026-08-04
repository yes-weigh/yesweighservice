import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';

export const GATC_REPORTS_COLLECTION = 'gatcReports';

const functions = getFunctions(app, 'asia-south1');

export type GatcReportLineItem = {
  productId: string | null;
  itemId: string | null;
  sku: string | null;
  name: string;
  qty: number;
  baseRate: number;
  gatcFeePerUnit: number;
  gatcStampingPriceId: string | null;
  gatcStampingRange: string | null;
  unitRate: number;
  lineBaseTotal: number;
  lineGatcTotal: number;
  lineTotal: number;
  hasStamping: boolean;
  isWeighingScale: boolean;
};

export type GatcReportTotals = {
  lineCount: number;
  stampedLineCount: number;
  stampedQty: number;
  baseTotal: number;
  gatcFeeTotal: number;
  lineTotal: number;
};

export type GatcReportDoc = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  soId: string;
  salesOrderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  invoiceDate: string | null;
  soDate: string | null;
  referenceNumber: string | null;
  createdAt: string;
  source: string;
  hasStamping: boolean;
  hasWeighingScale: boolean;
  searchBlob: string;
  lineItems: GatcReportLineItem[];
  totals: GatcReportTotals;
};

function mapLine(raw: Record<string, unknown>): GatcReportLineItem {
  const gatcFeePerUnit = Number(raw.gatcFeePerUnit) || 0;
  const gatcStampingPriceId = String(raw.gatcStampingPriceId ?? '').trim() || null;
  return {
    productId: raw.productId != null ? String(raw.productId) : null,
    itemId: raw.itemId != null ? String(raw.itemId) : null,
    sku: raw.sku != null ? String(raw.sku) : null,
    name: String(raw.name ?? 'Item'),
    qty: Math.max(0, Math.floor(Number(raw.qty) || 0)),
    baseRate: Number(raw.baseRate) || 0,
    gatcFeePerUnit,
    gatcStampingPriceId,
    gatcStampingRange: raw.gatcStampingRange != null ? String(raw.gatcStampingRange) : null,
    unitRate: Number(raw.unitRate) || 0,
    lineBaseTotal: Number(raw.lineBaseTotal) || 0,
    lineGatcTotal: Number(raw.lineGatcTotal) || 0,
    lineTotal: Number(raw.lineTotal) || 0,
    hasStamping: Boolean(raw.hasStamping ?? (gatcStampingPriceId && gatcFeePerUnit > 0)),
    isWeighingScale: Boolean(raw.isWeighingScale),
  };
}

function mapReport(id: string, data: Record<string, unknown>): GatcReportDoc {
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      .map(mapLine)
    : [];
  const totalsRaw = (data.totals && typeof data.totals === 'object'
    ? data.totals as Record<string, unknown>
    : {}) as Record<string, unknown>;
  return {
    id,
    invoiceId: String(data.invoiceId ?? id),
    invoiceNumber: data.invoiceNumber != null ? String(data.invoiceNumber) : null,
    soId: String(data.soId ?? ''),
    salesOrderNumber: data.salesOrderNumber != null ? String(data.salesOrderNumber) : null,
    customerId: data.customerId != null ? String(data.customerId) : null,
    customerName: data.customerName != null ? String(data.customerName) : null,
    salespersonId: data.salespersonId != null ? String(data.salespersonId) : null,
    salespersonName: data.salespersonName != null ? String(data.salespersonName) : null,
    invoiceDate: data.invoiceDate != null ? String(data.invoiceDate) : null,
    soDate: data.soDate != null ? String(data.soDate) : null,
    referenceNumber: data.referenceNumber != null ? String(data.referenceNumber) : null,
    createdAt: String(data.createdAt ?? ''),
    source: String(data.source ?? 'portal_verify'),
    hasStamping: Boolean(data.hasStamping),
    hasWeighingScale: Boolean(
      data.hasWeighingScale
      ?? lineItems.some(line => line.isWeighingScale),
    ),
    searchBlob: String(data.searchBlob ?? ''),
    lineItems,
    totals: {
      lineCount: Number(totalsRaw.lineCount) || lineItems.length,
      stampedLineCount: Number(totalsRaw.stampedLineCount)
        || lineItems.filter(line => line.hasStamping).length,
      stampedQty: Number(totalsRaw.stampedQty)
        || lineItems.filter(line => line.hasStamping).reduce((s, line) => s + line.qty, 0),
      baseTotal: Number(totalsRaw.baseTotal)
        || lineItems.reduce((s, line) => s + line.lineBaseTotal, 0),
      gatcFeeTotal: Number(totalsRaw.gatcFeeTotal)
        || lineItems.reduce((s, line) => s + line.lineGatcTotal, 0),
      lineTotal: Number(totalsRaw.lineTotal)
        || lineItems.reduce((s, line) => s + line.lineTotal, 0),
    },
  };
}

export async function listGatcReports(pageSize = 100): Promise<GatcReportDoc[]> {
  const cap = Math.max(1, Math.min(500, pageSize));
  try {
    const snap = await getDocs(
      query(
        collection(db, GATC_REPORTS_COLLECTION),
        orderBy('invoiceDate', 'desc'),
        limit(cap),
      ),
    );
    return snap.docs.map(docSnap => mapReport(docSnap.id, docSnap.data() as Record<string, unknown>));
  } catch {
    // Fallback if invoiceDate index is not ready yet.
    const snap = await getDocs(
      query(
        collection(db, GATC_REPORTS_COLLECTION),
        orderBy('createdAt', 'desc'),
        limit(cap),
      ),
    );
    return snap.docs.map(docSnap => mapReport(docSnap.id, docSnap.data() as Record<string, unknown>));
  }
}

/**
 * Portal-stamped invoices in a date window (same membership as GATC Billwise).
 * Only reports with hasStamping are returned.
 */
export async function listGatcReportsInDateRange(options?: {
  dateStart?: string | null;
  dateEnd?: string | null;
  /** Soft cap — month windows are small; keep bounded for safety. */
  maxRows?: number;
}): Promise<GatcReportDoc[]> {
  const dateStart = options?.dateStart?.trim() || null;
  const dateEnd = options?.dateEnd?.trim() || null;
  const maxRows = Math.max(1, Math.min(2000, options?.maxRows ?? 1000));

  const mapSnap = (snap: Awaited<ReturnType<typeof getDocs>>) => (
    snap.docs
      .map(docSnap => mapReport(docSnap.id, docSnap.data() as Record<string, unknown>))
      .filter(report => report.hasStamping)
  );

  const runQuery = async (dateField: 'invoiceDate' | 'createdAt') => {
    const constraints: QueryConstraint[] = [];
    if (dateStart) constraints.push(where(dateField, '>=', dateStart));
    if (dateEnd) {
      // invoiceDate is YYYY-MM-DD; createdAt is ISO — end-of-day bound for ISO.
      const endBound = dateField === 'createdAt' && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)
        ? `${dateEnd}T23:59:59.999Z`
        : dateEnd;
      constraints.push(where(dateField, '<=', endBound));
    }
    constraints.push(orderBy(dateField, 'desc'));
    constraints.push(limit(maxRows));
    return getDocs(query(collection(db, GATC_REPORTS_COLLECTION), ...constraints));
  };

  try {
    return mapSnap(await runQuery('invoiceDate'));
  } catch {
    try {
      return mapSnap(await runQuery('createdAt'));
    } catch {
      // Last resort: scan newest reports and filter client-side.
      const fallback = (await listGatcReports(Math.min(500, maxRows)))
        .filter(report => report.hasStamping);
      return fallback.filter(report => {
        const day = String(report.invoiceDate || '').slice(0, 10);
        if (dateStart && day && day < dateStart) return false;
        if (dateEnd && day && day > dateEnd) return false;
        if ((dateStart || dateEnd) && !day) return false;
        return true;
      });
    }
  }
}

export function summarizeGatcReports(reports: readonly GatcReportDoc[]): {
  invoiceCount: number;
  gatcFeeTotal: number;
  stampedQty: number;
  invoiceIds: Set<string>;
} {
  const invoiceIds = new Set<string>();
  let gatcFeeTotal = 0;
  let stampedQty = 0;
  for (const report of reports) {
    const id = report.invoiceId || report.id;
    if (!id || invoiceIds.has(id)) continue;
    invoiceIds.add(id);
    gatcFeeTotal += report.totals.gatcFeeTotal;
    stampedQty += report.totals.stampedQty;
  }
  return {
    invoiceCount: invoiceIds.size,
    gatcFeeTotal,
    stampedQty,
    invoiceIds,
  };
}

export async function backfillGatcReportsFromInvoices(options?: {
  dryRun?: boolean;
}): Promise<{
  dryRun: boolean;
  scannedSalesOrders: number;
  scannedInvoices: number;
  wrote: number;
  soIndexed: number;
  soNumberIndexed: number;
  invoiceJoinIndexed: number;
  soFallbackWrote: number;
  skippedNoInvoice: number;
  skippedNoSo: number;
  skippedNoStamping: number;
  skippedMissingSo: number;
  deletedZero: number;
  errors: number;
}> {
  const callable = httpsCallable<
    { dryRun?: boolean },
    {
      dryRun: boolean;
      scannedSalesOrders: number;
      scannedInvoices: number;
      wrote: number;
      soIndexed: number;
      soNumberIndexed: number;
      invoiceJoinIndexed: number;
      soFallbackWrote: number;
      skippedNoInvoice: number;
      skippedNoSo: number;
      skippedNoStamping: number;
      skippedMissingSo: number;
      deletedZero: number;
      errors: number;
    }
  >(functions, 'backfillGatcReportsFromInvoicesFn', { timeout: 540_000 });
  const res = await callable({ dryRun: Boolean(options?.dryRun) });
  return res.data;
}

export function gatcReportMatchesQuery(report: GatcReportDoc, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  if (report.searchBlob.includes(q)) return true;
  const hay = [
    report.invoiceNumber,
    report.salesOrderNumber,
    report.customerName,
    report.customerId,
    report.referenceNumber,
    report.salespersonName,
    ...report.lineItems.flatMap(line => [
      line.sku,
      line.name,
      line.gatcStampingRange,
    ]),
  ].join(' ').toLowerCase();
  return hay.includes(q);
}
