import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type {
  DealerOrder,
  DealerOrderLine,
  DealerOrderStatus,
  SubmitDealerOrderLineInput,
} from '../types/dealer-orders';
import { dealerOrderStatusLabel } from '../types/dealer-orders';

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

export async function submitDealerOrder(
  lines: SubmitDealerOrderLineInput[],
): Promise<DealerOrder> {
  try {
    return await call('submitDealerOrder', { lines });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function fetchDealerOrder(orderId: string): Promise<DealerOrder> {
  try {
    return await call('getDealerOrder', { orderId });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function listDealerOrders(params: {
  status?: DealerOrderStatus | '';
  dealerId?: string;
  limit?: number;
} = {}): Promise<DealerOrder[]> {
  try {
    const res = await call<typeof params, { data: DealerOrder[] }>('listDealerOrders', params);
    return res.data ?? [];
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function updateDealerOrderLines(
  orderId: string,
  lines: Array<{ productId: string; quantity: number }>,
): Promise<DealerOrder> {
  try {
    return await call('updateDealerOrderLines', { orderId, lines });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function approveDealerOrder(orderId: string): Promise<DealerOrder> {
  try {
    return await call('approveDealerOrder', { orderId });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function rejectDealerOrder(orderId: string, reason: string): Promise<DealerOrder> {
  try {
    return await call('rejectDealerOrder', { orderId, reason });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function cancelDealerOrder(orderId: string): Promise<DealerOrder> {
  try {
    return await call('cancelDealerOrder', { orderId });
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function uploadDealerOrderPaymentScreenshot(
  orderId: string,
  file: File,
): Promise<{ storagePath: string; url: string }> {
  const dataBase64 = await fileToBase64(file);
  try {
    return await call(
      'uploadDealerOrderPaymentScreenshotFn',
      {
        orderId,
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

export async function submitDealerOrderPayment(input: {
  orderId: string;
  paymentScreenshotStoragePath: string;
  paymentUtr?: string;
}): Promise<DealerOrder> {
  try {
    return await call('submitDealerOrderPayment', input);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function verifyDealerOrderPayment(orderId: string): Promise<DealerOrder> {
  try {
    return await call('verifyDealerOrderPayment', { orderId }, 180_000);
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function fetchPendingDealerOrderCount(): Promise<number> {
  try {
    const res = await call<undefined, { count: number }>('getPendingDealerOrderCount');
    return Number(res.count ?? 0);
  } catch {
    return 0;
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

export function summarizeOrderChanges(order: Pick<DealerOrder, 'changes' | 'submittedLines' | 'lines'>): {
  added: number;
  removed: number;
  qtyChanged: number;
  label: string;
} {
  const changes = order.changes ?? [];
  const added = changes.filter(c => c.type === 'added').length;
  const removed = changes.filter(c => c.type === 'removed').length;
  const qtyChanged = changes.filter(c => c.type === 'qty_changed' || c.type === 'rate_changed').length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (qtyChanged) parts.push(`${qtyChanged} adjusted`);
  return {
    added,
    removed,
    qtyChanged,
    label: parts.length ? parts.join(' · ') : 'No changes from your submission',
  };
}

export type LineDiffKind = 'unchanged' | 'added' | 'removed' | 'qty_changed';

export interface DiffLine {
  kind: LineDiffKind;
  productId: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  submittedQty: number | null;
  currentQty: number | null;
  rate: number;
  lineTotal: number;
}

export function buildOrderLineDiff(order: Pick<DealerOrder, 'submittedLines' | 'lines'>): DiffLine[] {
  const submitted = new Map((order.submittedLines ?? []).map(line => [line.productId, line]));
  const current = new Map((order.lines ?? []).map(line => [line.productId, line]));
  const ids = new Set([...submitted.keys(), ...current.keys()]);
  const rows: DiffLine[] = [];

  for (const productId of ids) {
    const s = submitted.get(productId);
    const c = current.get(productId);
    if (s && c) {
      const kind: LineDiffKind = Number(s.quantity) === Number(c.quantity) ? 'unchanged' : 'qty_changed';
      rows.push({
        kind,
        productId,
        name: c.name,
        sku: c.sku,
        imageUrl: c.imageUrl,
        submittedQty: s.quantity,
        currentQty: c.quantity,
        rate: c.rate,
        lineTotal: c.lineTotal,
      });
    } else if (c) {
      rows.push({
        kind: 'added',
        productId,
        name: c.name,
        sku: c.sku,
        imageUrl: c.imageUrl,
        submittedQty: null,
        currentQty: c.quantity,
        rate: c.rate,
        lineTotal: c.lineTotal,
      });
    } else if (s) {
      rows.push({
        kind: 'removed',
        productId,
        name: s.name,
        sku: s.sku,
        imageUrl: s.imageUrl,
        submittedQty: s.quantity,
        currentQty: null,
        rate: s.rate,
        lineTotal: s.lineTotal,
      });
    }
  }

  return rows;
}

export function formatOrderLineQty(line: DealerOrderLine): string {
  return `${line.quantity} × ${line.unit}`;
}

export { dealerOrderStatusLabel };
