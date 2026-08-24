import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { AdminSalesOrderDetail } from './admin-sales-orders';
import { dealerOrderErrorMessage } from './dealerOrders';

const functions = getFunctions(app, 'asia-south1');

export interface KotakBankFeed {
  transactionId: string;
  date: string | null;
  postedTime?: string | null;
  amount: number;
  debitOrCredit: string | null;
  transactionType?: string | null;
  payee: string | null;
  description: string | null;
  referenceNumber: string | null;
  status: string;
  accountId: string;
  accountName: string;
  bankName: string;
  importedTransactionId: string | null;
  reservedForSalesOrderId?: string | null;
  reservedForPurchaseOrderId?: string | null;
}

export interface KotakBankFeedSyncResult {
  feeds: KotakBankFeed[];
  fetchedAt: string;
  count: number;
  accountNames: string[];
}

export interface KotakBankFeedRefreshResult {
  refreshed: boolean;
  accountNames: string[];
  uncategorizedCount?: number;
  lastRefreshDate?: string | null;
  message: string;
}

export interface KotakBankFeedSummary {
  uncategorizedCount: number;
  accountNames: string[];
  lastRefreshDate: string | null;
}

/** Uncategorised transaction count for Kotak Current Account. */
export async function fetchKotakBankFeedSummary(): Promise<KotakBankFeedSummary> {
  try {
    const fn = httpsCallable<Record<string, never>, KotakBankFeedSummary>(
      functions,
      'getKotakBankFeedSummaryFn',
      { timeout: 60_000 },
    );
    const result = await fn({});
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

/** Ask Zoho Books to Refresh Feeds for Kotak (same as Banking → gear → Refresh Feeds). */
export async function refreshKotakBankFeeds(): Promise<KotakBankFeedRefreshResult> {
  try {
    const fn = httpsCallable<Record<string, never>, KotakBankFeedRefreshResult>(
      functions,
      'refreshKotakBankFeedsFn',
      { timeout: 90_000 },
    );
    const result = await fn({});
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

/** Fetch latest uncategorised Kotak bank feeds from Zoho and store them. */
export async function fetchKotakBankFeeds(options?: {
  skipRefresh?: boolean;
}): Promise<KotakBankFeedSyncResult> {
  try {
    const fn = httpsCallable<{ skipRefresh?: boolean }, KotakBankFeedSyncResult>(
      functions,
      'fetchKotakBankFeedsFn',
      { timeout: 120_000 },
    );
    const result = await fn(options?.skipRefresh ? { skipRefresh: true } : {});
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function selectKotakFeedAndInvoiceSalesOrder(
  salesOrderId: string,
  feed: KotakBankFeed,
): Promise<AdminSalesOrderDetail> {
  try {
    const fn = httpsCallable<{ salesOrderId: string; feed: KotakBankFeed }, AdminSalesOrderDetail>(
      functions,
      'selectKotakFeedAndInvoiceSalesOrder',
      { timeout: 180_000 },
    );
    const result = await fn({ salesOrderId, feed });
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}
