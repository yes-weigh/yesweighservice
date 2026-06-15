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
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return 'Dealer request failed.';
}

export async function syncZohoCustomers(): Promise<number> {
  const fn = httpsCallable(functions, 'syncZohoCustomers');
  const result = await fn();
  const data = result.data as { syncedCount?: number };
  return data.syncedCount ?? 0;
}

export async function fetchDealers(params: DealerListParams): Promise<DealerListResponse> {
  const fn = httpsCallable(functions, 'getDealers');
  const result = await fn(params);
  return result.data as DealerListResponse;
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

export { dealerErrorMessage };
