import type { Dispatch, SetStateAction } from 'react';
import type { AdminSalesOrderDetail } from '../../lib/admin-sales-orders';

export type SalesOrderActionBusy =
  | 'ready'
  | 'verify'
  | 'markInvoiced'
  | 'repairInvoicing'
  | 'void'
  | 'delete'
  | 'applySalesperson'
  | 'applySalespersonStaff'
  | null;

export interface SalesOrderWorkflowActions {
  actionBusy: SalesOrderActionBusy;
  canReady: boolean;
  canVerify: boolean;
  /** True when Verify is blocked only because salesperson is missing. */
  needsSalesperson: boolean;
  canApplySalesperson: boolean;
  canAssignSalespersonStaff: boolean;
  assignableStaff: Array<{ uid: string; displayName: string }>;
  /** Manual mark completed after Zoho already invoiced outside YesOne. */
  canMarkInvoiced: boolean;
  /** Reset false completed (no linked Zoho invoice). */
  canRepairInvoicing: boolean;
  canVoid: boolean;
  canDelete: boolean;
  dealerPath: string | null;
  onReady: () => void;
  onVerify: () => void;
  onMarkInvoiced: () => void;
  onRepairInvoicing: () => void;
  onApplySalesperson: () => void;
  onApplySalespersonFromStaff: (staffUid: string) => void;
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
