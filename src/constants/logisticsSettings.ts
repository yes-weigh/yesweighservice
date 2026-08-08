import type { StaffLogisticsSite } from '../types/staff-logistics';

export const LOGISTICS_SETTINGS_DOC_ID = 'logisticsSettings';

export const DEFAULT_STAFF_LOGISTICS_SITE: StaffLogisticsSite = 'cochin';

/**
 * Local courier contact shown under tracking history so dealers can call the
 * branch office directly (not used as ship-from / label address).
 */
export const LOGISTICS_BRANCH_TRACKING_CONTACTS: Record<StaffLogisticsSite, string> = {
  cochin: 'ST COURIER COK, NO 54294E, NORTH BLOCK, KUMARANASAN NAGAR, PH:6235059666',
  head_office: 'G & S ASSOCIATES, NEAR NORTH RAILWAY STATION, NORTH, PH:8891833725, PIN:682019',
};
