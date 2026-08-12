import { blueDartServiceHasRate } from '../constants/blueDartRates';
import { trackonServiceHasRate } from '../constants/trackonRates';
import type { FreightLineSku } from '../constants/freightLines';
import { FREIGHT_LINE_OPTIONS } from '../constants/freightLines';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
  logisticsPartnerLabel,
  partnerIdForBlueDartService,
  trackonServiceForPartner,
} from '../constants/logisticsPartners';
import {
  defaultLogisticsPartnerStatuses,
  partnerStatusAllowsManualFreight,
  partnerStatusSelectableOnSalesOrder,
} from '../constants/logisticsPartnerStatus';
import type { LogisticsDeliveryRulesMatrix } from '../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../types/logistics-partner-status';
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
import { inferStCourierZone, type StCourierDestination } from './stCourierZone';

export const PICKUP_PARTNER_ID: LogisticsPartnerId = 'personal_collection';

const PARTNER_TO_FREIGHT_SKU: Partial<Record<LogisticsPartnerId, FreightLineSku>> = {
  st_courier: 'STFRC',
  trackon_air: 'TRAIR',
  trackon_surface: 'TRFRC',
  delhivery: 'DELFRC',
  bluedart_air: 'BDAIR',
  bluedart_surface: 'BDFRC',
  bluedart_domestic: 'BDDP',
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
  const bdService = blueDartServiceForFreightSku(value);
  if (bdService) return partnerIdForBlueDartService(bdService);
  if (value === 'TRAIR') return 'trackon_air';
  if (value === 'TRFRC') return 'trackon_surface';
  const hit = (Object.entries(PARTNER_TO_FREIGHT_SKU) as Array<[LogisticsPartnerId, FreightLineSku]>)
    .find(([, freightSku]) => freightSku === value);
  return hit?.[0] ?? null;
}

export function isPickupPartner(partnerId: LogisticsPartnerId | null | undefined): boolean {
  return partnerId === PICKUP_PARTNER_ID;
}

/** Whether this partner has a usable rate for the destination at this origin. */
export function partnerHasZoneRate(
  rates: LogisticsCourierRates,
  partnerId: LogisticsPartnerId,
  site: InventorySite,
  zone: StCourierZone,
): boolean {
  if (isBlueDartLogisticsPartnerId(partnerId)) {
    const service = blueDartServiceForPartner(partnerId);
    return service ? blueDartServiceHasRate(rates.bluedart, service) : false;
  }
  if (isTrackonLogisticsPartnerId(partnerId)) {
    const service = trackonServiceForPartner(partnerId);
    return service ? trackonServiceHasRate(rates.trackon, service) : false;
  }
  if (!isCourierRatePartnerId(partnerId)) return false;
  if (partnerId === 'st_courier') {
    const boxPerKg = rates.st_courier?.[site]?.zones?.[zone]?.boxPerKgInr;
    return typeof boxPerKg === 'number' && Number.isFinite(boxPerKg) && boxPerKg > 0;
  }
  if (partnerId === 'delhivery') {
    // Legacy shared ₹/kg card (settings UI no longer edits it). Prefer live API.
    const boxPerKg = rates.delhivery?.zones?.[zone]?.boxPerKgInr;
    return typeof boxPerKg === 'number' && Number.isFinite(boxPerKg) && boxPerKg > 0;
  }
  return false;
}

/** Delhivery is offered on SO via live B2B estimate when destination zone is known. */
export function partnerUsesLiveApiFreight(partnerId: LogisticsPartnerId): boolean {
  return partnerId === 'delhivery';
}

/**
 * Partners with Manual status stay selectable with empty rate cards so staff
 * can enter freight ₹ on the sales order.
 */
export function partnerAllowsManualFreightRate(
  partnerId: LogisticsPartnerId,
  partnerStatuses?: LogisticsPartnerStatuses | null,
): boolean {
  const statuses = partnerStatuses ?? defaultLogisticsPartnerStatuses();
  return partnerStatusAllowsManualFreight(statuses[partnerId]);
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
  /**
   * Delhivery (and similar): priced via live partner API, not the unused ₹/kg card.
   * Client overlays estimate; create SO still sends amount as manualFreightAmountInr.
   */
  liveApiRate?: boolean;
  /** Quoted freight ₹ for this partner at this ship-from (set by cart estimate). */
  estimatedTotalInr?: number;
  /**
   * Delhivery split options: prepaid (BTC) vs to-pay (FOD).
   * Same partnerId; selection also sets freight billing mode.
   */
  freightBillingMode?: 'btc' | 'fod';
};

/** Unique key for courier radio options (Delhivery BTC/FOD share partnerId). */
export function orderCourierOptionKey(opt: Pick<OrderCourierOption, 'partnerId' | 'freightBillingMode'>): string {
  if (opt.partnerId === 'delhivery' && (opt.freightBillingMode === 'fod' || opt.freightBillingMode === 'btc')) {
    return `delhivery:${opt.freightBillingMode}`;
  }
  return String(opt.partnerId);
}

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
  /**
   * Active / Inactive / Manual map from logistics settings.
   * Inactive partners are omitted from SO options (still allowed in rules).
   */
  partnerStatuses?: LogisticsPartnerStatuses | null;
}): { zone: StCourierZone | null; options: OrderCourierOption[]; defaultPartnerId: LogisticsPartnerId } {
  const statuses = input.partnerStatuses ?? defaultLogisticsPartnerStatuses();
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
    if (!isPickupPartner(id) && !partnerStatusSelectableOnSalesOrder(statuses[id])) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }
  if (!seen.has(PICKUP_PARTNER_ID)) {
    ordered.push(PICKUP_PARTNER_ID);
  }

  /** Only offer partners that are selectable — hide rule/rate ineligible ones. */
  const options: OrderCourierOption[] = [];
  for (const partnerId of ordered) {
    const freightSku = freightSkuForPartner(partnerId);
    if (isPickupPartner(partnerId)) {
      options.push({
        partnerId,
        label: logisticsPartnerLabel(partnerId),
        freightSku: null,
        preferred: false,
        enabled: true,
        disabledReason: null,
      });
      continue;
    }
    const status = statuses[partnerId];
    const allowManual = partnerStatusAllowsManualFreight(status);
    const isRatePartner = isCourierRatePartnerId(partnerId)
      || isBlueDartLogisticsPartnerId(partnerId)
      || isTrackonLogisticsPartnerId(partnerId);
    if (!isRatePartner && !allowManual) {
      continue;
    }
    const hasRate = zone
      ? partnerHasZoneRate(input.rates, partnerId, input.site, zone)
      : false;
    const liveApi = partnerUsesLiveApiFreight(partnerId);
    if (hasRate || input.spareOnly || (allowManual && Boolean(zone)) || (liveApi && Boolean(zone))) {
      options.push({
        partnerId,
        label: logisticsPartnerLabel(partnerId),
        freightSku: freightSku ?? 'FRC',
        preferred: false,
        enabled: true,
        disabledReason: null,
        // Live API partners are quoted automatically — not staff-editable ₹.
        manualRate: (!hasRate && !input.spareOnly) && allowManual && !liveApi,
        liveApiRate: liveApi && !hasRate,
      });
    }
  }

  // Preferred = first rule partner that is still offered (active/manual).
  const preferredId = fromRules.find(id => (
    isLogisticsPartnerId(id)
    && (isPickupPartner(id) || partnerStatusSelectableOnSalesOrder(statuses[id]))
    && options.some(o => o.partnerId === id)
  )) ?? PICKUP_PARTNER_ID;
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
