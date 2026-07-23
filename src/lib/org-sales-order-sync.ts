import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import {
  fetchZohoApiUsage,
  orgSyncStatusLabel,
  zohoApiUsageLabel,
  zohoApiUsageTone,
  type OrgInvoiceSyncRunResult,
  type OrgInvoiceSyncStatus,
  type OrgInvoiceCountResult,
  type ZohoApiUsageStatus,
} from './org-invoice-sync';

const functions = getFunctions(app, 'asia-south1');
const LONG_TIMEOUT_MS = 3_600_000;

export type OrgSalesOrderSyncStatus = OrgInvoiceSyncStatus;
export type OrgSalesOrderSyncRunResult = OrgInvoiceSyncRunResult;
export type OrgSalesOrderCountResult = OrgInvoiceCountResult;

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/resource-exhausted') {
      return message || 'Zoho API rate limit reached. Wait a few minutes and try again.';
    }
    if (code === 'functions/not-found' || code === 'functions/unavailable') {
      return 'Sales order sync is not deployed yet. Deploy Cloud Functions, then refresh again.';
    }
    if (code === 'functions/permission-denied') {
      return message || 'You do not have permission to view Sales order sync status.';
    }
    if (message) return message;
  }
  return 'Org Sales order sync failed.';
}

export async function fetchOrgSalesOrderSyncStatus(): Promise<OrgSalesOrderSyncStatus> {
  const callable = httpsCallable<undefined, OrgSalesOrderSyncStatus>(
    functions,
    'getOrgSalesOrderSyncStatusCallable',
    { timeout: 30_000 },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export async function countOrgSalesOrdersInRange(): Promise<OrgSalesOrderCountResult> {
  const callable = httpsCallable<undefined, OrgSalesOrderCountResult>(
    functions,
    'countOrgSalesOrdersInRangeCallable',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export async function runOrgSalesOrderSync(): Promise<OrgSalesOrderSyncRunResult> {
  const callable = httpsCallable<undefined, OrgSalesOrderSyncRunResult>(
    functions,
    'runOrgSalesOrderSync',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export interface SalesOrderCategoryBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  unchanged?: number;
  byCategory?: Partial<Record<'product' | 'spare' | 'service' | 'software_key', number>>;
}

export async function reclassifySalesOrderCategoriesFromCatalog(): Promise<SalesOrderCategoryBackfillResult> {
  const callable = httpsCallable<undefined, SalesOrderCategoryBackfillResult>(
    functions,
    'reclassifySalesOrderCategoriesFromCatalogFn',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export {
  fetchZohoApiUsage,
  orgSyncStatusLabel,
  zohoApiUsageLabel,
  zohoApiUsageTone,
  type ZohoApiUsageStatus,
};
