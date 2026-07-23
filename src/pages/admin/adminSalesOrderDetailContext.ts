import type { AdminSalesOrderDetail } from '../../lib/admin-sales-orders';

export interface AdminSalesOrderDetailOutletContext {
  salesOrder: AdminSalesOrderDetail | null;
  loading: boolean;
  error: string;
  salesOrderId: string;
  listPath: string;
}
