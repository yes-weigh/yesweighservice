import {
  BLUEDART_LOGISTICS_PARTNER_IDS,
  LOGISTICS_PARTNER_IDS,
  type LogisticsPartnerId,
} from './logisticsPartners';
import {
  isLogisticsPartnerStatus,
  type LogisticsPartnerStatus,
  type LogisticsPartnerStatuses,
} from '../types/logistics-partner-status';

function defaultStatusForPartner(id: LogisticsPartnerId): LogisticsPartnerStatus {
  if (id === 'personal_collection') return 'active';
  if (id === 'delhivery') return 'manual';
  if (
    id === 'st_courier'
    || id === 'trackon'
    || (BLUEDART_LOGISTICS_PARTNER_IDS as readonly string[]).includes(id)
  ) {
    return 'active';
  }
  return 'inactive';
}

/** Defaults: rate-card partners active, Delhivery manual, others inactive. */
export function defaultLogisticsPartnerStatuses(): LogisticsPartnerStatuses {
  const out = {} as LogisticsPartnerStatuses;
  for (const id of LOGISTICS_PARTNER_IDS) {
    out[id] = defaultStatusForPartner(id);
  }
  return out;
}

export function normalizeLogisticsPartnerStatuses(raw: unknown): LogisticsPartnerStatuses {
  const defaults = defaultLogisticsPartnerStatuses();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  const out = { ...defaults };
  for (const id of LOGISTICS_PARTNER_IDS) {
    const value = data[id];
    if (isLogisticsPartnerStatus(value)) out[id] = value;
  }
  return out;
}

export function partnerStatusesEqual(
  a: LogisticsPartnerStatuses,
  b: LogisticsPartnerStatuses,
): boolean {
  return LOGISTICS_PARTNER_IDS.every(id => a[id] === b[id]);
}

/** SO freight may offer this partner (rules still may list inactive). */
export function partnerStatusSelectableOnSalesOrder(
  status: LogisticsPartnerStatus | null | undefined,
): boolean {
  return status === 'active' || status === 'manual';
}

export function partnerStatusAllowsManualFreight(
  status: LogisticsPartnerStatus | null | undefined,
): boolean {
  return status === 'manual';
}
