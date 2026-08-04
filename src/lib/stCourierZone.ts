import {
  ST_COURIER_ZONE_LABELS,
  type StCourierZone,
} from '../types/logistics-courier-rates';

export type StCourierDestination = {
  state?: string | null;
  city?: string | null;
  zip?: string | null;
};

/** Append freight-plan override note to order remarks when zone differs from address. */
export function appendFreightZoneOverrideRemark(
  remarks: string,
  inferredZone: StCourierZone,
  selectedZone: StCourierZone,
  reason: string,
): string {
  if (inferredZone === selectedZone) return remarks.trim();
  const note = `Freight plan override: ${ST_COURIER_ZONE_LABELS[inferredZone]} → ${ST_COURIER_ZONE_LABELS[selectedZone]}. Reason: ${reason.trim()}`;
  const base = remarks.trim();
  return base ? `${base}\n${note}` : note;
}

function normalizePlace(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map shipping address fields to one of the 3 rate / delivery buckets.
 */
export function inferStCourierZone(
  destination: StCourierDestination | null | undefined,
): StCourierZone | null {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);

  if (!state && !city) return null;

  if (
    state === 'kerala'
    || state === 'kl'
    || state.includes('kerala')
  ) {
    return 'kerala';
  }

  if (
    state === 'puducherry'
    || state === 'pondicherry'
    || state === 'pondy'
    || state === 'py'
    || state.includes('puducherry')
    || state.includes('pondicherry')
    || city === 'puducherry'
    || city === 'pondicherry'
    || city.includes('pondicherry')
    || city.includes('puducherry')
    || state === 'tamil nadu'
    || state === 'tamilnadu'
    || state === 'tn'
    || state.includes('tamil nadu')
    || state.includes('tamilnadu')
  ) {
    return 'tamil_nadu_pondy';
  }

  return 'other_states';
}
