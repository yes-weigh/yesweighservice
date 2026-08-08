import type { StaffLogisticsSite } from '../types/staff-logistics';

export const LOGISTICS_SETTINGS_DOC_ID = 'logisticsSettings';

export const DEFAULT_STAFF_LOGISTICS_SITE: StaffLogisticsSite = 'cochin';

export type LogisticsBookingOfficeProvider = 'st_courier' | 'trackon' | 'delhivery';

/**
 * Courier booking office contact shown under tracking history so dealers can
 * call the origin branch office directly (not used as ship-from / label address).
 */
export const LOGISTICS_BRANCH_TRACKING_CONTACTS: Record<
  LogisticsBookingOfficeProvider,
  Record<StaffLogisticsSite, string>
> = {
  st_courier: {
    cochin: 'ST COURIER COK, NO 54294E, NORTH BLOCK, KUMARANASAN NAGAR, PH:6235059666',
    head_office: 'G & S ASSOCIATES, NEAR NORTH RAILWAY STATION, NORTH, PH:8891833725, PIN:682019',
  },
  trackon: {
    cochin: '',
    head_office: [
      'PHOENIX CARGO',
      'Kailas CC38/179, Karshaka Road, Elamkulam Village, Kanayannur, Eastern Entrance of South Railway Station, Cochin-16',
      'Pho: 9605148751',
    ].join('\n'),
  },
  delhivery: {
    cochin: '',
    head_office: '',
  },
};
