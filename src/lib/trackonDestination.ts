import type {
  TrackonDestinationId,
  TrackonNorthDestinationId,
  TrackonServiceId,
  TrackonSouthDestinationId,
  TrackonSurfaceNorthDestinationId,
} from '../types/trackon-rates';
import {
  TRACKON_NORTH_DESTINATION_IDS,
  TRACKON_SOUTH_DESTINATION_IDS,
  TRACKON_SURFACE_NORTH_DESTINATION_IDS,
} from '../types/trackon-rates';
import type { StCourierDestination } from './stCourierZone';

function normalizePlace(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HILLY_KERALA = ['wayanad', 'idukki', 'kasargod', 'kasaragod'];

function isHillyKerala(city: string, state: string): boolean {
  const hay = `${city} ${state}`;
  return HILLY_KERALA.some(token => hay.includes(token));
}

function isKerala(state: string, city: string): boolean {
  return state === 'kerala'
    || state === 'kl'
    || state.includes('kerala')
    || city.includes('kochi')
    || city.includes('cochin')
    || city.includes('trivandrum')
    || city.includes('thiruvananthapuram')
    || city.includes('calicut')
    || city.includes('kozhikode')
    || city.includes('thrissur')
    || city.includes('kottayam');
}

function isTamilNadu(state: string): boolean {
  return state === 'tamil nadu'
    || state === 'tamilnadu'
    || state === 'tn'
    || state.includes('tamil nadu')
    || state.includes('tamilnadu')
    || state === 'puducherry'
    || state === 'pondicherry'
    || state === 'pondy'
    || state === 'py'
    || state.includes('puducherry')
    || state.includes('pondicherry');
}

function isKarnataka(state: string): boolean {
  return state === 'karnataka'
    || state === 'ka'
    || state.includes('karnataka');
}

function isAndhra(state: string): boolean {
  return state === 'andhra pradesh'
    || state === 'andhra'
    || state === 'ap'
    || state.includes('andhra')
    || state === 'telangana'
    || state === 'ts'
    || state.includes('telangana');
}

function isDelhi(state: string, city: string): boolean {
  return state === 'delhi'
    || state === 'nct of delhi'
    || state.includes('delhi')
    || city === 'delhi'
    || city === 'new delhi'
    || city.includes('new delhi');
}

function isMumbai(city: string): boolean {
  return city === 'mumbai'
    || city === 'bombay'
    || city.includes('mumbai')
    || city.includes('navi mumbai')
    || city.includes('thane');
}

function isKolkata(state: string, city: string): boolean {
  return city === 'kolkata'
    || city === 'calcutta'
    || city.includes('kolkata')
    || state === 'west bengal'
    || state === 'wb'
    || state.includes('west bengal');
}

function isSouthState(state: string, city: string): boolean {
  return isKerala(state, city)
    || isTamilNadu(state)
    || isKarnataka(state);
}

/**
 * Map shipping address → Trackon tariff station.
 * City beats state for metros / named southern stations.
 */
export function resolveTrackonDestination(
  destination: StCourierDestination | null | undefined,
): TrackonDestinationId | null {
  const state = normalizePlace(destination?.state);
  const city = normalizePlace(destination?.city);
  if (!state && !city) return null;

  if (isKerala(state, city)) {
    return isHillyKerala(city, state) ? 'kerala_hilly' : 'kerala';
  }

  if (city.includes('chennai') || city.includes('madras')) return 'chennai';
  if (
    city.includes('bangalore')
    || city.includes('bengaluru')
    || city.includes('bengalooru')
  ) {
    return 'bangalore';
  }
  if (city.includes('coimbatore')) return 'coimbatore';
  if (city === 'salem' || city.startsWith('salem ')) return 'salem';

  if (isTamilNadu(state)) return 'tamil_nadu';
  if (isKarnataka(state)) return 'karnataka';

  if (isMumbai(city)) return 'mumbai';
  if (isDelhi(state, city)) return 'delhi';
  if (isAndhra(state)) return 'andhra_pradesh';
  if (isKolkata(state, city)) return 'kolkata';

  if (isSouthState(state, city)) return 'tamil_nadu';
  return 'northern_sectors';
}

export function isTrackonNorthDestination(
  id: TrackonDestinationId,
): id is TrackonNorthDestinationId {
  return (TRACKON_NORTH_DESTINATION_IDS as readonly string[]).includes(id);
}

export function isTrackonSouthDestination(
  id: TrackonDestinationId,
): id is TrackonSouthDestinationId {
  return (TRACKON_SOUTH_DESTINATION_IDS as readonly string[]).includes(id);
}

export function isTrackonSurfaceNorthDestination(
  id: TrackonDestinationId,
): id is TrackonSurfaceNorthDestinationId {
  return (TRACKON_SURFACE_NORTH_DESTINATION_IDS as readonly string[]).includes(id);
}

/**
 * Surface northern ₹/kg station for a resolved north destination.
 * Kolkata is air-only — surface bills under Northern Sectors.
 */
export function resolveTrackonSurfaceNorthStation(
  destinationId: TrackonNorthDestinationId,
): TrackonSurfaceNorthDestinationId {
  if (destinationId === 'kolkata') return 'northern_sectors';
  return destinationId;
}

/** Air card only lists northern stations. */
export function trackonDestinationSupportsService(
  destinationId: TrackonDestinationId,
  service: TrackonServiceId,
): boolean {
  if (service === 'air') return isTrackonNorthDestination(destinationId);
  return true;
}
