import type { StaffLogisticsSite } from '../types/staff-logistics';

/**
 * Exact Delhivery One pickup-location names used in B2B booking
 * (`pickup_location`). Names are unique and case-sensitive.
 */
export const DELHIVERY_DEFAULT_PICKUP_BY_SITE: Record<StaffLogisticsSite, string> = {
  cochin: 'INTERWEIGHING B2B',
  head_office: 'INTERWEIGHING VYTTILA',
};

/** Optional One portal facility UUIDs (reference only — booking uses the name). */
export const DELHIVERY_PICKUP_FACILITY_IDS: Record<string, string> = {
  'INTERWEIGHING B2B': '37bee93e-8d8d-4945-adfa-989228b424ae',
};
