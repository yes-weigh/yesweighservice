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
] as const;

export type DeliveryPartnerTabId = typeof DELIVERY_PARTNER_TAB_IDS[number];

/** Zoho e-way transporter linked to a delivery partner tab. */
export type DeliveryPartnerTransporterRef = {
  id: string;
  name: string;
};

export type DeliveryPartnerTransporters = Record<
  DeliveryPartnerTabId,
  DeliveryPartnerTransporterRef | null
>;

export function defaultDeliveryPartnerTransporters(): DeliveryPartnerTransporters {
  const out = {} as DeliveryPartnerTransporters;
  for (const id of DELIVERY_PARTNER_TAB_IDS) {
    out[id] = null;
  }
  return out;
}

export function normalizeDeliveryPartnerTransporterRef(
  raw: unknown,
): DeliveryPartnerTransporterRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = String(data.id ?? '').trim();
  const name = String(data.name ?? '').trim();
  if (!id || !name) return null;
  return { id, name };
}

export function normalizeDeliveryPartnerTransporters(
  raw: unknown,
): DeliveryPartnerTransporters {
  const defaults = defaultDeliveryPartnerTransporters();
  if (!raw || typeof raw !== 'object') return defaults;
  const data = raw as Record<string, unknown>;
  const out = { ...defaults };
  for (const id of DELIVERY_PARTNER_TAB_IDS) {
    out[id] = normalizeDeliveryPartnerTransporterRef(data[id]);
  }
  return out;
}

export function deliveryPartnerTransportersEqual(
  a: DeliveryPartnerTransporters,
  b: DeliveryPartnerTransporters,
): boolean {
  return DELIVERY_PARTNER_TAB_IDS.every(id => {
    const left = a[id];
    const right = b[id];
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.id === right.id && left.name === right.name;
  });
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
