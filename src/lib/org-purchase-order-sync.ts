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

export type OrgPurchaseOrderSyncStatus = OrgInvoiceSyncStatus;
export type OrgPurchaseOrderSyncRunResult = OrgInvoiceSyncRunResult;
export type OrgPurchaseOrderCountResult = OrgInvoiceCountResult;

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/resource-exhausted') {
      return message || 'Zoho API rate limit reached. Wait a few minutes and try again.';
    }
    if (message) return message;
  }
  return 'Org purchase order sync failed.';
}

export async function fetchOrgPurchaseOrderSyncStatus(): Promise<OrgPurchaseOrderSyncStatus> {
  const callable = httpsCallable<undefined, OrgPurchaseOrderSyncStatus>(
    functions,
    'getOrgPurchaseOrderSyncStatusCallable',
    { timeout: 30_000 },
  );
  const result = await callable();
  return result.data;
}

export async function countOrgPurchaseOrdersInRange(): Promise<OrgPurchaseOrderCountResult> {
  const callable = httpsCallable<undefined, OrgPurchaseOrderCountResult>(
    functions,
    'countOrgPurchaseOrdersInRangeCallable',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export async function runOrgPurchaseOrderSync(): Promise<OrgPurchaseOrderSyncRunResult> {
  const callable = httpsCallable<undefined, OrgPurchaseOrderSyncRunResult>(
    functions,
    'runOrgPurchaseOrderSync',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export interface PurchaseOrderCategoryBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  unchanged?: number;
  byCategory?: Partial<Record<'product' | 'spare' | 'service' | 'software_key', number>>;
}

export async function reclassifyPurchaseOrderCategoriesFromCatalog(): Promise<PurchaseOrderCategoryBackfillResult> {
  const callable = httpsCallable<undefined, PurchaseOrderCategoryBackfillResult>(
    functions,
    'reclassifyPurchaseOrderCategoriesFromCatalogFn',
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
