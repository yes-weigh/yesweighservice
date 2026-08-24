import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { app, db } from '../firebase';
import type {
  AssignableStaffOption,
  DealerListParams,
  DealerListResponse,
  DealerStats,
  ZohoDealer,
} from '../types/dealers';
import { DEFAULT_DEALER_CATEGORIES } from '../types/dealers';
import type { DealerAddress } from './dealerAddress';

const functions = getFunctions(app, 'asia-south1');

/** Prefer contact mobile (login number) over company/shipping phone. */
export function dealerContactPhone(dealer: Pick<
  ZohoDealer,
  'mobile' | 'phone' | 'whatsappNumber' | 'alternateMobile' | 'zohoPrimaryContact'
>): string | null {
  const candidates = [
    dealer.mobile,
    dealer.zohoPrimaryContact?.mobile,
    dealer.whatsappNumber,
    dealer.alternateMobile,
    dealer.phone,
    dealer.zohoPrimaryContact?.phone,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function dealerErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const fb = err as { code?: string; message?: string; details?: unknown };
    const code = fb.code ? String(fb.code) : '';
    const message = fb.message ? String(fb.message) : '';
    if (code === 'functions/deadline-exceeded' || message.includes('deadline-exceeded')) {
      return 'Sync timed out. The server may still be running — wait a minute and click Refresh.';
    }
    if (
      code === 'functions/resource-exhausted'
      || /rate.?limit|too many requests|maximum call rate limit|10,?000/i.test(message)
    ) {
      if (/maximum call rate limit|10,?000|daily/i.test(message)) {
        return 'Zoho daily API limit (10,000 calls) has been reached. Wait until the quota resets, then try Sync again. Check usage under Admin → Invoice Sync.';
      }
      return 'Zoho is temporarily rate-limited. Wait a few minutes, then try Sync again.';
    }
    if (code === 'functions/not-found' || message.includes('not-found')) {
      return 'Dealer functions are not deployed yet. Push to main or deploy Cloud Functions.';
    }
    if (code === 'functions/permission-denied') {
      const clean = message.replace(/^FirebaseError:\s*/i, '').trim();
      if (clean && clean !== 'permission-denied' && !/^INTERNAL$/i.test(clean)) {
        return clean;
      }
      return 'You do not have permission to do this.';
    }
    // Prefer Zoho/server detail over a generic "deploy functions" hint.
    if (message && message !== 'internal' && !/^FirebaseError:/i.test(message)) {
      return message;
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

export async function updateMyDealerAddresses(patch: {
  billingAddress?: string;
  shippingAddress?: string;
}): Promise<ZohoDealer> {
  const fn = httpsCallable<
    { billingAddress?: string; shippingAddress?: string },
    { dealer: ZohoDealer }
  >(functions, 'updateMyDealerAddresses', { timeout: 120_000 });
  const result = await fn(patch);
  return result.data.dealer;
}

export async function refreshDealerFromZoho(id: string): Promise<ZohoDealer> {
  const fn = httpsCallable(functions, 'refreshZohoDealer', { timeout: 120_000 });
  const result = await fn({ id });
  return (result.data as { dealer: ZohoDealer }).dealer;
}

export async function pushDealerChangesToZoho(
  id: string,
  changes: Record<string, string | Record<string, string> | null | undefined>,
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

export type GstinLookupDetails = {
  gstin: string;
  companyName: string;
  legalName: string;
  tradeName: string;
  gstTreatment: string;
  taxpayerType: string;
  constitutionOfBusiness: string;
  state: string;
  district: string;
  city?: string;
  zip: string;
  address: string;
  phone: string;
};

export async function fetchGstinDetails(gstin: string): Promise<GstinLookupDetails> {
  const fn = httpsCallable<{ gstin: string }, { details: GstinLookupDetails }>(
    functions,
    'fetchGstinDetails',
    { timeout: 45_000 },
  );
  const result = await fn({ gstin });
  return result.data.details;
}

export async function createDealer(input: {
  companyName: string;
  contactName?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  gstin?: string;
  gstTreatment?: string;
  legalName?: string;
  taxpayerType?: string;
  constitutionOfBusiness?: string;
  pan?: string;
  dealerStage?: string;
  assignedStaffUid?: string;
  googleMapsUrl?: string;
  canBuySpares?: boolean;
  orderPayOffline?: boolean;
  orderPayOnline?: boolean;
  billingState?: string;
  district?: string;
  zipCode?: string;
  billingAddress?: string;
  shippingAddress?: string;
  billing?: DealerAddress;
  shipping?: DealerAddress;
  sameShipping?: boolean;
}): Promise<ZohoDealer> {
  const fn = httpsCallable<typeof input, { dealer: ZohoDealer }>(functions, 'createDealer');
  const result = await fn(input);
  return result.data.dealer;
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

export async function listAssignableDealerStaff(): Promise<AssignableStaffOption[]> {
  const fn = httpsCallable(functions, 'listAssignableDealerStaff');
  const result = await fn();
  return (result.data as { data: AssignableStaffOption[] }).data ?? [];
}

/**
 * Options for the assigned-staff select. Includes the current assignee when they
 * are no longer eligible (no Zoho salesperson), so the control stays truthful.
 */
export function dealerStaffSelectOptions(
  assignableStaff: AssignableStaffOption[],
  current?: { uid?: string | null; name?: string | null } | null,
): AssignableStaffOption[] {
  const uid = String(current?.uid ?? '').trim();
  if (!uid || assignableStaff.some(s => s.uid === uid)) return assignableStaff;
  const name = String(current?.name ?? '').trim() || 'Assigned staff';
  return [
    { uid, displayName: `${name} (no Zoho salesperson)` },
    ...assignableStaff,
  ];
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

export type DealerStaffLinkingUnlock = {
  zohoSalespersonId: string;
  zohoSalespersonName: string | null;
  unassignedDealers: number;
  dealerIds?: string[];
};

export type DealerStaffLinkingAssignable = DealerStaffLinkingUnlock & {
  linkedStaffUid: string;
  linkedStaffName: string;
  linkedStaffEmail: string | null;
};

export type DealerStaffLinkingNoInvoice = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  dealerCode: string | null;
  billingState: string | null;
  billingCity: string | null;
};

export type DealerStaffLinkingAnalysis = {
  status?: 'running' | 'ready' | 'error' | string;
  ignoredSalespersons: string[];
  summary: {
    totalDealers: number;
    unassignedDealers: number;
    alreadyAssignable: number;
    needStaffLink: number;
    noUsableInvoice: number;
  };
  unlocks: DealerStaffLinkingUnlock[];
  alreadyAssignableBySalesperson: DealerStaffLinkingAssignable[];
  noUsableInvoiceDealers: DealerStaffLinkingNoInvoice[];
  runByUid?: string | null;
  runCompletedAt?: string | null;
  updatedAt?: unknown;
  lastMutation?: {
    type?: string;
    at?: string;
    assigned?: number;
    zohoSalespersonId?: string;
    staffName?: string;
  } | null;
  errorMessage?: string | null;
};

export const DEALER_STAFF_LINKING_CHECK_DOC_ID = 'dealerStaffLinkingCheck';

export function subscribeDealerStaffLinkingCheck(
  onData: (data: DealerStaffLinkingAnalysis | null) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = doc(db, 'appSettings', DEALER_STAFF_LINKING_CHECK_DOC_ID);
  return onSnapshot(
    ref,
    snap => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as DealerStaffLinkingAnalysis);
    },
    err => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

export async function analyzeDealerStaffLinking(): Promise<DealerStaffLinkingAnalysis> {
  const fn = httpsCallable<undefined, DealerStaffLinkingAnalysis>(
    functions,
    'analyzeDealerStaffLinkingFn',
    { timeout: 600_000 },
  );
  const result = await fn();
  return result.data;
}

export async function backfillDealerAssignedStaff(options?: {
  dryRun?: boolean;
  onlyFillUnassigned?: boolean;
}): Promise<{
  dryRun: boolean;
  onlyFillUnassigned: boolean;
  scanned: number;
  assigned: number;
  filled: number;
  unassigned: number;
  noInvoice: number;
  unknownSalesperson: number;
  unchanged: number;
  skippedAlreadyAssigned: number;
}> {
  const fn = httpsCallable(functions, 'backfillDealerAssignedStaffFn', { timeout: 600_000 });
  const result = await fn({
    dryRun: Boolean(options?.dryRun),
    onlyFillUnassigned: Boolean(options?.onlyFillUnassigned),
  });
  return result.data as {
    dryRun: boolean;
    onlyFillUnassigned: boolean;
    scanned: number;
    assigned: number;
    filled: number;
    unassigned: number;
    noInvoice: number;
    unknownSalesperson: number;
    unchanged: number;
    skippedAlreadyAssigned: number;
  };
}

export async function claimDealersBySalesperson(input: {
  zohoSalespersonId: string;
  zohoSalespersonName?: string | null;
  staffUid: string;
}): Promise<{
  zohoSalespersonId: string;
  zohoSalespersonName: string | null;
  staffUid: string;
  staffName: string;
  linkedSalesperson: boolean;
  matchedDealers: number;
  assigned: number;
}> {
  const fn = httpsCallable(functions, 'claimDealersBySalespersonFn', { timeout: 600_000 });
  const result = await fn({
    zohoSalespersonId: input.zohoSalespersonId,
    zohoSalespersonName: input.zohoSalespersonName ?? null,
    staffUid: input.staffUid,
  });
  return result.data as {
    zohoSalespersonId: string;
    zohoSalespersonName: string | null;
    staffUid: string;
    staffName: string;
    linkedSalesperson: boolean;
    matchedDealers: number;
    assigned: number;
  };
}

export async function assignNoUsableInvoiceDealers(input: {
  dealerIds: string[];
  staffUid: string;
}): Promise<{
  staffUid: string;
  staffName: string;
  requested: number;
  assigned: number;
  dealers: DealerStaffLinkingNoInvoice[];
}> {
  const fn = httpsCallable(functions, 'assignNoUsableInvoiceDealersFn', { timeout: 300_000 });
  const result = await fn({
    dealerIds: input.dealerIds,
    staffUid: input.staffUid,
  });
  return result.data as {
    staffUid: string;
    staffName: string;
    requested: number;
    assigned: number;
    dealers: DealerStaffLinkingNoInvoice[];
  };
}

export async function undoNoUsableInvoiceAssign(input: {
  dealers: DealerStaffLinkingNoInvoice[];
  staffUid: string;
}): Promise<{
  staffUid: string;
  restored: number;
  dealers: DealerStaffLinkingNoInvoice[];
}> {
  const fn = httpsCallable(functions, 'undoNoUsableInvoiceAssignFn', { timeout: 300_000 });
  const result = await fn({
    dealers: input.dealers,
    staffUid: input.staffUid,
  });
  return result.data as {
    staffUid: string;
    restored: number;
    dealers: DealerStaffLinkingNoInvoice[];
  };
}

export { dealerErrorMessage };
