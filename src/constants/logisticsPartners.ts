import type { BlueDartServiceId, TrackonServiceId } from '../types/logistics-courier-rates';
import type { DeliveryMethodId } from './deliveryMethods';
import { DELIVERY_METHODS } from './deliveryMethods';

/** Partners shown in logistics booking, delivery rules, and SO freight. */
export const LOGISTICS_PARTNER_IDS = [
  'st_courier',
  'trackon_air',
  'trackon_surface',
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

/** Trackon services as distinct shipping partners (not the rates-doc key `trackon`). */
export const TRACKON_LOGISTICS_PARTNER_IDS = [
  'trackon_air',
  'trackon_surface',
] as const satisfies readonly LogisticsPartnerId[];

export type TrackonLogisticsPartnerId = typeof TRACKON_LOGISTICS_PARTNER_IDS[number];

export const TRACKON_PARTNER_TO_SERVICE: Record<TrackonLogisticsPartnerId, TrackonServiceId> = {
  trackon_air: 'air',
  trackon_surface: 'surface',
};

export const TRACKON_SERVICE_TO_PARTNER: Record<TrackonServiceId, TrackonLogisticsPartnerId> = {
  air: 'trackon_air',
  surface: 'trackon_surface',
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

export function isTrackonLogisticsPartnerId(id: string): id is TrackonLogisticsPartnerId {
  return (TRACKON_LOGISTICS_PARTNER_IDS as readonly string[]).includes(id);
}

/** Map legacy consolidated ids → Surface; else validate. */
export function normalizeLogisticsPartnerId(raw: unknown): LogisticsPartnerId | null {
  const id = String(raw ?? '').trim();
  if (!id) return null;
  if (id === 'bluedart') return 'bluedart_surface';
  if (id === 'trackon') return 'trackon_surface';
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

export function trackonServiceForPartner(
  partnerId: LogisticsPartnerId | string,
): TrackonServiceId | null {
  if (!isTrackonLogisticsPartnerId(partnerId)) return null;
  return TRACKON_PARTNER_TO_SERVICE[partnerId];
}

export function partnerIdForTrackonService(
  service: TrackonServiceId,
): TrackonLogisticsPartnerId {
  return TRACKON_SERVICE_TO_PARTNER[service];
}
