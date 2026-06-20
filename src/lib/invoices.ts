import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type {
  DealerInvoice,
  DealerInvoiceDetail,
  InvoiceDashboardSummary,
  InvoiceDocumentDownload,
  InvoiceDocumentType,
  InvoiceListParams,
  InvoiceListResponse,
  InvoiceSalesEntry,
  KpiPeriod,
} from '../types/invoices';
import {
  getCachedAllInvoices,
  getCachedInvoiceDashboard,
  getCachedInvoiceDetail,
  getCachedInvoiceList,
  setCachedAllInvoices,
  setCachedInvoiceDashboard,
  setCachedInvoiceDetail,
  setCachedInvoiceList,
} from './invoice-cache';

const functions = getFunctions(app, 'asia-south1');

export function invoiceErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Invoice sync timed out. Wait a minute and try again.';
    }
    if (code === 'functions/not-found' || message.includes('not-found')) {
      return 'Invoice service is not deployed yet. Push to main or deploy Cloud Functions.';
    }
    if (code === 'functions/permission-denied') {
      return 'You do not have permission to view invoices.';
    }
    if (message) return message;
  }
  return 'Could not load invoices.';
}

export async function syncDealerInvoicesFromZoho(): Promise<{
  syncedCount: number;
  failedCount: number;
  totalListed: number;
}> {
  const callable = httpsCallable<
    undefined,
    { syncedCount?: number; failedCount?: number; totalListed?: number }
  >(
    functions,
    'syncDealerInvoicesFromZoho',
    { timeout: 600_000 },
  );
  try {
    const result = await callable();
    return {
      syncedCount: result.data.syncedCount ?? 0,
      failedCount: result.data.failedCount ?? 0,
      totalListed: result.data.totalListed ?? 0,
    };
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function fetchDealerInvoices(params: InvoiceListParams = {}): Promise<InvoiceListResponse> {
  const callable = httpsCallable<InvoiceListParams, InvoiceListResponse>(
    functions,
    'getDealerInvoices',
    { timeout: 60_000 },
  );
  try {
    const result = await callable(params);
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function fetchDealerInvoicesWithCache(
  userId: string | undefined,
  params: InvoiceListParams = {},
): Promise<InvoiceListResponse> {
  const res = await fetchDealerInvoices(params);
  if (userId) setCachedInvoiceList(userId, params, res);
  return res;
}

export function readCachedDealerInvoices(
  userId: string | undefined,
  params: InvoiceListParams = {},
): InvoiceListResponse | null {
  if (!userId) return null;
  return getCachedInvoiceList(userId, params)?.data ?? null;
}

export async function fetchDealerInvoiceDashboard(): Promise<InvoiceDashboardSummary> {
  const callable = httpsCallable<undefined, InvoiceDashboardSummary>(
    functions,
    'getDealerInvoiceDashboard',
    { timeout: 60_000 },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function fetchDealerInvoiceDashboardWithCache(
  userId: string | undefined,
): Promise<InvoiceDashboardSummary> {
  const res = await fetchDealerInvoiceDashboard();
  if (userId) setCachedInvoiceDashboard(userId, res);
  return res;
}

export function readCachedDealerInvoiceDashboard(
  userId: string | undefined,
): InvoiceDashboardSummary | null {
  if (!userId) return null;
  return getCachedInvoiceDashboard(userId)?.data ?? null;
}

export async function fetchDealerInvoiceDetail(invoiceId: string): Promise<DealerInvoiceDetail> {
  const callable = httpsCallable<{ invoiceId: string }, DealerInvoiceDetail>(
    functions,
    'getDealerInvoiceDetail',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({ invoiceId });
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function fetchDealerInvoiceDetailWithCache(
  userId: string | undefined,
  invoiceId: string,
): Promise<DealerInvoiceDetail> {
  const res = await fetchDealerInvoiceDetail(invoiceId);
  if (userId) setCachedInvoiceDetail(userId, invoiceId, res);
  return res;
}

export function readCachedDealerInvoiceDetail(
  userId: string | undefined,
  invoiceId: string,
): DealerInvoiceDetail | null {
  if (!userId) return null;
  return getCachedInvoiceDetail(userId, invoiceId)?.data ?? null;
}

export async function downloadDealerInvoiceDocument(
  invoiceId: string,
  documentType: InvoiceDocumentType,
): Promise<InvoiceDocumentDownload> {
  const callable = httpsCallable<
    { invoiceId: string; documentType: InvoiceDocumentType },
    InvoiceDocumentDownload
  >(
    functions,
    'downloadDealerInvoiceDocument',
    { timeout: 60_000 },
  );
  try {
    const result = await callable({ invoiceId, documentType });
    return result.data;
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export function saveInvoiceDocumentFile(doc: InvoiceDocumentDownload): void {
  const blob = invoiceDocumentToBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openInvoiceDocument(doc: InvoiceDocumentDownload): void {
  const blob = invoiceDocumentToBlob(doc);
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export function invoiceDocumentToBlob(doc: InvoiceDocumentDownload): Blob {
  const binary = atob(doc.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: doc.mimeType });
}

export async function loadInvoiceDocumentObjectUrl(invoiceId: string): Promise<string> {
  const doc = await downloadDealerInvoiceDocument(invoiceId, 'invoice');
  const blob = invoiceDocumentToBlob(doc);
  return URL.createObjectURL(blob);
}

export function buildSalesEntriesFromInvoices(invoices: DealerInvoice[]): InvoiceSalesEntry[] {
  return invoices
    .filter(inv => inv.date)
    .map(inv => ({
      date: inv.date!,
      total: inv.total,
    }));
}

export async function fetchAllDealerInvoices(userId?: string): Promise<DealerInvoice[]> {
  const limit = 100;
  let page = 1;
  let totalPages = 1;
  const all: DealerInvoice[] = [];

  while (page <= totalPages) {
    const res = await fetchDealerInvoicesWithCache(userId, {
      page,
      limit,
      sortField: 'date',
      sortDir: 'desc',
    });
    all.push(...res.data);
    totalPages = res.pagination.totalPages;
    page += 1;
  }

  if (userId) setCachedAllInvoices(userId, all);
  return all;
}

export function readCachedAllDealerInvoices(userId: string | undefined): DealerInvoice[] | null {
  if (!userId) return null;
  return getCachedAllInvoices(userId)?.data ?? null;
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

export function invoiceStatusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function formatInvoiceRelativeTime(value: string | null | undefined): string {
  if (!value) return '';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '';
  const diffMs = Date.now() - ts;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatInvoiceDate(value);
}

function parseInvoiceDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    ).getTime();
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? NaN : ts;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function financialYearStart(date: Date): Date {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return startOfDay(new Date(startYear, 3, 1));
}

function resolvePeriodBounds(
  period: KpiPeriod,
  now = new Date(),
): {
  periodStart: Date;
  periodEnd: Date;
  prevPeriodStart: Date;
  prevPeriodEnd: Date;
} | null {
  const periodEnd = endOfDay(now);

  if (typeof period === 'number') {
    const periodStart = startOfDay(now);
    periodStart.setDate(periodStart.getDate() - (period - 1));
    const prevPeriodEnd = endOfDay(addDays(periodStart, -1));
    const prevPeriodStart = startOfDay(addDays(prevPeriodEnd, -(period - 1)));
    return { periodStart, periodEnd, prevPeriodStart, prevPeriodEnd };
  }

  if (period === 'lifetime') {
    return null;
  }

  if (period === 'current_month') {
    const periodStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const prevPeriodStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const prevPeriodEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
    return { periodStart, periodEnd, prevPeriodStart, prevPeriodEnd };
  }

  if (period === 'current_year') {
    const periodStart = startOfDay(new Date(now.getFullYear(), 0, 1));
    const prevPeriodStart = startOfDay(new Date(now.getFullYear() - 1, 0, 1));
    const prevPeriodEnd = endOfDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
    return { periodStart, periodEnd, prevPeriodStart, prevPeriodEnd };
  }

  const periodStart = financialYearStart(now);
  const prevPeriodStart = startOfDay(new Date(periodStart));
  prevPeriodStart.setFullYear(prevPeriodStart.getFullYear() - 1);
  const dayCount = Math.floor((periodEnd.getTime() - periodStart.getTime()) / DAY_MS) + 1;
  const prevPeriodEnd = endOfDay(addDays(prevPeriodStart, dayCount - 1));
  return { periodStart, periodEnd, prevPeriodStart, prevPeriodEnd };
}

function sumSalesInWindow(
  entries: InvoiceSalesEntry[],
  periodStart: Date,
  periodEnd: Date,
): number {
  let total = 0;
  for (const entry of entries) {
    const ts = parseInvoiceDate(entry.date);
    if (Number.isNaN(ts)) continue;
    if (ts >= periodStart.getTime() && ts <= periodEnd.getTime()) {
      total += entry.total;
    }
  }
  return total;
}

export interface PeriodSalesSummary {
  periodStart: string | null;
  periodEnd: string;
  totalSales: number;
  previousSales: number;
  salesTrendPct: number | null;
}

export function computeSalesForPeriod(entries: InvoiceSalesEntry[], period: KpiPeriod): PeriodSalesSummary {
  const now = new Date();
  const periodEnd = endOfDay(now);
  const bounds = resolvePeriodBounds(period, now);

  if (!bounds) {
    let totalSales = 0;
    for (const entry of entries) {
      totalSales += entry.total;
    }
    return {
      periodStart: null,
      periodEnd: periodEnd.toISOString(),
      totalSales,
      previousSales: 0,
      salesTrendPct: null,
    };
  }

  const totalSales = sumSalesInWindow(entries, bounds.periodStart, bounds.periodEnd);
  const previousSales = sumSalesInWindow(entries, bounds.prevPeriodStart, bounds.prevPeriodEnd);

  let salesTrendPct: number | null = null;
  if (previousSales > 0) {
    salesTrendPct = ((totalSales - previousSales) / previousSales) * 100;
  } else if (totalSales > 0) {
    salesTrendPct = 100;
  }

  return {
    periodStart: bounds.periodStart.toISOString(),
    periodEnd: bounds.periodEnd.toISOString(),
    totalSales,
    previousSales,
    salesTrendPct,
  };
}

export function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function defaultCustomRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function computeSalesForDateRange(
  entries: InvoiceSalesEntry[],
  periodStart: Date,
  periodEnd: Date,
): PeriodSalesSummary {
  const start = startOfDay(periodStart);
  const end = endOfDay(periodEnd);
  const dayMs = 24 * 60 * 60 * 1000;
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1);

  const prevPeriodEnd = new Date(start);
  prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);
  prevPeriodEnd.setHours(23, 59, 59, 999);
  const prevPeriodStart = startOfDay(prevPeriodEnd);
  prevPeriodStart.setDate(prevPeriodStart.getDate() - (dayCount - 1));

  let totalSales = 0;
  let previousSales = 0;

  for (const entry of entries) {
    const ts = parseInvoiceDate(entry.date);
    if (Number.isNaN(ts)) continue;
    if (ts >= start.getTime() && ts <= end.getTime()) {
      totalSales += entry.total;
    } else if (ts >= prevPeriodStart.getTime() && ts <= prevPeriodEnd.getTime()) {
      previousSales += entry.total;
    }
  }

  let salesTrendPct: number | null = null;
  if (previousSales > 0) {
    salesTrendPct = ((totalSales - previousSales) / previousSales) * 100;
  } else if (totalSales > 0) {
    salesTrendPct = 100;
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    totalSales,
    previousSales,
    salesTrendPct,
  };
}

export function formatKpiPeriodLabel(period: KpiPeriod): string {
  if (period === 'lifetime') return 'Lifetime';
  if (period === 'current_month') return 'Current month';
  if (period === 'current_year') return 'Current year';
  if (period === 'financial_year') return 'Financial year';
  if (period === 365) return '365 days';
  return `${period} days`;
}

export function formatKpiTrendLabel(period: KpiPeriod): string {
  if (period === 'lifetime') return '';
  if (period === 'current_month') return 'vs previous month';
  if (period === 'current_year') return 'vs previous year';
  if (period === 'financial_year') return 'vs previous financial year';
  return `vs previous ${formatKpiPeriodLabel(period).toLowerCase()}`;
}

export function formatKpiPeriodRange(periodStart: string | null, periodEnd: string): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (!periodStart) return 'All time';
  return `${fmt(new Date(periodStart))} – ${fmt(new Date(periodEnd))}`;
}
