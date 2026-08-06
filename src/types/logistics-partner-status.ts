import type { LogisticsPartnerId } from '../constants/logisticsPartners';

/**
 * How a delivery partner behaves on sales-order freight selection.
 * - active: selectable when rate card / quote works
 * - manual: selectable; staff enter freight ₹ when quote is missing
 * - inactive: may still appear in delivery rules, but hidden on SO creation
 */
export type LogisticsPartnerStatus = 'active' | 'inactive' | 'manual';

export const LOGISTICS_PARTNER_STATUSES = [
  'active',
  'inactive',
  'manual',
] as const satisfies readonly LogisticsPartnerStatus[];

export const LOGISTICS_PARTNER_STATUS_LABELS: Record<LogisticsPartnerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  manual: 'Manual',
};

export type LogisticsPartnerStatuses = Record<LogisticsPartnerId, LogisticsPartnerStatus>;

export function isLogisticsPartnerStatus(value: unknown): value is LogisticsPartnerStatus {
  return typeof value === 'string'
    && (LOGISTICS_PARTNER_STATUSES as readonly string[]).includes(value);
}
