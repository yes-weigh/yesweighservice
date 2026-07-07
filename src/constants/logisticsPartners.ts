import type { DeliveryMethodId } from './deliveryMethods';
import { DELIVERY_METHODS } from './deliveryMethods';

/** Nine partners shown in the YESONE logistics booking flow. */
export const LOGISTICS_PARTNER_IDS = [
  'st_courier',
  'trackon',
  'delhivery',
  'bluedart',
  'dtdc',
  'ecosafe',
  'aps',
  'personal_collection',
  'own_vehicle',
] as const satisfies readonly DeliveryMethodId[];

export type LogisticsPartnerId = typeof LOGISTICS_PARTNER_IDS[number];

const LOGISTICS_LABEL_OVERRIDES: Partial<Record<LogisticsPartnerId, string>> = {
  personal_collection: 'Customer Pickup',
};

export const LOGISTICS_PARTNERS = LOGISTICS_PARTNER_IDS.map(id => {
  const method = DELIVERY_METHODS.find(item => item.id === id)!;
  return {
    ...method,
    label: LOGISTICS_LABEL_OVERRIDES[id] ?? method.label,
  };
});

export function logisticsPartnerLabel(id: LogisticsPartnerId | string): string {
  if (isLogisticsPartnerId(id) && LOGISTICS_LABEL_OVERRIDES[id]) {
    return LOGISTICS_LABEL_OVERRIDES[id]!;
  }
  return LOGISTICS_PARTNERS.find(partner => partner.id === id)?.label ?? String(id);
}

export function isLogisticsPartnerId(id: string): id is LogisticsPartnerId {
  return LOGISTICS_PARTNER_IDS.includes(id as LogisticsPartnerId);
}
