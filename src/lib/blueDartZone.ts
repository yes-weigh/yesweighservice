import type {
  BlueDartAirZone,
  BlueDartDpZone,
  BlueDartPincodeDoc,
  BlueDartRegion,
  BlueDartSharedRules,
} from '../types/blue-dart-rates';
import { isBlueDartAirZone, isBlueDartDpZone } from '../types/blue-dart-rates';
import { isKeralaState, resolveBlueDartRegion } from './blueDartPlace';

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
