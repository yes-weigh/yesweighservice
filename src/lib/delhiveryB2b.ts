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
