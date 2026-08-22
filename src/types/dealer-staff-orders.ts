import type { CartItem } from './cart';
import type { SubmitDealerOrderLineInput } from './dealer-orders';

export type DealerStaffOrderKind = 'sales' | 'service';
export type DealerStaffOrderApprovalStatus = 'pending_approval' | 'placed' | 'rejected';

export interface DealerStaffOrderApproval {
  id: string;
  dealerUid: string;
  status: DealerStaffOrderApprovalStatus;
  submittedByUid: string;
  submittedByName: string;
  submittedByTeam: DealerStaffOrderKind;
  kind: DealerStaffOrderKind;
  lines: SubmitDealerOrderLineInput[];
  displayLines: CartItem[];
  shipping: {
    addressId?: string;
    kind?: string;
    newAddress?: Record<string, unknown>;
  };
  remarks: string;
  courierBySite?: Record<string, string> | null;
  freightZone?: string | null;
  freightZoneOverrideReason?: string | null;
  manualFreightAmountInr?: number | null;
  freightBillingMode?: 'fod' | 'btc' | null;
  createdAtMs: number;
  cartLineIds: string[];
}
