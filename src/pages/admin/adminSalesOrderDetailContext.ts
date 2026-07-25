import type { Dispatch, SetStateAction } from 'react';
import type { AdminSalesOrderDetail } from '../../lib/admin-sales-orders';

export type SalesOrderActionBusy = 'ready' | 'verify' | 'void' | 'delete' | null;

export interface SalesOrderWorkflowActions {
  actionBusy: SalesOrderActionBusy;
  canReady: boolean;
  canVerify: boolean;
  canVoid: boolean;
  canDelete: boolean;
  onReady: () => void;
  onVerify: () => void;
  onVoid: () => void;
  onDelete: () => void;
}

export interface AdminSalesOrderDetailOutletContext {
  salesOrder: AdminSalesOrderDetail | null;
  loading: boolean;
  error: string;
  salesOrderId: string;
  listPath: string;
  reload: () => void;
  setSalesOrder: Dispatch<SetStateAction<AdminSalesOrderDetail | null>>;
  workflowActions: SalesOrderWorkflowActions | null;
}
