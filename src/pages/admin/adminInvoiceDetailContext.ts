import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

export interface AdminInvoiceDetailOutletContext {
  invoice: DealerInvoiceDetail | null;
  loading: boolean;
  error: string;
  customerId: string;
  invoiceId: string;
  invoicesPath: string;
  /** Show Manual Logistics under the item list (ops, no booking yet). */
  showManualLogistics: boolean;
  manualLogisticsPartnerId: LogisticsPartnerId;
  manualLogisticsShipFrom: StaffLogisticsSite | null;
  onOpenManualLogistics: () => void;
  existingBooking: LogisticsBooking | null;
}
