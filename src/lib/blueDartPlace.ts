import type { BlueDartRegion } from '../types/blue-dart-rates';
import { isBlueDartRegion } from '../types/blue-dart-rates';

/** Normalize state/city strings for Blue Dart region / RAS lookup. */
export function normalizeBlueDartPlace(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveBlueDartRegion(
  state: string | null | undefined,
  regionsByState: Record<string, BlueDartRegion>,
): BlueDartRegion | null {
  const key = normalizeBlueDartPlace(state);
  if (!key) return null;
  const direct = regionsByState[key];
  if (direct && isBlueDartRegion(direct)) return direct;

  // Substring fallback for truncated Excel states (e.g. "UTTAR PRADE").
  for (const [name, region] of Object.entries(regionsByState)) {
    if (!isBlueDartRegion(region)) continue;
    if (key.includes(name) || name.includes(key)) return region;
  }
  return null;
}

export function isRasDestination(
  state: string | null | undefined,
  rasStates: string[],
): boolean {
  const key = normalizeBlueDartPlace(state);
  if (!key) return false;
  return rasStates.some((raw) => {
    const ras = normalizeBlueDartPlace(raw);
    return ras && (key === ras || key.includes(ras) || ras.includes(key));
  });
}

export function isKeralaState(state: string | null | undefined): boolean {
  const key = normalizeBlueDartPlace(state);
  return key === 'kerala' || key === 'kl' || key.includes('kerala');
}
