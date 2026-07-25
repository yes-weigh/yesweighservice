import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { AdminSalesOrderDetail } from './admin-sales-orders';
import { dealerOrderErrorMessage } from './dealerOrders';

const functions = getFunctions(app, 'asia-south1');

export type YesOneSalesOrderStage =
  | 'review'
  | 'ready_for_payment'
  | 'payment_submitted'
  | 'completed'
  | 'void';

export const YESONE_STAGE_LABELS: Record<YesOneSalesOrderStage, string> = {
  review: 'Order placed',
  ready_for_payment: 'Awaiting payment',
  payment_submitted: 'Payment submitted',
  completed: 'Completed',
  void: 'Void',
};

export function yesOneStageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return YESONE_STAGE_LABELS[stage as YesOneSalesOrderStage] ?? stage;
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
  lines: Array<{ productId: string; quantity: number }>,
): Promise<SalesOrderWorkflowDetail> {
  try {
    return await call('updateDraftSalesOrderLines', { salesOrderId, lines }, 180_000);
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
