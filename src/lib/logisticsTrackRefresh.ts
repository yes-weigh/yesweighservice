/**
 * Fresh track fetch for partners with in-app tracking (ST / Trackon / Delhivery).
 * Callables persist courierTrack (+ Delhivery freight when weight-captured) on the booking.
 */

import { isBlueDartLogisticsPartnerId, isTrackonLogisticsPartnerId } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { fetchBlueDartShipmentTrack } from './blueDartApi';
import { fetchDelhiveryShipmentTrack } from './delhiveryTrack';
import { fetchStCourierShipmentTrack } from './stCourierTrack';
import { fetchTrackonShipmentTrack } from './trackonTrack';

export function partnerSupportsTrackRefresh(partnerId: string | null | undefined): boolean {
  const id = String(partnerId || '');
  return id === 'st_courier'
    || id === 'delhivery'
    || isTrackonLogisticsPartnerId(id)
    || isBlueDartLogisticsPartnerId(id);
}

export type LogisticsTrackRefreshInput = {
  id: string;
  partnerId: LogisticsPartnerId | string;
  consignmentNo?: string | null;
  trackingNo?: string | null;
};

/**
 * Fetch live courier status for a booking and persist onto logisticsBookings.
 * No-op when partner has no track integration or AWB/LRN is missing.
 */
export async function refreshLogisticsBookingTrack(
  booking: LogisticsTrackRefreshInput,
): Promise<boolean> {
  const bookingId = String(booking.id || '').trim();
  const partnerId = String(booking.partnerId || '');
  const awb = String(booking.consignmentNo || booking.trackingNo || '').trim();
  if (!bookingId || !awb || !partnerSupportsTrackRefresh(partnerId)) {
    return false;
  }

  if (partnerId === 'delhivery') {
    await fetchDelhiveryShipmentTrack(awb, { bookingId });
    return true;
  }
  if (isBlueDartLogisticsPartnerId(partnerId)) {
    await fetchBlueDartShipmentTrack({ awb, bookingId });
    return true;
  }
  if (isTrackonLogisticsPartnerId(partnerId)) {
    await fetchTrackonShipmentTrack(awb, { bookingId });
    return true;
  }
  if (partnerId === 'st_courier') {
    await fetchStCourierShipmentTrack(awb, { bookingId });
    return true;
  }
  return false;
}

/**
 * Best-effort refresh: create/link still succeeds if track fetch fails.
 */
export async function tryRefreshLogisticsBookingTrack(
  booking: LogisticsTrackRefreshInput,
): Promise<void> {
  try {
    await refreshLogisticsBookingTrack(booking);
  } catch (err) {
    console.warn(
      'refreshLogisticsBookingTrack failed',
      booking.id,
      booking.partnerId,
      err instanceof Error ? err.message : err,
    );
  }
}
