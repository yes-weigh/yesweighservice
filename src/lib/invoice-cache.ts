import type {
  DealerInvoice,
  DealerInvoiceDetail,
  InvoiceDashboardSummary,
  InvoiceListParams,
  InvoiceListResponse,
} from '../types/invoices';

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = `yws.invoice.${CACHE_VERSION}`;

const TTL_BROWSER_MS = 30 * 60 * 1000;
const TTL_PWA_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEnvelope<T> {
  savedAt: number;
  data: T;
}

export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function invoiceCacheTtlMs(): number {
  return isPwaStandalone() ? TTL_PWA_MS : TTL_BROWSER_MS;
}

function userPrefix(userId: string): string {
  return `${CACHE_PREFIX}:${userId}`;
}

function listKey(userId: string, params: InvoiceListParams): string {
  return `${userPrefix(userId)}:list:${stableListParams(params)}`;
}

function detailKey(userId: string, invoiceId: string): string {
  return `${userPrefix(userId)}:detail:${invoiceId}`;
}

function dashboardKey(userId: string): string {
  return `${userPrefix(userId)}:dashboard`;
}

function allInvoicesKey(userId: string): string {
  return `${userPrefix(userId)}:all`;
}

function stableListParams(params: InvoiceListParams): string {
  return JSON.stringify({
    page: params.page ?? 1,
    limit: params.limit ?? 25,
    q: params.q ?? '',
    status: params.status ?? 'all',
    category: params.category ?? 'all',
    sortField: params.sortField ?? 'date',
    sortDir: params.sortDir ?? 'desc',
  });
}

function readEntry<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== 'number' || parsed.data === undefined) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry<T>(key: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = { savedAt: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Ignore quota errors — network data still works.
  }
}

export function isInvoiceCacheFresh(savedAt: number, ttlMs = invoiceCacheTtlMs()): boolean {
  return Date.now() - savedAt <= ttlMs;
}

export function getCachedInvoiceList(
  userId: string,
  params: InvoiceListParams,
): { data: InvoiceListResponse; savedAt: number; fresh: boolean } | null {
  const entry = readEntry<InvoiceListResponse>(listKey(userId, params));
  if (!entry) return null;
  return {
    data: entry.data,
    savedAt: entry.savedAt,
    fresh: isInvoiceCacheFresh(entry.savedAt),
  };
}

export function setCachedInvoiceList(
  userId: string,
  params: InvoiceListParams,
  data: InvoiceListResponse,
): void {
  writeEntry(listKey(userId, params), data);
}

export function getCachedInvoiceDetail(
  userId: string,
  invoiceId: string,
): { data: DealerInvoiceDetail; savedAt: number; fresh: boolean } | null {
  const entry = readEntry<DealerInvoiceDetail>(detailKey(userId, invoiceId));
  if (!entry) return null;
  return {
    data: entry.data,
    savedAt: entry.savedAt,
    fresh: isInvoiceCacheFresh(entry.savedAt),
  };
}

export function setCachedInvoiceDetail(
  userId: string,
  invoiceId: string,
  data: DealerInvoiceDetail,
): void {
  writeEntry(detailKey(userId, invoiceId), data);
}

export function getCachedInvoiceDashboard(
  userId: string,
): { data: InvoiceDashboardSummary; savedAt: number; fresh: boolean } | null {
  const entry = readEntry<InvoiceDashboardSummary>(dashboardKey(userId));
  if (!entry) return null;
  return {
    data: entry.data,
    savedAt: entry.savedAt,
    fresh: isInvoiceCacheFresh(entry.savedAt),
  };
}

export function setCachedInvoiceDashboard(userId: string, data: InvoiceDashboardSummary): void {
  writeEntry(dashboardKey(userId), data);
}

export function getCachedAllInvoices(
  userId: string,
): { data: DealerInvoice[]; savedAt: number; fresh: boolean } | null {
  const entry = readEntry<DealerInvoice[]>(allInvoicesKey(userId));
  if (!entry) return null;
  return {
    data: entry.data,
    savedAt: entry.savedAt,
    fresh: isInvoiceCacheFresh(entry.savedAt),
  };
}

export function setCachedAllInvoices(userId: string, data: DealerInvoice[]): void {
  writeEntry(allInvoicesKey(userId), data);
}

export function clearInvoiceCacheForUser(userId: string): void {
  const prefix = `${userPrefix(userId)}:`;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

export function formatInvoiceCacheAge(savedAt: number): string {
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
