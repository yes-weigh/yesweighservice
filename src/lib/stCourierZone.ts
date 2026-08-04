import type { StCourierZone } from '../types/logistics-courier-rates';

export type StCourierDestination = {
  state?: string | null;
  city?: string | null;
  zip?: string | null;
};

function normalizePlace(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DELHI_CITY_RE = /\b(new delhi|delhi|noida|gurgaon|gurugram|ghaziabad|faridabad|ncr)\b/;
const MUMBAI_CITY_RE = /\b(mumbai|bombay|navi mumbai|thane|kalyan|panvel|vasai|virar)\b/;

/**
 * Map shipping address fields to an ST Courier rate-card zone.
 * City wins for Mumbai / Delhi; Pondy/Puducherry folds into tamil_nadu_pondy.
 */
export function inferStCourierZone(
  destination: StCourierDestination | null | undefined,
): StCourierZone | null {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);
  const combined = `${city} ${state}`.trim();

  if (!state && !city) return null;

  if (DELHI_CITY_RE.test(city) || DELHI_CITY_RE.test(combined)) return 'delhi';
  if (MUMBAI_CITY_RE.test(city) || MUMBAI_CITY_RE.test(combined)) return 'mumbai';

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
  ) {
    return 'tamil_nadu_pondy';
  }

  if (
    state === 'tamil nadu'
    || state === 'tamilnadu'
    || state === 'tn'
    || state.includes('tamil nadu')
    || state.includes('tamilnadu')
  ) {
    return 'tamil_nadu_pondy';
  }

  if (
    state === 'karnataka'
    || state === 'ka'
    || state.includes('karnataka')
  ) {
    return 'karnataka';
  }

  if (
    state === 'andhra pradesh'
    || state === 'andhrapradesh'
    || state === 'ap'
    || state.includes('andhra')
    || state === 'telangana'
    || state === 'ts'
    || state.includes('telangana')
  ) {
    // Rate card has Andhra only; Telangana uses the same lane until a separate zone exists.
    return 'andhra_pradesh';
  }

  if (
    state === 'delhi'
    || state === 'dl'
    || state === 'nct of delhi'
    || state.includes('delhi')
  ) {
    return 'delhi';
  }

  if (
    state === 'maharashtra'
    || state === 'mh'
    || state.includes('maharashtra')
  ) {
    // Non-Mumbai Maharashtra → rest of India (Mumbai city already handled above).
    return 'rest_of_india';
  }

  if (!state && !city) return null;
  return 'rest_of_india';
}
