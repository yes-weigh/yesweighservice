/** GST rule: e-way bill required when consignment/invoice value exceeds this (INR). */
export const EWAY_BILL_THRESHOLD_INR = 50_000;

export function isEwayBillRequired(invoiceTotalInr: unknown): boolean {
  const total = Number(invoiceTotalInr);
  return Number.isFinite(total) && total > EWAY_BILL_THRESHOLD_INR;
}

export function ewayBillRequiredLabel(totalInr: unknown): string {
  if (!isEwayBillRequired(totalInr)) {
    return `Not required — invoice value is ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`;
  }
  return 'Required for this invoice value.';
}

export const EWAY_BILL_CANCEL_REASONS = [
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'order_cancelled', label: 'Order cancelled' },
  { id: 'data_entry_mistake', label: 'Data entry mistake' },
  { id: 'others', label: 'Others' },
] as const;

export type EwayBillCancelReason = typeof EWAY_BILL_CANCEL_REASONS[number]['id'];

export function isEwayBillCancelReason(value: unknown): value is EwayBillCancelReason {
  return typeof value === 'string'
    && EWAY_BILL_CANCEL_REASONS.some(option => option.id === value);
}
