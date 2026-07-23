import type { AdminPurchaseOrderDetail } from '../../lib/admin-purchase-orders';

export interface AdminPurchaseOrderDetailOutletContext {
  purchaseOrder: AdminPurchaseOrderDetail | null;
  loading: boolean;
  error: string;
  purchaseOrderId: string;
  listPath: string;
}
