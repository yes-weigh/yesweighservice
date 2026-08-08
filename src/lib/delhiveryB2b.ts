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
};

export type DelhiveryBookBox = {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightKg?: number;
  quantity?: number;
};

export type DelhiveryBookResult = {
  ok: boolean;
  lrn: string;
  jobId?: string | null;
  env?: DelhiveryB2bEnv;
};

export async function bookDelhiveryShipment(input: {
  shipFromSite: StaffLogisticsSite | string;
  pickupLocationName?: string;
  orderId?: string;
  consignee: DelhiveryBookConsignee;
  returnAddress?: DelhiveryBookConsignee | null;
  boxes: DelhiveryBookBox[];
  invoiceNumber?: string | null;
  invoiceValueInr?: number | null;
  invoiceDate?: string | null;
  productsDesc?: string | null;
  hsnCode?: string | null;
  sellerGstin?: string | null;
  paymentMode?: string | null;
  shippingMode?: string | null;
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
