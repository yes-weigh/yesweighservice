/**
 * Blue Dart zone helpers.
 * Air/Surface zones come from shared.zoneMatrix (Firestore).
 * DP A1 is HARDCODED: destination Kerala + origin Kerala → A1 (rate sheet
 * "Within Kerala"); otherwise use pin.dpZone from blueDartPincodes.
 */
import type {
  BlueDartAirZone,
  BlueDartDpZone,
  BlueDartPincodeDoc,
  BlueDartRegion,
  BlueDartSharedRules,
} from '../types/blue-dart-rates';
import {
  BLUE_DART_AIR_ZONES,
  BLUE_DART_REGIONS,
  isBlueDartAirZone,
  isBlueDartDpZone,
} from '../types/blue-dart-rates';
import { isKeralaState, resolveBlueDartRegion } from './blueDartPlace';

/** Canonical state labels per Blue Dart region (for Settings zone tables). */
const BLUE_DART_REGION_STATE_LABELS: Record<BlueDartRegion, readonly string[]> = {
  NORTH: [
    'Himachal Pradesh',
    'Punjab',
    'Haryana',
    'Uttarakhand',
    'Uttar Pradesh',
    'Rajasthan',
    'Delhi',
    'Chandigarh',
  ],
  EAST: ['Bihar', 'Odisha', 'West Bengal', 'Jharkhand'],
  WEST: [
    'Maharashtra',
    'Madhya Pradesh',
    'Gujarat',
    'Chhattisgarh',
    'Goa',
    'Daman & Diu',
    'Dadra & Nagar Haveli',
  ],
  SOUTH: [
    'Karnataka',
    'Tamil Nadu',
    'Kerala',
    'Andhra Pradesh',
    'Telangana',
    'Puducherry',
  ],
  NE: [
    'Assam',
    'Meghalaya',
    'Manipur',
    'Mizoram',
    'Nagaland',
    'Tripura',
    'Arunachal Pradesh',
    'Sikkim',
  ],
  JK: ['Jammu & Kashmir', 'Ladakh'],
};

export function resolveBlueDartAirZone(input: {
  shared: BlueDartSharedRules;
  destState: string | null | undefined;
  originRegion?: BlueDartRegion | null;
}): BlueDartAirZone | null {
  const destRegion = resolveBlueDartRegion(input.destState, input.shared.regionsByState);
  if (!destRegion) return null;
  const origin = input.originRegion && input.originRegion in input.shared.zoneMatrix
    ? input.originRegion
    : input.shared.originRegion;
  const zone = input.shared.zoneMatrix[origin]?.[destRegion];
  return isBlueDartAirZone(zone) ? zone : null;
}

/**
 * Destination states (by region) for each Air/Surface zone, using ship-from
 * `shared.originRegion` × `shared.zoneMatrix`.
 */
export function blueDartStatesByAirZone(
  shared: BlueDartSharedRules,
): Record<BlueDartAirZone, string[]> {
  const row = shared.zoneMatrix.SOUTH;

  const byZone: Record<BlueDartAirZone, string[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  };
  for (const region of BLUE_DART_REGIONS) {
    const zone = row?.[region];
    if (!isBlueDartAirZone(zone)) continue;
    for (const state of BLUE_DART_REGION_STATE_LABELS[region]) {
      if (!byZone[zone].includes(state)) byZone[zone].push(state);
    }
  }
  for (const zone of BLUE_DART_AIR_ZONES) {
    byZone[zone].sort((a, b) => a.localeCompare(b));
  }
  return byZone;
}

/**
 * DP zone: Within Kerala (origin SOUTH + dest Kerala) → A1;
 * else pin DP_ZONE A/B/C.
 */
export function resolveBlueDartDpZone(input: {
  destState: string | null | undefined;
  pin: BlueDartPincodeDoc | null | undefined;
  originIsKerala?: boolean;
}): BlueDartDpZone | null {
  const originKerala = input.originIsKerala !== false;
  if (originKerala && isKeralaState(input.destState)) return 'A1';
  const raw = String(input.pin?.dpZone ?? '').trim().toUpperCase();
  if (raw === 'A' || raw === 'B' || raw === 'C') return raw;
  if (isBlueDartDpZone(raw)) return raw;
  return null;
}
