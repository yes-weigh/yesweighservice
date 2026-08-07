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
      return `https://www.delhivery.com/track/package/${encoded}`;
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
      return `https://trackon.in/Tracking/t1.jsp?txtAction=track&txtAWBNo=${encoded}`;
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

/** Official ST Courier track form (manual entry). */
export function stCourierOfficialTrackingUrl(): string {
  return 'https://www.stcourier.com/track/shipment';
}
