import type { BlueDartServiceId } from '../types/logistics-courier-rates';
import type { DeliveryMethodId } from './deliveryMethods';
import { DELIVERY_METHODS } from './deliveryMethods';

/** Partners shown in logistics booking, delivery rules, and SO freight. */
export const LOGISTICS_PARTNER_IDS = [
  'st_courier',
  'trackon',
  'delhivery',
  'bluedart_air',
  'bluedart_surface',
  'bluedart_domestic',
  'dtdc',
  'ecosafe',
  'aps',
  'personal_collection',
  'own_vehicle',
] as const satisfies readonly DeliveryMethodId[];

export type LogisticsPartnerId = typeof LOGISTICS_PARTNER_IDS[number];

/** Blue Dart services as distinct shipping partners (not the rates-doc key `bluedart`). */
export const BLUEDART_LOGISTICS_PARTNER_IDS = [
  'bluedart_air',
  'bluedart_surface',
  'bluedart_domestic',
] as const satisfies readonly LogisticsPartnerId[];

export type BlueDartLogisticsPartnerId = typeof BLUEDART_LOGISTICS_PARTNER_IDS[number];

export const BLUEDART_PARTNER_TO_SERVICE: Record<BlueDartLogisticsPartnerId, BlueDartServiceId> = {
  bluedart_air: 'air',
  bluedart_surface: 'surface',
  bluedart_domestic: 'domestic_priority',
};

export const BLUEDART_SERVICE_TO_PARTNER: Record<BlueDartServiceId, BlueDartLogisticsPartnerId> = {
  air: 'bluedart_air',
  surface: 'bluedart_surface',
  domestic_priority: 'bluedart_domestic',
};

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

export function logisticsPartnerImage(id: LogisticsPartnerId | string): string | null {
  if (!isLogisticsPartnerId(id)) return null;
  return LOGISTICS_PARTNERS.find(partner => partner.id === id)?.image ?? null;
}

export function isLogisticsPartnerId(id: string): id is LogisticsPartnerId {
  return LOGISTICS_PARTNER_IDS.includes(id as LogisticsPartnerId);
}

export function isBlueDartLogisticsPartnerId(id: string): id is BlueDartLogisticsPartnerId {
  return (BLUEDART_LOGISTICS_PARTNER_IDS as readonly string[]).includes(id);
}

/** Map legacy consolidated `bluedart` → Surface; else validate. */
export function normalizeLogisticsPartnerId(raw: unknown): LogisticsPartnerId | null {
  const id = String(raw ?? '').trim();
  if (!id) return null;
  if (id === 'bluedart') return 'bluedart_surface';
  if (isLogisticsPartnerId(id)) return id;
  return null;
}

export function blueDartServiceForPartner(
  partnerId: LogisticsPartnerId | string,
): BlueDartServiceId | null {
  if (!isBlueDartLogisticsPartnerId(partnerId)) return null;
  return BLUEDART_PARTNER_TO_SERVICE[partnerId];
}

export function partnerIdForBlueDartService(
  service: BlueDartServiceId,
): BlueDartLogisticsPartnerId {
  return BLUEDART_SERVICE_TO_PARTNER[service];
}
