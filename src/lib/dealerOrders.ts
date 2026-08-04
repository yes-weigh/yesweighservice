import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { SubmitDealerOrderLineInput } from '../types/dealer-orders';
import {
  shippingSelectionPayload,
  type ShippingSelection,
} from './shippingAddresses';

const functions = getFunctions(app, 'asia-south1');

export function dealerOrderErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (message) return message.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '');
  }
  return 'Something went wrong with this order.';
}

async function call<TReq, TRes>(name: string, data?: TReq, timeout = 60_000): Promise<TRes> {
  const callable = httpsCallable<TReq | undefined, TRes>(functions, name, { timeout });
  const result = await callable(data);
  return result.data;
}

export interface SegmentSalesOrderResult {
  segment: 'product' | 'spare' | 'software';
  segmentLabel: string;
  inventorySite?: 'cochin' | 'head_office' | null;
  branchLabel?: string | null;
  bucketLabel?: string | null;
  orderNumber: string;
  zohoSalesOrderId: string;
  zohoSalesOrderNumber: string | null;
  status: string;
  subtotal: number;
  itemCount: number;
  salespersonId: string | null;
  salespersonName: string | null;
}

export interface SubmitDealerOrderResult {
  zohoSalesOrderId: string | null;
  zohoSalesOrderNumber: string | null;
  orderNumber: string;
  status: string;
  subtotal: number;
  itemCount: number;
  dealerId: string | null;
  zohoCustomerId: string;
  dealerName: string | null;
  createdByUid: string;
  createdByName: string;
  salesOrders?: SegmentSalesOrderResult[];
}

/** Place cart as a Zoho Inventory Draft sales order. */
export async function submitDealerOrder(
  lines: SubmitDealerOrderLineInput[],
  shipping: ShippingSelection,
  remarks = '',
  courierBySite?: Partial<Record<'cochin' | 'head_office', string>>,
  freightZone?: string,
  freightZoneOverrideReason?: string,
): Promise<SubmitDealerOrderResult> {
  try {
    return await call(
      'submitDealerOrder',
      {
        lines,
        shipping: shippingSelectionPayload(shipping),
        remarks: remarks.trim() || undefined,
        courierBySite: courierBySite || undefined,
        ...(freightZone ? { freightZone } : {}),
        ...(freightZoneOverrideReason?.trim()
          ? { freightZoneOverrideReason: freightZoneOverrideReason.trim() }
          : {}),
      },
      180_000,
    );
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function confirmZohoSalesOrder(salesOrderId: string): Promise<{
  salesOrderId: string;
  status: string;
  salesOrderNumber: string | null;
}> {
  try {
    return await call('confirmZohoSalesOrder', { salesOrderId }, 120_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function voidZohoSalesOrder(
  salesOrderId: string,
  reason = '',
): Promise<{
  salesOrderId: string;
  status: string;
  salesOrderNumber: string | null;
}> {
  try {
    return await call('voidZohoSalesOrder', { salesOrderId, reason }, 120_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

/** Super admin: delete all legacy portal dealerOrders documents. */
export async function purgeDealerOrders(): Promise<{ deleted: number; collection: string }> {
  try {
    return await call('purgeDealerOrders', undefined, 540_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}
