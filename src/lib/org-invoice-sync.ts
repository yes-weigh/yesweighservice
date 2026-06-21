import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');
const LONG_TIMEOUT_MS = 3_600_000;

export interface OrgInvoiceSyncStatus {
  status: 'idle' | 'running' | 'complete';
  totalInRange: number | null;
  pulledCount: number;
  remaining: number | null;
  checkpointPage: number;
  checkpointIndex: number;
  lastRunAt: string | null;
  lastRunSource?: string | null;
  lastRunSummary: {
    synced?: number;
    failed?: number;
    skipped?: number;
    unchanged?: number;
    newlyPulled?: number;
    rateLimited?: boolean;
    quotaReserved?: boolean;
    inProgress?: boolean;
  } | null;
  completedAt: string | null;
  totalCountedAt: string | null;
}

export interface ZohoApiUsageUser {
  name: string | null;
  email: string | null;
  total: number;
  hosts: { ip: string | null; count: number }[];
}

export interface ZohoApiUsageStatus {
  source: 'zoho' | string;
  dayKey: string | null;
  callsToday: number;
  dailyLimit: number;
  remaining: number;
  usagePct: number;
  status: 'ok' | 'low' | 'throttled' | 'daily_limit' | string;
  windowLimit: number | null;
  windowRemaining: number | null;
  resetSec: number | null;
  resetAt: string | null;
  retryAfterSec: number | null;
  userDetails: ZohoApiUsageUser[];
  lastError: string | null;
  lastRateLimitAt: string | null;
  fetchedAt: string | null;
  updatedAt: string | null;
}

export interface OrgInvoiceSyncRunResult {
  status: OrgInvoiceSyncStatus['status'];
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  unchangedCount: number;
  newlyPulled: number;
  totalInRange: number | null;
  pulledCount: number;
  remaining: number | null;
  completed: boolean;
  rateLimited?: boolean;
  quotaReserved?: boolean;
  message?: string;
}

export interface OrgInvoiceCountResult {
  totalInRange: number;
  pulledCount: number;
  remaining: number;
}

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/resource-exhausted') {
      return message || 'Zoho API rate limit reached. Wait a few minutes and try again.';
    }
    if (message) return message;
  }
  return 'Org invoice sync failed.';
}

export async function fetchOrgInvoiceSyncStatus(): Promise<OrgInvoiceSyncStatus> {
  const callable = httpsCallable<undefined, OrgInvoiceSyncStatus>(
    functions,
    'getOrgInvoiceSyncStatusCallable',
    { timeout: 30_000 },
  );
  const result = await callable();
  return result.data;
}

export async function fetchZohoApiUsage(options?: { forceRefresh?: boolean }): Promise<ZohoApiUsageStatus> {
  const callable = httpsCallable<{ forceRefresh?: boolean }, ZohoApiUsageStatus>(
    functions,
    'getZohoApiUsageCallable',
    { timeout: 15_000 },
  );
  const result = await callable(
    options?.forceRefresh ? { forceRefresh: true } : {},
  );
  return result.data;
}

export async function countOrgInvoicesInRange(): Promise<OrgInvoiceCountResult> {
  const callable = httpsCallable<undefined, OrgInvoiceCountResult>(
    functions,
    'countOrgInvoicesInRangeCallable',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export async function runOrgInvoiceSync(): Promise<OrgInvoiceSyncRunResult> {
  const callable = httpsCallable<undefined, OrgInvoiceSyncRunResult>(
    functions,
    'runOrgInvoiceSync',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable();
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export function orgSyncStatusLabel(status: OrgInvoiceSyncStatus['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'complete':
      return 'Complete';
    default:
      return 'Idle';
  }
}

export function zohoApiUsageLabel(status: ZohoApiUsageStatus['status']): string {
  switch (status) {
    case 'daily_limit':
      return 'Daily limit reached';
    case 'throttled':
      return 'Rate limited';
    case 'low':
      return 'Quota low';
    default:
      return 'OK';
  }
}

export function zohoApiUsageTone(status: ZohoApiUsageStatus['status']): 'ok' | 'warn' | 'danger' {
  if (status === 'daily_limit') return 'danger';
  if (status === 'throttled' || status === 'low') return 'warn';
  return 'ok';
}
