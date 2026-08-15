import type { AdminPurchaseOrderDetail } from '../../lib/admin-purchase-orders';

export interface AdminPurchaseOrderDetailOutletContext {
  purchaseOrder: AdminPurchaseOrderDetail | null;
  setPurchaseOrder: (next: AdminPurchaseOrderDetail | null) => void;
  loading: boolean;
  error: string;
  purchaseOrderId: string;
  listPath: string;
}
