import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { StaffLogisticsSite } from './staff-logistics';

/** Destination bucket for courier routing rules. */
export type LogisticsDestinationRegion = 'kerala' | 'tamil_nadu' | 'other_states';

/**
 * Ordered partner preferences per destination region and ship-from site.
 * First entry = primary partner, second = fallback, etc.
 */
export type LogisticsDeliveryRulesMatrix = Record<
  LogisticsDestinationRegion,
  Record<StaffLogisticsSite, LogisticsPartnerId[]>
>;
