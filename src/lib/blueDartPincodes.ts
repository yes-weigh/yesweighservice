/**
 * Load Blue Dart pin serviceability from Firestore `blueDartPincodes/{zip}`.
 * Populated by scripts/extract-bluedart-pincodes.py + seed-bluedart-rates.mjs
 * from the BdService workbook (DPSERVICE / APXSERVICE / SFCSERVICE / DP_ZONE).
 * Session-cached; not edited in Settings UI.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { BlueDartPincodeDoc, BlueDartServiceability } from '../types/blue-dart-rates';
import {
  BLUE_DART_PINCODES_COLLECTION,
  isBlueDartServiceability,
} from '../types/blue-dart-rates';

const cache = new Map<string, BlueDartPincodeDoc | null>();

export function normalizePincode(zip: string | null | undefined): string | null {
  const digits = String(zip ?? '').replace(/\D/g, '');
  if (digits.length !== 6) return null;
  return digits;
}

function parseServiceability(raw: unknown): BlueDartServiceability | string {
  const value = String(raw ?? '').trim();
  if (isBlueDartServiceability(value)) return value;
  return value || 'No';
}

/** Read a field by camelCase or Excel column alias (CPINCODE / DP_ZONE / …). */
function field(
  data: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

export function parseBlueDartPincodeDoc(
  pincode: string,
  data: Record<string, unknown> | undefined,
): BlueDartPincodeDoc | null {
  if (!data) return null;
  const dpZoneRaw = String(field(data, 'dpZone', 'DP_ZONE', 'dp_zone') ?? '')
    .trim()
    .toUpperCase();
  const dpZone = dpZoneRaw === 'A' || dpZoneRaw === 'B' || dpZoneRaw === 'C'
    ? dpZoneRaw
    : '';
  const edlKmRaw = field(data, 'edlKm', 'EDL_KM', 'edl_km');
  const edlKm = typeof edlKmRaw === 'number' && Number.isFinite(edlKmRaw) && edlKmRaw > 0
    ? edlKmRaw
    : null;
  const edlApxRaw = field(data, 'edlApx', 'EDL_APX', 'edl_apx');
  const edlSfcRaw = field(data, 'edlSfc', 'EDL_SFC', 'edl_sfc');
  return {
    pincode,
    region: String(field(data, 'region', 'CREGION', 'cregion') ?? ''),
    state: String(field(data, 'state', 'CSTATE', 'cstate') ?? ''),
    area: String(field(data, 'area', 'CAREA', 'carea') ?? ''),
    areaDesc: String(field(data, 'areaDesc', 'CAREADESC', 'careadesc') ?? ''),
    hubCode: String(field(data, 'hubCode', 'CSCRCD', 'cscrcd') ?? ''),
    dpService: parseServiceability(field(data, 'dpService', 'DPSERVICE', 'dpservice')),
    dpZone,
    apxService: parseServiceability(field(data, 'apxService', 'APXSERVICE', 'apxservice')),
    sfcService: parseServiceability(field(data, 'sfcService', 'SFCSERVICE', 'sfcservice')),
    edlApx: edlApxRaw === true || String(edlApxRaw ?? '').toLowerCase() === 'yes',
    edlSfc: edlSfcRaw === true || String(edlSfcRaw ?? '').toLowerCase() === 'yes',
    edlKm,
    apxLocIb: String(field(data, 'apxLocIb', 'APX_LOCIB', 'apx_locib') ?? ''),
    sfcLocIb: String(field(data, 'sfcLocIb', 'SFC_LOCIB', 'sfc_locib') ?? ''),
  };
}

export async function loadBlueDartPincode(
  zip: string | null | undefined,
): Promise<BlueDartPincodeDoc | null> {
  const pincode = normalizePincode(zip);
  if (!pincode) return null;
  if (cache.has(pincode)) return cache.get(pincode) ?? null;
  try {
    const snap = await getDoc(doc(db, BLUE_DART_PINCODES_COLLECTION, pincode));
    const parsed = snap.exists()
      ? parseBlueDartPincodeDoc(pincode, snap.data() as Record<string, unknown>)
      : null;
    cache.set(pincode, parsed);
    return parsed;
  } catch {
    cache.set(pincode, null);
    return null;
  }
}

export function clearBlueDartPincodeCache(): void {
  cache.clear();
}

/** City / area name from BdService CAREADESC (falls back to CAREA). */
export function blueDartCityNameFromPincodeDoc(
  doc: BlueDartPincodeDoc | null | undefined,
): string {
  const raw = String(doc?.areaDesc || doc?.area || '').trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .split(/[\s/,-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
