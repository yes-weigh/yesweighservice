import { LOGISTICS_PARTNER_IDS, type LogisticsPartnerId } from './logisticsPartners';
import type { LogisticsDeliveryRulesMatrix, LogisticsDestinationRegion } from '../types/logistics-delivery-rules';
import { STAFF_LOGISTICS_SITES } from '../types/staff-logistics';

export const LOGISTICS_DESTINATION_REGIONS = [
  'kerala',
  'tamil_nadu_pondy',
  'other_states',
] as const satisfies readonly LogisticsDestinationRegion[];

export const LOGISTICS_DESTINATION_REGION_LABELS: Record<LogisticsDestinationRegion, string> = {
  kerala: 'Kerala',
  tamil_nadu_pondy: 'Tamil Nadu, Pondy',
  other_states: 'Other states',
};

/** All partners that can be assigned in routing rules. */
export const CONFIGURABLE_DELIVERY_PARTNER_IDS = [...LOGISTICS_PARTNER_IDS];

/** Default routing matrix (matches current ops spreadsheet). */
export const DEFAULT_LOGISTICS_DELIVERY_RULES: LogisticsDeliveryRulesMatrix = {
  kerala: {
    cochin: ['st_courier', 'personal_collection'],
    head_office: ['st_courier', 'trackon_surface', 'personal_collection'],
  },
  tamil_nadu_pondy: {
    cochin: ['delhivery', 'st_courier'],
    head_office: ['st_courier', 'trackon_surface'],
  },
  other_states: {
    cochin: ['delhivery', 'st_courier'],
    head_office: ['trackon_air', 'trackon_surface'],
  },
};

/** Compact chip labels — full name in title tooltip. */
export const RULE_PARTNER_SHORT_LABELS: Record<LogisticsPartnerId, string> = {
  st_courier: 'ST',
  trackon_air: 'Trackon Air',
  trackon_surface: 'Trackon Surf',
  delhivery: 'Delhivery',
  bluedart_air: 'BD Air',
  bluedart_surface: 'BD Surface',
  bluedart_domestic: 'BD Domestic',
  dtdc: 'DTDC',
  ecosafe: 'Eco Safe',
  aps: 'APS',
  personal_collection: 'Pickup',
  own_vehicle: 'Own vehicle',
};

export function rulePartnerShortLabel(id: LogisticsPartnerId): string {
  return RULE_PARTNER_SHORT_LABELS[id] ?? id;
}

export function emptyLogisticsDeliveryRules(): LogisticsDeliveryRulesMatrix {
  const emptySite = (): Record<(typeof STAFF_LOGISTICS_SITES)[number], []> => ({
    cochin: [],
    head_office: [],
  });
  return {
    kerala: emptySite(),
    tamil_nadu_pondy: emptySite(),
    other_states: emptySite(),
  };
}
