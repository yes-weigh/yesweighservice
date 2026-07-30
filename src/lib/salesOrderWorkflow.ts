import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { AdminSalesOrderDetail } from './admin-sales-orders';
import { dealerOrderErrorMessage } from './dealerOrders';
import {
  shippingSelectionPayload,
  type ShippingSelection,
} from './shippingAddresses';

const functions = getFunctions(app, 'asia-south1');

export type YesOneSalesOrderStage =
  | 'review'
  | 'ready_for_payment'
  | 'payment_submitted'
  | 'completed'
  | 'void';

export type YesOneStageAudience = 'dealer' | 'admin';

/** Filter chips for YesOne workflow stages (list UI). */
export type YesOneStageFilter =
  | 'review'
  | 'ready_for_payment'
  | 'payment_submitted'
  | 'completed';

export const YESONE_STAGE_FILTERS: YesOneStageFilter[] = [
  'review',
  'ready_for_payment',
  'payment_submitted',
  'completed',
];

/** @deprecated Prefer yesOneStageLabelForAudience — kept for shared/fallback copy. */
export const YESONE_STAGE_LABELS: Record<YesOneSalesOrderStage, string> = {
  review: 'Order placed',
  ready_for_payment: 'Awaiting payment',
  payment_submitted: 'Payment submitted',
  completed: 'Completed',
  void: 'Void',
};

export const YESONE_STAGE_LABELS_DEALER: Record<YesOneSalesOrderStage, string> = {
  review: 'submitted',
  ready_for_payment: 'payment due',
  payment_submitted: 'under review',
  completed: 'invoiced',
  void: 'Void',
};

export const YESONE_STAGE_LABELS_ADMIN: Record<YesOneSalesOrderStage, string> = {
  review: 'new order',
  ready_for_payment: 'Awaiting payment',
  payment_submitted: 'pending approval',
  completed: 'invoiced',
  void: 'Void',
};

export function yesOneStageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return YESONE_STAGE_LABELS[stage as YesOneSalesOrderStage] ?? stage;
}

export function yesOneStageLabelForAudience(
  stage: string | null | undefined,
  audience: YesOneStageAudience,
): string {
  if (!stage) return '';
  const key = stage as YesOneSalesOrderStage;
  if (audience === 'dealer') {
    return YESONE_STAGE_LABELS_DEALER[key] ?? stage;
  }
  return YESONE_STAGE_LABELS_ADMIN[key] ?? stage;
}

export function yesOneStageStatusClass(stage: string | null | undefined): string {
  const key = String(stage || '').trim();
  if (key === 'review') return 'invoices-status invoices-status--draft so-status--yesone-review';
  if (key === 'ready_for_payment') {
    return 'invoices-status invoices-status--overdue so-status--yesone-pay';
  }
  if (key === 'payment_submitted') {
    return 'invoices-status invoices-status--partially_paid so-status--yesone-verify';
  }
  if (key === 'completed') return 'invoices-status invoices-status--paid so-status--yesone-done';
  if (key === 'void') return 'invoices-status invoices-status--void so-status--yesone-void';
  return 'invoices-status invoices-status--draft';
}

export interface SalesOrderWorkflowDetail extends AdminSalesOrderDetail {
  yesOneStage: YesOneSalesOrderStage | string | null;
  paymentAmount: number | null;
  paymentUtr: string | null;
  paymentScreenshotStoragePath: string | null;
  paymentScreenshotUrl: string | null;
  paymentSubmittedAt: string | null;
  paymentVerifiedAt: string | null;
  readyForPaymentAt: string | null;
  readyForPaymentByName: string | null;
  zohoInvoiceId: string | null;
  zohoInvoiceNumber: string | null;
}

async function call<TReq, TRes>(name: string, data?: TReq, timeout = 60_000): Promise<TRes> {
  const callable = httpsCallable<TReq | undefined, TRes>(functions, name, { timeout });
  const result = await callable(data);
  return result.data;
}

export async function updateDraftSalesOrderLines(
  salesOrderId: string,
  lines: Array<{
    productId: string;
    quantity: number;
    /** Staff: base product rate (server adds GATC fee). */
    rate?: number;
    gatcStampingPriceId?: string | null;
  }>,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('updateDraftSalesOrderLines', { salesOrderId, lines }, 180_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function createStaffSalesOrder(input: {
  zohoCustomerId: string;
  lines: Array<{
    productId: string;
    quantity: number;
    /** Staff: base product rate (server adds GATC fee). */
    rate?: number;
    gatcStampingPriceId?: string | null;
  }>;
  shipping: ShippingSelection;
  stage: 'review' | 'ready_for_payment';
  remarks?: string;
  /** Full super admin without a linked Zoho salesperson: required override. */
  salespersonId?: string | null;
}): Promise<{
  zohoSalesOrderId: string;
  zohoSalesOrderNumber: string | null;
  orderNumber: string;
  yesOneStage: string;
  subtotal: number;
  priceCustomized: boolean;
}> {
  try {
    return await call(
      'createStaffSalesOrder',
      {
        zohoCustomerId: input.zohoCustomerId,
        lines: input.lines,
        shipping: shippingSelectionPayload(input.shipping),
        stage: input.stage,
        remarks: input.remarks ?? '',
        ...(input.salespersonId?.trim()
          ? { salespersonId: input.salespersonId.trim() }
          : {}),
      },
      180_000,
    );
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function updateDraftSalesOrderShipping(
  salesOrderId: string,
  shipping: ShippingSelection,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call(
      'updateDraftSalesOrderShipping',
      { salesOrderId, shipping: shippingSelectionPayload(shipping) },
      120_000,
    );
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function markSalesOrderReadyForPayment(
  salesOrderId: string,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('markSalesOrderReadyForPayment', { salesOrderId });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function uploadSalesOrderPaymentScreenshot(
  salesOrderId: string,
  file: File,
): Promise<{ storagePath: string; url: string }> {
  const dataBase64 = await fileToBase64(file);
  try {
    return await call(
      'uploadSalesOrderPaymentScreenshotFn',
      {
        salesOrderId,
        contentType: file.type || 'image/jpeg',
        dataBase64,
        fileName: file.name,
      },
      120_000,
    );
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function submitSalesOrderPayment(input: {
  salesOrderId: string;
  paymentScreenshotStoragePath: string;
  paymentUtr?: string;
}): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('submitSalesOrderPayment', input);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function verifySalesOrderPayment(
  salesOrderId: string,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('verifySalesOrderPayment', { salesOrderId }, 180_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

/** Copy dealer assigned staff → Zoho salesperson onto this SO (Zoho + Firestore). */
export async function applySalesOrderSalespersonFromDealer(
  salesOrderId: string,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('applySalesOrderSalespersonFromDealer', { salesOrderId }, 120_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

/** Delete a Draft SO in Zoho and remove the portal mirror. */
export async function deleteDraftSalesOrder(
  salesOrderId: string,
): Promise<{ salesOrderId: string; deleted: boolean }> {
  try {
    return await call('deleteDraftSalesOrder', { salesOrderId }, 120_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}
