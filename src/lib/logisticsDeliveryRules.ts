import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { isLogisticsPartnerId } from '../constants/logisticsPartners';
import {
  DEFAULT_LOGISTICS_DELIVERY_RULES,
  LOGISTICS_DESTINATION_REGIONS,
  emptyLogisticsDeliveryRules,
} from '../constants/logisticsDeliveryRules';
import type {
  LogisticsDeliveryRulesMatrix,
  LogisticsDestinationRegion,
} from '../types/logistics-delivery-rules';
import {
  STAFF_LOGISTICS_SITES,
  isStaffLogisticsSite,
  type StaffLogisticsSite,
} from '../types/staff-logistics';

function normalizePartnerList(value: unknown): LogisticsPartnerId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<LogisticsPartnerId>();
  const next: LogisticsPartnerId[] = [];
  for (const raw of value) {
    const id = String(raw ?? '').trim();
    if (!isLogisticsPartnerId(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function normalizeLogisticsDeliveryRules(
  raw: unknown,
): LogisticsDeliveryRulesMatrix {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_LOGISTICS_DELIVERY_RULES);
  }
  const data = raw as Record<string, unknown>;
  const base = emptyLogisticsDeliveryRules();
  for (const region of LOGISTICS_DESTINATION_REGIONS) {
    const regionRaw = data[region];
    if (!regionRaw || typeof regionRaw !== 'object') {
      base[region] = structuredClone(DEFAULT_LOGISTICS_DELIVERY_RULES[region]);
      continue;
    }
    const regionData = regionRaw as Record<string, unknown>;
    for (const site of STAFF_LOGISTICS_SITES) {
      const partners = normalizePartnerList(regionData[site]);
      base[region][site] = partners.length
        ? partners
        : [...DEFAULT_LOGISTICS_DELIVERY_RULES[region][site]];
    }
  }
  return base;
}

export function deliveryRulesEqual(
  a: LogisticsDeliveryRulesMatrix,
  b: LogisticsDeliveryRulesMatrix,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function resolveDeliveryPartnersForRoute(
  rules: LogisticsDeliveryRulesMatrix,
  region: LogisticsDestinationRegion,
  site: StaffLogisticsSite,
): LogisticsPartnerId[] {
  return [...(rules[region]?.[site] ?? [])];
}

/** Unique partners that appear anywhere in the delivery-rules matrix (preference order preserved). */
export function partnersUsedInDeliveryRules(
  rules: LogisticsDeliveryRulesMatrix,
): LogisticsPartnerId[] {
  const seen = new Set<LogisticsPartnerId>();
  const ordered: LogisticsPartnerId[] = [];
  for (const region of LOGISTICS_DESTINATION_REGIONS) {
    for (const site of STAFF_LOGISTICS_SITES) {
      for (const partner of rules[region]?.[site] ?? []) {
        if (seen.has(partner)) continue;
        seen.add(partner);
        ordered.push(partner);
      }
    }
  }
  return ordered;
}

/** Ship-from sites where this partner is assigned in at least one destination region. */
export function originsUsingPartnerInDeliveryRules(
  rules: LogisticsDeliveryRulesMatrix,
  partnerId: LogisticsPartnerId,
): StaffLogisticsSite[] {
  const sites: StaffLogisticsSite[] = [];
  for (const site of STAFF_LOGISTICS_SITES) {
    const used = LOGISTICS_DESTINATION_REGIONS.some(region => (
      (rules[region]?.[site] ?? []).includes(partnerId)
    ));
    if (used) sites.push(site);
  }
  return sites;
}

/** Partners assigned to a ship-from site across any destination (preference order preserved). */
export function partnersForOriginInDeliveryRules(
  rules: LogisticsDeliveryRulesMatrix,
  site: StaffLogisticsSite,
): LogisticsPartnerId[] {
  const seen = new Set<LogisticsPartnerId>();
  const ordered: LogisticsPartnerId[] = [];
  for (const region of LOGISTICS_DESTINATION_REGIONS) {
    for (const partner of rules[region]?.[site] ?? []) {
      if (seen.has(partner)) continue;
      seen.add(partner);
      ordered.push(partner);
    }
  }
  return ordered;
}

/** Sites that have at least one of the given partners in delivery rules. */
export function originsUsingAnyPartnerInDeliveryRules(
  rules: LogisticsDeliveryRulesMatrix,
  partnerIds: readonly LogisticsPartnerId[],
): StaffLogisticsSite[] {
  const allow = new Set(partnerIds);
  return STAFF_LOGISTICS_SITES.filter(site => (
    partnersForOriginInDeliveryRules(rules, site).some(id => allow.has(id))
  ));
}

/** Map dealer / address state text to a routing region bucket. */
export function inferLogisticsDestinationRegion(
  stateOrAddress: string | null | undefined,
): LogisticsDestinationRegion {
  const normalized = String(stateOrAddress ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'other_states';

  if (
    normalized === 'kerala'
    || normalized === 'kl'
    || normalized.includes('kerala')
  ) {
    return 'kerala';
  }

  if (
    normalized === 'tamil nadu'
    || normalized === 'tamilnadu'
    || normalized === 'tn'
    || normalized.includes('tamil nadu')
    || normalized.includes('tamilnadu')
  ) {
    return 'tamil_nadu';
  }

  return 'other_states';
}

export function inferLogisticsDestinationRegionFromDealer(
  dealer: {
    shippingAddress?: { state?: string | null } | null;
    billingAddress?: { state?: string | null } | null;
    destinationCity?: string | null;
  } | null | undefined,
): LogisticsDestinationRegion {
  const state = dealer?.shippingAddress?.state
    ?? dealer?.billingAddress?.state
    ?? dealer?.destinationCity
    ?? '';
  return inferLogisticsDestinationRegion(state);
}

export function isLogisticsDestinationRegion(value: string): value is LogisticsDestinationRegion {
  return LOGISTICS_DESTINATION_REGIONS.includes(value as LogisticsDestinationRegion);
}

export function patchDeliveryRuleCell(
  rules: LogisticsDeliveryRulesMatrix,
  region: LogisticsDestinationRegion,
  site: StaffLogisticsSite,
  partners: LogisticsPartnerId[],
): LogisticsDeliveryRulesMatrix {
  if (!isStaffLogisticsSite(site)) return rules;
  return {
    ...rules,
    [region]: {
      ...rules[region],
      [site]: normalizePartnerList(partners),
    },
  };
}
