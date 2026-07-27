import type { Dispatch, SetStateAction } from 'react';
import type { AdminSalesOrderDetail } from '../../lib/admin-sales-orders';

export type SalesOrderActionBusy =
  | 'ready'
  | 'verify'
  | 'void'
  | 'delete'
  | 'applySalesperson'
  | null;

export interface SalesOrderWorkflowActions {
  actionBusy: SalesOrderActionBusy;
  canReady: boolean;
  canVerify: boolean;
  /** True when Verify is blocked only because salesperson is missing. */
  needsSalesperson: boolean;
  canApplySalesperson: boolean;
  canVoid: boolean;
  canDelete: boolean;
  dealerPath: string | null;
  onReady: () => void;
  onVerify: () => void;
  onApplySalesperson: () => void;
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
