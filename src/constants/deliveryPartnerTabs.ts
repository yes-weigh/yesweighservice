import {
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
  type LogisticsPartnerId,
} from './logisticsPartners';

/** Partner picker tabs on Settings → Logistics → Delivery Partners. */
export const DELIVERY_PARTNER_TAB_IDS = [
  'bluedart',
  'trackon',
  'delhivery',
  'st_courier',
  'dtdc',
  'ecosafe',
  'aps',
  'personal_collection',
  'own_vehicle',
] as const;

export type DeliveryPartnerTabId = typeof DELIVERY_PARTNER_TAB_IDS[number];

export type DeliveryPartnerGstins = Record<DeliveryPartnerTabId, string>;

export function defaultDeliveryPartnerGstins(): DeliveryPartnerGstins {
  const out = {} as DeliveryPartnerGstins;
  for (const id of DELIVERY_PARTNER_TAB_IDS) {
    out[id] = '';
  }
  return out;
}

export function normalizeDeliveryPartnerGstins(raw: unknown): DeliveryPartnerGstins {
  const defaults = defaultDeliveryPartnerGstins();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  const out = { ...defaults };
  for (const id of DELIVERY_PARTNER_TAB_IDS) {
    const value = data[id];
    if (typeof value === 'string') {
      out[id] = value.trim().toUpperCase();
    }
  }
  return out;
}

export function deliveryPartnerGstinsEqual(
  a: DeliveryPartnerGstins,
  b: DeliveryPartnerGstins,
): boolean {
  return DELIVERY_PARTNER_TAB_IDS.every(id => a[id] === b[id]);
}

export function deliveryPartnerTabForLogisticsPartner(
  partnerId: LogisticsPartnerId,
): DeliveryPartnerTabId {
  if (isBlueDartLogisticsPartnerId(partnerId)) return 'bluedart';
  if (isTrackonLogisticsPartnerId(partnerId)) return 'trackon';
  return partnerId as DeliveryPartnerTabId;
}

export function isDeliveryPartnerTabId(id: string): id is DeliveryPartnerTabId {
  return (DELIVERY_PARTNER_TAB_IDS as readonly string[]).includes(id);
}
