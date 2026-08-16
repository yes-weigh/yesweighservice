import type { StaffLogisticsSite } from '../types/staff-logistics';
import { STAFF_LOGISTICS_SITES } from '../types/staff-logistics';

/** Blue Dart pickup pincode we are authorized to originate from (live-tested). */
export const BLUE_DART_PICKUP_PIN_BY_SITE: Record<StaffLogisticsSite, string> = {
  cochin: '683104',
  head_office: '682019',
};

export function blueDartPickupPinForSite(site: string | null | undefined): string {
  if (site && site in BLUE_DART_PICKUP_PIN_BY_SITE) {
    return BLUE_DART_PICKUP_PIN_BY_SITE[site as StaffLogisticsSite];
  }
  return '';
}

export function blueDartPickupPinEntries(): Array<{ site: StaffLogisticsSite; pin: string }> {
  return STAFF_LOGISTICS_SITES.map(site => ({
    site,
    pin: BLUE_DART_PICKUP_PIN_BY_SITE[site],
  }));
}

/** Keep the site address pin aligned with Blue Dart’s pickup pin. */
export function withBlueDartPickupPin(site: string | null | undefined, address: string): string {
  const pin = blueDartPickupPinForSite(site);
  const text = String(address || '');
  if (!pin || !text.trim()) return text;
  if (/\b\d{6}\b/.test(text)) return text.replace(/\b\d{6}\b/, pin);
  return `${text.trim()}\nPIN: ${pin}`;
}

export function withBlueDartPickupPins(
  addresses: Record<StaffLogisticsSite, string>,
): Record<StaffLogisticsSite, string> {
  return {
    cochin: withBlueDartPickupPin('cochin', addresses.cochin),
    head_office: withBlueDartPickupPin('head_office', addresses.head_office),
  };
}
