import { blueDartConfigHasAnyRate } from '../constants/blueDartRates';
import type { FreightLineSku } from '../constants/freightLines';
import { FREIGHT_LINE_OPTIONS } from '../constants/freightLines';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  isLogisticsPartnerId,
  logisticsPartnerLabel,
} from '../constants/logisticsPartners';
import type { LogisticsDeliveryRulesMatrix } from '../types/logistics-delivery-rules';
import {
  BLUE_DART_SERVICE_IDS,
  BLUE_DART_SERVICE_META,
  COURIER_RATE_PARTNER_IDS,
  isCourierRatePartnerId,
  type BlueDartServiceId,
  type LogisticsCourierRates,
  type StCourierZone,
} from '../types/logistics-courier-rates';
import {
  inferLogisticsDestinationRegion,
  resolveDeliveryPartnersForRoute,
} from './logisticsDeliveryRules';
import type { InventorySite } from './salesOrderSegments';
import { inventorySiteLabel } from './salesOrderSegments';
import { inferStCourierZone, type StCourierDestination } from './stCourierZone';

export const PICKUP_PARTNER_ID: LogisticsPartnerId = 'personal_collection';

const PARTNER_TO_FREIGHT_SKU: Partial<Record<LogisticsPartnerId, FreightLineSku>> = {
  st_courier: 'STFRC',
  trackon: 'TRFRC',
  delhivery: 'DELFRC',
  /** Default Blue Dart service for freight lines (Surface). */
  bluedart: 'BDFRC',
};

export function freightSkuForBlueDartService(service: BlueDartServiceId): FreightLineSku {
  return BLUE_DART_SERVICE_META[service].sku;
}

export function blueDartServiceForFreightSku(sku: string | null | undefined): BlueDartServiceId | null {
  const value = String(sku ?? '').trim().toUpperCase();
  if (!value) return null;
  return BLUE_DART_SERVICE_IDS.find(id => BLUE_DART_SERVICE_META[id].sku === value) ?? null;
}

export function freightSkuForPartner(partnerId: LogisticsPartnerId): FreightLineSku | null {
  return PARTNER_TO_FREIGHT_SKU[partnerId] ?? null;
}

export function partnerIdForFreightSku(sku: string | null | undefined): LogisticsPartnerId | null {
  const value = String(sku ?? '').trim().toUpperCase();
  if (!value) return null;
  if (blueDartServiceForFreightSku(value)) return 'bluedart';
  const hit = (Object.entries(PARTNER_TO_FREIGHT_SKU) as Array<[LogisticsPartnerId, FreightLineSku]>)
    .find(([, freightSku]) => freightSku === value);
  return hit?.[0] ?? null;
}

export function isPickupPartner(partnerId: LogisticsPartnerId | null | undefined): boolean {
  return partnerId === PICKUP_PARTNER_ID;
}

/** Whether this partner has a usable ₹/kg rate for the zone at this origin. */
export function partnerHasZoneRate(
  rates: LogisticsCourierRates,
  partnerId: LogisticsPartnerId,
  site: InventorySite,
  zone: StCourierZone,
): boolean {
  if (!isCourierRatePartnerId(partnerId)) return false;
  if (partnerId === 'bluedart') {
    return blueDartConfigHasAnyRate(rates.bluedart);
  }
  if (partnerId === 'st_courier') {
    const boxPerKg = rates.st_courier?.[site]?.zones?.[zone]?.boxPerKgInr;
    return typeof boxPerKg === 'number' && Number.isFinite(boxPerKg) && boxPerKg > 0;
  }
  const boxPerKg = rates[partnerId]?.zones?.[zone]?.boxPerKgInr;
  return typeof boxPerKg === 'number' && Number.isFinite(boxPerKg) && boxPerKg > 0;
}

/**
 * Partners that stay selectable with empty rate cards so staff/admin can enter
 * freight ₹ on the sales order until a tariff or API is wired.
 */
export function partnerAllowsManualFreightRate(partnerId: LogisticsPartnerId): boolean {
  return partnerId === 'delhivery';
}

export type OrderCourierOption = {
  partnerId: LogisticsPartnerId;
  label: string;
  freightSku: FreightLineSku | null;
  /** Preferred first from delivery rules. */
  preferred: boolean;
  /** Selectable (rates filled, or pickup). */
  enabled: boolean;
  disabledReason: string | null;
  /**
   * True when enabled without a zone ₹/kg — quote is ₹0 until staff enter freight.
   */
  manualRate?: boolean;
  /** Quoted freight ₹ for this partner at this ship-from (set by cart estimate). */
  estimatedTotalInr?: number;
};

/**
 * Partners for a ship-from site: delivery-rule list for destination, plus Customer Pickup always.
 * Default = first enabled preferred partner (rule order), else pickup.
 */
export function listOrderCourierOptions(input: {
  deliveryRules: LogisticsDeliveryRulesMatrix;
  site: InventorySite;
  destination: StCourierDestination | null | undefined;
  rates: LogisticsCourierRates;
  /** When true, spare-only site can use rate-card partners even if zone ₹/kg is 0. */
  spareOnly?: boolean;
}): { zone: StCourierZone | null; options: OrderCourierOption[]; defaultPartnerId: LogisticsPartnerId } {
  const zone = inferStCourierZone(input.destination);
  const region = inferLogisticsDestinationRegion(
    input.destination?.state ?? input.destination?.city ?? '',
  );
  const fromRules = zone
    ? resolveDeliveryPartnersForRoute(input.deliveryRules, region, input.site)
    : [];

  const ordered: LogisticsPartnerId[] = [];
  const seen = new Set<LogisticsPartnerId>();
  for (const id of fromRules) {
    if (!isLogisticsPartnerId(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  if (!seen.has(PICKUP_PARTNER_ID)) {
    ordered.push(PICKUP_PARTNER_ID);
  }

  const options: OrderCourierOption[] = ordered.map(partnerId => {
    const freightSku = freightSkuForPartner(partnerId);
    if (isPickupPartner(partnerId)) {
      return {
        partnerId,
        label: logisticsPartnerLabel(partnerId),
        freightSku: null,
        preferred: false,
        enabled: true,
        disabledReason: null,
      };
    }
    if (!isCourierRatePartnerId(partnerId)) {
      return {
        partnerId,
        label: logisticsPartnerLabel(partnerId),
        freightSku: freightSku ?? 'FRC',
        preferred: false,
        enabled: false,
        disabledReason: 'Rate card not set up',
      };
    }
    const hasRate = zone
      ? partnerHasZoneRate(input.rates, partnerId, input.site, zone)
      : false;
    const allowManual = partnerAllowsManualFreightRate(partnerId);
    if (hasRate || input.spareOnly || (allowManual && Boolean(zone))) {
      return {
        partnerId,
        label: logisticsPartnerLabel(partnerId),
        freightSku,
        preferred: false,
        enabled: true,
        disabledReason: null,
        manualRate: allowManual && !hasRate && !input.spareOnly,
      };
    }
    return {
      partnerId,
      label: logisticsPartnerLabel(partnerId),
      freightSku,
      preferred: false,
      enabled: false,
      disabledReason: zone
        ? `No ₹/kg rate for this destination from ${inventorySiteLabel(input.site)}`
        : 'Select a shipping address',
    };
  });

  // Fix preferred flag: first rule partner
  const preferredId = fromRules[0] && isLogisticsPartnerId(fromRules[0])
    ? fromRules[0]
    : PICKUP_PARTNER_ID;
  for (const opt of options) {
    opt.preferred = opt.partnerId === preferredId;
  }

  const defaultPartnerId = options.find(o => o.preferred && o.enabled)?.partnerId
    ?? options.find(o => o.enabled)?.partnerId
    ?? PICKUP_PARTNER_ID;

  return { zone, options, defaultPartnerId };
}

export function freightOptionMeta(sku: FreightLineSku) {
  return FREIGHT_LINE_OPTIONS.find(o => o.sku === sku) ?? null;
}

export { COURIER_RATE_PARTNER_IDS };
