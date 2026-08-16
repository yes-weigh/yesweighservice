/** Blue Dart pickup pincode we are authorized to originate from (live-tested). */
export const BLUE_DART_PICKUP_PIN_BY_SITE = Object.freeze({
  cochin: '683104',
  head_office: '682019',
});

export function blueDartPickupPinForSite(site) {
  const key = String(site || '').trim();
  return BLUE_DART_PICKUP_PIN_BY_SITE[key] || '';
}
