import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type {
  DealerListParams,
  DealerListResponse,
  DealerStats,
  Kam,
  ZohoDealer,
} from '../types/dealers';
import { DEFAULT_DEALER_CATEGORIES } from '../types/dealers';

const functions = getFunctions(app, 'asia-south1');

function dealerErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const fb = err as { code?: string; message?: string; details?: unknown };
    const code = fb.code ? String(fb.code) : '';
    const message = fb.message ? String(fb.message) : '';
    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Sync timed out. The server may still be running — wait a minute and click Refresh.';
    }
    if (code === 'functions/not-found' || message.includes('not-found')) {
      return 'Dealer functions are not deployed yet. Push to main or deploy Cloud Functions.';
    }
    if (code === 'functions/permission-denied') {
      return 'You do not have permission to sync dealers.';
    }
    if (code === 'functions/internal' || message === 'internal') {
      return 'Could not reach the dealer service. Deploy the latest Cloud Functions and try again.';
    }
    if (message) return message;
  }
  return 'Dealer request failed.';
}

export async function syncZohoInvoices(options?: {
  customerId?: string;
  skipPdfs?: boolean;
}): Promise<{ syncedCount: number; failedCount: number; totalListed: number }> {
  const fn = httpsCallable<
    { customerId?: string; skipPdfs?: boolean },
    { syncedCount?: number; failedCount?: number; totalListed?: number }
  >(
    functions,
    'syncZohoInvoices',
    { timeout: 600_000 },
  );
  const result = await fn(options ?? {});
  return {
    syncedCount: result.data.syncedCount ?? 0,
    failedCount: result.data.failedCount ?? 0,
    totalListed: result.data.totalListed ?? 0,
  };
}

export async function syncZohoCustomers(): Promise<number> {
  const fn = httpsCallable<undefined, { syncedCount?: number }>(
    functions,
    'syncZohoCustomers',
    { timeout: 600_000 },
  );
  const result = await fn();
  return result.data.syncedCount ?? 0;
}

export async function fetchDealers(params: DealerListParams): Promise<DealerListResponse> {
  const fn = httpsCallable(functions, 'getDealers');
  const result = await fn(params);
  return result.data as DealerListResponse;
}

export async function fetchDealerById(id: string, options?: { forceRefresh?: boolean }): Promise<ZohoDealer> {
  const fn = httpsCallable(functions, 'getDealer');
  const result = await fn({ id, forceRefresh: options?.forceRefresh });
  return (result.data as { dealer: ZohoDealer }).dealer;
}

export async function fetchMyDealerProfile(): Promise<ZohoDealer> {
  const fn = httpsCallable(functions, 'getMyDealerProfile', { timeout: 120_000 });
  const result = await fn();
  return (result.data as { dealer: ZohoDealer }).dealer;
}

export async function refreshDealerFromZoho(id: string): Promise<ZohoDealer> {
  const fn = httpsCallable(functions, 'refreshZohoDealer', { timeout: 120_000 });
  const result = await fn({ id });
  return (result.data as { dealer: ZohoDealer }).dealer;
}

export async function pushDealerChangesToZoho(
  id: string,
  changes: Record<string, string | null | undefined>,
): Promise<ZohoDealer> {
  const fn = httpsCallable(functions, 'pushDealerToZoho', { timeout: 120_000 });
  const result = await fn({ id, changes });
  return (result.data as { dealer: ZohoDealer }).dealer;
}

export async function fetchDealerStats(): Promise<DealerStats> {
  const fn = httpsCallable(functions, 'getDealerStats');
  const result = await fn();
  return result.data as DealerStats;
}

export async function fetchDealerLocations(): Promise<{
  states: string[];
  districtsByState: Record<string, string[]>;
}> {
  const fn = httpsCallable(functions, 'getDealerLocations');
  const result = await fn();
  return result.data as { states: string[]; districtsByState: Record<string, string[]> };
}

export async function lookupDealerPincode(
  pincode: string,
): Promise<{ state: string; district: string }> {
  const fn = httpsCallable<
    { pincode: string },
    { state: string; district: string }
  >(functions, 'lookupDealerPincode');
  try {
    const result = await fn({ pincode: pincode.replace(/\D/g, '').slice(0, 6) });
    return result.data;
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'message' in err) {
      const fbErr = err as { code?: string; message: string };
      if (fbErr.code?.startsWith('functions/') && fbErr.message) {
        throw new Error(fbErr.message);
      }
    }
    throw new Error('Could not look up PIN code.');
  }
}

export async function exportDealersCsv(params: DealerListParams): Promise<string> {
  const fn = httpsCallable(functions, 'exportDealers');
  const result = await fn(params);
  return String((result.data as { csv?: string }).csv ?? '');
}

export async function patchDealer(
  id: string,
  patch: Partial<ZohoDealer>,
): Promise<void> {
  const fn = httpsCallable(functions, 'patchDealer');
  await fn({ id, patch });
}

export async function linkDealerPortalUser(
  zohoCustomerId: string,
  portalUserId: string,
): Promise<void> {
  const fn = httpsCallable(functions, 'linkDealerPortalUserFn');
  await fn({ zohoCustomerId, portalUserId });
}

export async function fetchKams(): Promise<Kam[]> {
  const fn = httpsCallable(functions, 'getDealerKams');
  const result = await fn();
  return (result.data as { data: Kam[] }).data ?? [];
}

export async function createKam(name: string, phone?: string): Promise<Kam> {
  const fn = httpsCallable(functions, 'createDealerKam');
  const result = await fn({ name, phone });
  return (result.data as { data: Kam }).data;
}

export async function deleteKam(id: string): Promise<void> {
  const fn = httpsCallable(functions, 'deleteDealerKam');
  await fn({ id });
}

export async function fetchDealerCategories(): Promise<string[]> {
  try {
    const fn = httpsCallable(functions, 'getDealerSetting');
    const result = await fn({ key: 'dealer_categories', fallback: DEFAULT_DEALER_CATEGORIES });
    const value = (result.data as { value?: string[] }).value;
    return Array.isArray(value) && value.length ? value : DEFAULT_DEALER_CATEGORIES;
  } catch (err) {
    return DEFAULT_DEALER_CATEGORIES;
  }
}

export async function saveDealerCategories(categories: string[]): Promise<void> {
  const fn = httpsCallable(functions, 'setDealerSetting');
  await fn({ key: 'dealer_categories', value: categories });
}

export async function fetchDealerSetting<T>(key: string, fallback: T): Promise<T> {
  const fn = httpsCallable(functions, 'getDealerSetting');
  const result = await fn({ key, fallback });
  const value = (result.data as { value?: T }).value;
  return value ?? fallback;
}

export async function importCrmDealerOverlay(): Promise<{
  sourceProject: string;
  deactivatedNames: number;
  deactivatedMatched: number;
  overrideNames: number;
  overridesMatched: number;
  overridesSkipped: number;
  documentsUpdated: number;
  zipCodesStored: number;
  dealerCategoriesStored: number;
  dealerStagesStored: number;
}> {
  const fn = httpsCallable(functions, 'importCrmDealerOverlayFn', { timeout: 600_000 });
  const result = await fn();
  return result.data as {
    sourceProject: string;
    deactivatedNames: number;
    deactivatedMatched: number;
    overrideNames: number;
    overridesMatched: number;
    overridesSkipped: number;
    documentsUpdated: number;
    zipCodesStored: number;
    dealerCategoriesStored: number;
    dealerStagesStored: number;
  };
}

/** @deprecated Use importCrmDealerOverlay */
export const importDealerLegacyOverrides = importCrmDealerOverlay;

export async function backfillDealerLocations(): Promise<{
  offlineFixedCount: number;
  deepFetchCount: number;
  totalAttempted: number;
}> {
  const fn = httpsCallable(functions, 'backfillDealerLocationsFn', { timeout: 600_000 });
  const result = await fn();
  return result.data as {
    offlineFixedCount: number;
    deepFetchCount: number;
    totalAttempted: number;
  };
}

export { dealerErrorMessage };
