import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export interface OrgInvoiceSyncStatus {
  dateFrom: string;
  dateTo: string;
  status: 'idle' | 'running' | 'paused_quota' | 'complete';
  totalInRange: number | null;
  pulledCount: number;
  remaining: number | null;
  queuedCount: number | null;
  apiCallsToday: number;
  dailyApiCap: number;
  apiRemainingToday: number;
  checkpointPage: number;
  checkpointIndex: number;
  lastRunAt: string | null;
  lastRunSummary: {
    synced?: number;
    failed?: number;
    skipped?: number;
    unchanged?: number;
    newlyPulled?: number;
    apiCallsUsed?: number;
  } | null;
  completedAt: string | null;
  totalCountedAt: string | null;
}

export interface OrgInvoiceSyncRunResult {
  status: OrgInvoiceSyncStatus['status'];
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  unchangedCount: number;
  newlyPulled: number;
  apiCallsUsed: number;
  apiCallsToday: number;
  apiRemainingToday: number;
  totalInRange: number | null;
  pulledCount: number;
  remaining: number | null;
  completed: boolean;
  message?: string;
}

export interface OrgInvoiceCountResult {
  totalInRange: number;
  pulledCount: number;
  remaining: number;
  apiCallsUsed: number;
}

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = 'message' in err ? String((err as { message: string }).message) : '';
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

export async function countOrgInvoicesInRange(): Promise<OrgInvoiceCountResult> {
  const callable = httpsCallable<undefined, OrgInvoiceCountResult>(
    functions,
    'countOrgInvoicesInRangeCallable',
    { timeout: 600_000 },
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
    { timeout: 600_000 },
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
    case 'paused_quota':
      return 'Paused (daily API cap)';
    case 'complete':
      return 'Complete';
    default:
      return 'Idle';
  }
}

export function formatOrgSyncDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
