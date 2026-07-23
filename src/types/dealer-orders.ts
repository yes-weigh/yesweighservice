/** Portal dealer product orders (cart → staff review → payment → Zoho). */

export type DealerOrderStatus =
  | 'pending_review'
  | 'waiting_for_payment'
  | 'payment_submitted'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export const DEALER_ORDER_STATUSES: readonly DealerOrderStatus[] = [
  'pending_review',
  'waiting_for_payment',
  'payment_submitted',
  'processing',
  'completed',
  'rejected',
  'cancelled',
] as const;

export type DealerOrderChangeType = 'added' | 'removed' | 'qty_changed' | 'rate_changed';

export interface DealerOrderLine {
  productId: string;
  itemId: string | null;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  rate: number;
  unit: string;
  quantity: number;
  lineTotal: number;
  stockStatus: string | null;
  categoryName: string | null;
  taxPercentage?: number;
  hsn?: string | null;
}

export interface DealerOrderChange {
  at: string;
  byUid: string;
  byName: string;
  type: DealerOrderChangeType;
  productId: string;
  productName?: string | null;
  fromQty?: number | null;
  toQty?: number | null;
  fromRate?: number | null;
  toRate?: number | null;
  note?: string | null;
}

export interface DealerOrderStatusEvent {
  status: DealerOrderStatus;
  at: string;
  byUid: string | null;
  byName: string | null;
  note?: string | null;
}

export interface DealerOrder {
  id: string;
  orderNumber: string;
  dealerId: string;
  zohoCustomerId: string;
  dealerName: string | null;
  dealerCode: string | null;
  createdByUid: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  status: DealerOrderStatus;
  statusHistory: DealerOrderStatusEvent[];
  rejectionReason: string | null;
  lines: DealerOrderLine[];
  submittedLines: DealerOrderLine[];
  changes: DealerOrderChange[];
  subtotal: number;
  itemCount: number;
  approvedAt: string | null;
  approvedByUid: string | null;
  approvedByName: string | null;
  paymentAmount: number | null;
  paymentUtr: string | null;
  paymentScreenshotStoragePath: string | null;
  paymentScreenshotUrl: string | null;
  paymentSubmittedAt: string | null;
  paymentVerifiedAt: string | null;
  paymentVerifiedByUid: string | null;
  zohoSalesOrderId: string | null;
  zohoSalesOrderNumber: string | null;
  zohoInvoiceId: string | null;
  zohoInvoiceNumber: string | null;
  zohoSyncError: string | null;
}

export const DEALER_ORDER_STATUS_LABELS: Record<DealerOrderStatus, string> = {
  pending_review: 'Pending review',
  waiting_for_payment: 'Waiting for payment',
  payment_submitted: 'Payment submitted',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function dealerOrderStatusLabel(status: DealerOrderStatus | string): string {
  return DEALER_ORDER_STATUS_LABELS[status as DealerOrderStatus] ?? status;
}

export function dealerOrderStatusClass(status: DealerOrderStatus | string): string {
  const key = String(status || '').trim();
  return key ? `dealer-order-status dealer-order-status--${key}` : 'dealer-order-status';
}

export interface SubmitDealerOrderLineInput {
  productId: string;
  quantity: number;
}

export interface UpdateDealerOrderLinesInput {
  orderId: string;
  lines: Array<{ productId: string; quantity: number }>;
}
