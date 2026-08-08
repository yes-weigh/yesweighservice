import type { LogisticsPartnerId } from '../constants/logisticsPartners';

/** Production host used for label QR / absolute track links. */
const APP_TRACK_ORIGIN = 'https://service.yesweigh.in';

/** Public tracking page URL when the partner exposes one. */
export function logisticsTrackingUrl(
  partnerId: LogisticsPartnerId | string,
  trackingNumber: string,
): string | null {
  const awb = trackingNumber.trim();
  const encoded = encodeURIComponent(awb);
  if (!encoded) return null;
  switch (partnerId) {
    case 'delhivery':
      // Prefer in-app B2B track proxy; official site remains a fallback link.
      return delhiveryAppTrackingUrl(awb);
    case 'bluedart':
    case 'bluedart_air':
    case 'bluedart_surface':
    case 'bluedart_domestic':
      return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${encoded}`;
    case 'dtdc':
      return `https://www.dtdc.in/tracking.asp?strCnno=${encoded}`;
    case 'trackon':
    case 'trackon_air':
    case 'trackon_surface':
      // Legacy t1.jsp 404s. Use our proxy that scrapes trackon.in multi-track.
      return trackonAppTrackingUrl(awb);
    case 'st_courier':
      // Old erpstcourier.com AWB page now 404s. Use our proxy that scrapes
      // https://www.stcourier.com/track/shipment and shows status.
      return stCourierAppTrackingUrl(awb);
    default:
      return null;
  }
}

/** Absolute app URL that auto-fetches ST Courier status for an AWB. */
export function stCourierAppTrackingUrl(awb: string, origin?: string): string {
  const value = encodeURIComponent(String(awb ?? '').trim());
  const base = (origin || APP_TRACK_ORIGIN).replace(/\/$/, '');
  return `${base}/track/st-courier?awb=${value}`;
}

/** Absolute app URL that auto-fetches Trackon status for an AWB. */
export function trackonAppTrackingUrl(awb: string, origin?: string): string {
  const value = encodeURIComponent(String(awb ?? '').trim());
  const base = (origin || APP_TRACK_ORIGIN).replace(/\/$/, '');
  return `${base}/track/trackon?awb=${value}`;
}

/** Official ST Courier track form (manual entry). */
export function stCourierOfficialTrackingUrl(): string {
  return 'https://www.stcourier.com/track/shipment';
}

/** Official Trackon track form (manual entry). */
export function trackonOfficialTrackingUrl(): string {
  return 'https://www.trackon.in/courier-tracking';
}

/** Absolute app URL that fetches Delhivery B2B status for an LRN. */
export function delhiveryAppTrackingUrl(awb: string, origin?: string): string {
  const value = encodeURIComponent(String(awb ?? '').trim());
  const base = (origin || APP_TRACK_ORIGIN).replace(/\/$/, '');
  return `${base}/track/delhivery?awb=${value}`;
}

/** Official Delhivery package track page. */
export function delhiveryOfficialTrackingUrl(awb?: string): string {
  const value = String(awb ?? '').trim();
  if (!value) return 'https://www.delhivery.com/tracking';
  return `https://www.delhivery.com/track/package/${encodeURIComponent(value)}`;
}
