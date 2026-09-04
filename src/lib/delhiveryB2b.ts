import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { DelhiveryB2bEnv, DelhiveryB2bPublicConfig } from '../types/delhivery-b2b';
import type { StaffLogisticsSite } from '../types/staff-logistics';

const functions = getFunctions(app, 'asia-south1');

function callableError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: string }).message ?? '').trim();
    if (message) return new Error(message.replace(/^FirebaseError:\s*/i, ''));
  }
  return new Error(fallback);
}

export async function getDelhiveryB2bConfig(): Promise<DelhiveryB2bPublicConfig> {
  try {
    const fn = httpsCallable<undefined, DelhiveryB2bPublicConfig>(
      functions,
      'getDelhiveryB2bConfigFn',
      { timeout: 30_000 },
    );
    const result = await fn();
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not load Delhivery B2B config.');
  }
}

export async function saveDelhiveryB2bCredentials(input: {
  username: string;
  password?: string;
  env: DelhiveryB2bEnv;
  pickupLocationBySite: Record<StaffLogisticsSite, string>;
}): Promise<DelhiveryB2bPublicConfig> {
  try {
    const fn = httpsCallable<
      {
        username: string;
        password?: string;
        env: DelhiveryB2bEnv;
        pickupLocationBySite: Record<StaffLogisticsSite, string>;
      },
      { ok: boolean; config: DelhiveryB2bPublicConfig }
    >(functions, 'saveDelhiveryB2bCredentialsFn', { timeout: 60_000 });
    const result = await fn(input);
    return result.data.config;
  } catch (err) {
    throw callableError(err, 'Could not save Delhivery B2B credentials.');
  }
}

export async function testDelhiveryB2bConnection(): Promise<{
  ok: boolean;
  message: string;
  env?: DelhiveryB2bEnv;
  username?: string;
  clientName?: string;
}> {
  try {
    const fn = httpsCallable<undefined, {
      ok: boolean;
      message: string;
      env?: DelhiveryB2bEnv;
      username?: string;
      clientName?: string;
    }>(functions, 'testDelhiveryB2bConnectionFn', { timeout: 60_000 });
    const result = await fn();
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not test Delhivery B2B connection.');
  }
}

export type DelhiveryFreightChargeEntry = {
  ok: boolean;
  lrn: string;
  totalInr: number | null;
  chargedWeightKg: number | null;
  minChargedWeightKg: number | null;
  breakup: {
    baseFreightCharge: number | null;
    fuelSurcharge: number | null;
    fuelHike: number | null;
    insuranceRov: number | null;
    odaFm: number | null;
    odaLm: number | null;
    fm: number | null;
    lm: number | null;
    green: number | null;
    preTaxFreight: number | null;
    gst: number | null;
    gstPercent: number | null;
    markup: number | null;
    otherHandlingCharges: number | null;
  } | null;
  billingMode: 'fod' | 'btc' | null;
  error: string | null;
  fetchedAt: string;
};

function asFiniteNumber(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function mapFreightChargeEntry(raw: unknown, fallbackLrn: string): DelhiveryFreightChargeEntry {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const breakupRaw = data.breakup && typeof data.breakup === 'object'
    ? data.breakup as Record<string, unknown>
    : null;
  const billing = String(data.billingMode ?? '').trim().toLowerCase();
  return {
    ok: Boolean(data.ok),
    lrn: String(data.lrn ?? fallbackLrn),
    totalInr: asFiniteNumber(data.totalInr),
    chargedWeightKg: asFiniteNumber(data.chargedWeightKg),
    minChargedWeightKg: asFiniteNumber(data.minChargedWeightKg),
    breakup: breakupRaw
      ? {
        baseFreightCharge: asFiniteNumber(breakupRaw.baseFreightCharge),
        fuelSurcharge: asFiniteNumber(breakupRaw.fuelSurcharge),
        fuelHike: asFiniteNumber(breakupRaw.fuelHike),
        insuranceRov: asFiniteNumber(breakupRaw.insuranceRov),
        odaFm: asFiniteNumber(breakupRaw.odaFm),
        odaLm: asFiniteNumber(breakupRaw.odaLm),
        fm: asFiniteNumber(breakupRaw.fm),
        lm: asFiniteNumber(breakupRaw.lm),
        green: asFiniteNumber(breakupRaw.green),
        preTaxFreight: asFiniteNumber(breakupRaw.preTaxFreight),
        gst: asFiniteNumber(breakupRaw.gst),
        gstPercent: asFiniteNumber(breakupRaw.gstPercent),
        markup: asFiniteNumber(breakupRaw.markup),
        otherHandlingCharges: asFiniteNumber(breakupRaw.otherHandlingCharges),
      }
      : null,
    billingMode: billing === 'fod' || billing === 'btc' ? billing : null,
    error: data.error == null ? null : String(data.error),
    fetchedAt: String(data.fetchedAt ?? ''),
  };
}

/** Billed freight after Delhivery captures weight — GET /lrn/freight-breakup. */
export async function fetchDelhiveryFreightCharges(lrn: string): Promise<DelhiveryFreightChargeEntry> {
  const id = String(lrn ?? '').replace(/[^\dA-Za-z]/g, '').trim();
  if (!id) {
    throw new Error('Enter an LRN to test freight.');
  }
  try {
    const fn = httpsCallable<
      { lrn: string },
      {
        ok: boolean;
        error: string | null;
        byLrn?: Record<string, unknown>;
      }
    >(functions, 'fetchDelhiveryFreightChargesFn', { timeout: 60_000 });
    const result = await fn({ lrn: id });
    const entry = result.data?.byLrn?.[id]
      ?? Object.values(result.data?.byLrn || {})[0]
      ?? null;
    if (entry) return mapFreightChargeEntry(entry, id);
    throw new Error(
      result.data?.error?.trim()
      || 'Freight not available yet. Delhivery returns billed amount after weight capture.',
    );
  } catch (err) {
    throw callableError(err, 'Could not fetch Delhivery freight charges.');
  }
}

export type DelhiveryBookConsignee = {
  name: string;
  phone: string;
  address: string;
  city?: string;
  state?: string;
  pincode: string;
  country?: string;
  email?: string;
  /** Consignee GSTIN when available (sent on dropoff when API accepts it). */
  gstin?: string;
};

export type DelhiveryBillingAddress = {
  name?: string;
  company?: string;
  consignor?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  phone?: string;
  pan_number?: string;
  gst_number?: string;
};

export type DelhiveryBookBox = {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightKg?: number;
  quantity?: number;
};

export type DelhiveryPickupResult = {
  ok: boolean;
  alreadyExisted?: boolean;
  pickupId: string | null;
  pickupLocationName?: string | null;
  pickupDate?: string | null;
  pickupTime?: string | null;
  expectedPackageCount?: number | null;
  message?: string | null;
  requestedAt?: string;
};

export type DelhiveryBookResult = {
  ok: boolean;
  lrn: string;
  /** Master AWB from label URLs when available after manifest. */
  masterAwb?: string | null;
  jobId?: string | null;
  env?: DelhiveryB2bEnv;
  /** First-mile pickup after Create LR (soft-fail; LR still succeeds). */
  pickup?: DelhiveryPickupResult | null;
};

export async function bookDelhiveryShipment(input: {
  shipFromSite: StaffLogisticsSite | string;
  pickupLocationName?: string;
  orderId?: string;
  consignee: DelhiveryBookConsignee;
  returnAddress?: DelhiveryBookConsignee | null;
  billingAddress?: DelhiveryBillingAddress | null;
  boxes: DelhiveryBookBox[];
  invoiceNumber?: string | null;
  invoiceValueInr?: number | null;
  invoiceId?: string | null;
  zohoCustomerId?: string | null;
  invoiceDate?: string | null;
  productsDesc?: string | null;
  hsnCode?: string | null;
  sellerGstin?: string | null;
  paymentMode?: string | null;
  shippingMode?: string | null;
  /** fod = consignee pays freight; btc/omit = bill to client. */
  freightBillingMode?: 'fod' | 'btc' | null;
  /** Extra invoices on the same LR (includes primary). */
  invoices?: Array<{
    invoiceId?: string | null;
    invoiceNumber?: string | null;
    invoiceValueInr?: number | null;
  }> | null;
}): Promise<DelhiveryBookResult> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryBookResult>(
      functions,
      'bookDelhiveryShipmentFn',
      { timeout: 120_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not book Delhivery shipment.');
  }
}

export async function createDelhiveryPickupRequest(input: {
  shipFromSite: StaffLogisticsSite | string;
  pickupLocationName?: string;
  expectedPackageCount?: number;
  boxes?: DelhiveryBookBox[];
  pickupDate?: string;
  pickupTime?: string;
}): Promise<DelhiveryPickupResult> {
  try {
    const fn = httpsCallable<typeof input, DelhiveryPickupResult>(
      functions,
      'createDelhiveryPickupRequestFn',
      { timeout: 60_000 },
    );
    const result = await fn(input);
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not create Delhivery pickup request.');
  }
}

export type DelhiveryCancelResult = {
  ok: boolean;
  lrn: string;
  env?: DelhiveryB2bEnv;
  message?: string;
};

/** Cancel an LR on Delhivery (DELETE /lrn/cancel/{lrn}). */
export async function cancelDelhiveryShipment(lrn: string): Promise<DelhiveryCancelResult> {
  try {
    const fn = httpsCallable<{ lrn: string }, DelhiveryCancelResult>(
      functions,
      'cancelDelhiveryShipmentFn',
      { timeout: 60_000 },
    );
    const result = await fn({ lrn });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not cancel Delhivery shipment.');
  }
}
