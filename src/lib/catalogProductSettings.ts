import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CATALOG_PRODUCT_SETTINGS_DOC_ID,
  DEFAULT_MASTER_CARTON_QUANTITIES,
} from '../constants/catalogProductSettings';

export interface CatalogProductSettings {
  masterCartonQuantities: number[];
  updatedAt: string;
  updatedBy?: string | null;
}

function normalizeQuantities(values: unknown): number[] {
  if (!Array.isArray(values)) return [...DEFAULT_MASTER_CARTON_QUANTITIES];
  const next = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && Number.isInteger(value) && value > 0);
  return [...new Set(next)].sort((a, b) => a - b);
}

export async function loadCatalogProductSettings(): Promise<CatalogProductSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID));
    if (!snap.exists()) {
      return {
        masterCartonQuantities: [...DEFAULT_MASTER_CARTON_QUANTITIES],
        updatedAt: '',
      };
    }
    const data = snap.data();
    const quantities = normalizeQuantities(data.masterCartonQuantities);
    return {
      masterCartonQuantities: quantities.length
        ? quantities
        : [...DEFAULT_MASTER_CARTON_QUANTITIES],
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return {
      masterCartonQuantities: [...DEFAULT_MASTER_CARTON_QUANTITIES],
      updatedAt: '',
    };
  }
}

export async function loadMasterCartonQuantities(): Promise<number[]> {
  const settings = await loadCatalogProductSettings();
  return settings.masterCartonQuantities;
}

export async function saveMasterCartonQuantities(
  quantities: number[],
  updatedBy?: string | null,
): Promise<number[]> {
  const masterCartonQuantities = normalizeQuantities(quantities);
  if (!masterCartonQuantities.length) {
    throw new Error('Add at least one master carton quantity.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID),
    {
      masterCartonQuantities,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return masterCartonQuantities;
}
