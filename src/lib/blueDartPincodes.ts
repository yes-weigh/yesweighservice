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

export function parseBlueDartPincodeDoc(
  pincode: string,
  data: Record<string, unknown> | undefined,
): BlueDartPincodeDoc | null {
  if (!data) return null;
  const dpZoneRaw = String(data.dpZone ?? '').trim().toUpperCase();
  const dpZone = dpZoneRaw === 'A' || dpZoneRaw === 'B' || dpZoneRaw === 'C'
    ? dpZoneRaw
    : '';
  const edlKmRaw = data.edlKm;
  const edlKm = typeof edlKmRaw === 'number' && Number.isFinite(edlKmRaw) && edlKmRaw > 0
    ? edlKmRaw
    : null;
  return {
    pincode,
    region: String(data.region ?? ''),
    state: String(data.state ?? ''),
    area: String(data.area ?? ''),
    areaDesc: String(data.areaDesc ?? ''),
    hubCode: String(data.hubCode ?? ''),
    dpService: parseServiceability(data.dpService),
    dpZone,
    apxService: parseServiceability(data.apxService),
    sfcService: parseServiceability(data.sfcService),
    edlApx: data.edlApx === true || String(data.edlApx).toLowerCase() === 'yes',
    edlSfc: data.edlSfc === true || String(data.edlSfc).toLowerCase() === 'yes',
    edlKm,
    apxLocIb: String(data.apxLocIb ?? ''),
    sfcLocIb: String(data.sfcLocIb ?? ''),
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
