import type { ZohoDealer } from '../types/dealers';
import type { LogisticsBooking } from '../types/logistics-dispatch';

export function buildDealerStaffNameMap(dealers: ZohoDealer[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const dealer of dealers) {
    const name = dealer.assignedStaffName?.trim();
    if (name) next[dealer.id] = name;
  }
  return next;
}

export function resolveDealerKamName(input: {
  zohoCustomerId?: string | null;
  documentSalespersonName?: string | null;
  dealerStaffById: Record<string, string>;
  snapshotAssignedStaffName?: string | null;
}): string {
  const snap = input.snapshotAssignedStaffName?.trim();
  if (snap) return snap;
  const id = input.zohoCustomerId?.trim();
  if (id) {
    const assigned = input.dealerStaffById[id]?.trim();
    if (assigned) return assigned;
  }
  return input.documentSalespersonName?.trim() || '';
}

export function bookingStaffName(
  booking: LogisticsBooking,
  dealerStaffById: Record<string, string>,
  invoiceSalespersonName?: string | null,
): string {
  return resolveDealerKamName({
    zohoCustomerId: booking.dealer.zohoCustomerId,
    documentSalespersonName: invoiceSalespersonName,
    dealerStaffById,
    snapshotAssignedStaffName: booking.dealer.assignedStaffName,
  });
}
