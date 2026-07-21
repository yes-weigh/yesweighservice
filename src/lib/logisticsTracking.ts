import type { LogisticsPartnerId } from '../constants/logisticsPartners';

/** Public tracking page URL when the partner exposes one. */
export function logisticsTrackingUrl(
  partnerId: LogisticsPartnerId | string,
  trackingNumber: string,
): string | null {
  const encoded = encodeURIComponent(trackingNumber.trim());
  if (!encoded) return null;
  switch (partnerId) {
    case 'delhivery':
      return `https://www.delhivery.com/track/package/${encoded}`;
    case 'bluedart':
      return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${encoded}`;
    case 'dtdc':
      return `https://www.dtdc.in/tracking.asp?strCnno=${encoded}`;
    case 'trackon':
      return `https://trackon.in/Tracking/t1.jsp?txtAction=track&txtAWBNo=${encoded}`;
    case 'st_courier':
      // Marketing site (?AwbNo=) does not auto-search; ERP page does (same as label QR).
      return `http://www.erpstcourier.com/awb_tracking2.php?keyword=${encoded}`;
    default:
      return null;
  }
}
