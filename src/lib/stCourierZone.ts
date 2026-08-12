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

/** ST Courier — Tamil Nadu only (Kerala has no max; Pondy not under this cap). */
export const ST_COURIER_TAMIL_NADU_MAX_CHARGEABLE_KG = 25;

function isPondicherryPlace(text: string): boolean {
  return text === 'puducherry'
    || text === 'pondicherry'
    || text === 'pondy'
    || text === 'py'
    || text.includes('puducherry')
    || text.includes('pondicherry');
}

function isKeralaPlace(text: string): boolean {
  return text === 'kerala'
    || text === 'kl'
    || text.includes('kerala');
}

/** True when destination is Tamil Nadu (not Kerala, not Pondicherry). */
export function isTamilNaduDestination(
  destination: StCourierDestination | string | null | undefined,
): boolean {
  const text = typeof destination === 'string'
    ? normalizePlace(destination)
    : normalizePlace(
      [destination?.state, destination?.city].filter(Boolean).join(' '),
    );
  if (!text || isKeralaPlace(text) || isPondicherryPlace(text)) return false;
  return text === 'tamil nadu'
    || text === 'tamilnadu'
    || text === 'tn'
    || text.includes('tamil nadu')
    || text.includes('tamilnadu');
}

export function stCourierTamilNaduMaxChargeableExceeded(chargeableKg: number): boolean {
  const kg = typeof chargeableKg === 'number' && Number.isFinite(chargeableKg) ? chargeableKg : 0;
  return kg > ST_COURIER_TAMIL_NADU_MAX_CHARGEABLE_KG;
}

export function stCourierTamilNaduMaxChargeableReason(chargeableKg?: number): string {
  const kg = typeof chargeableKg === 'number' && Number.isFinite(chargeableKg) && chargeableKg > 0
    ? chargeableKg
    : null;
  return kg != null
    ? `Max ${ST_COURIER_TAMIL_NADU_MAX_CHARGEABLE_KG} kg for ST Courier to Tamil Nadu (chargeable ${kg} kg)`
    : `Max ${ST_COURIER_TAMIL_NADU_MAX_CHARGEABLE_KG} kg for ST Courier to Tamil Nadu`;
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
