import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  CatalogInventorySite,
  CatalogSiteInventoryDoc,
  CatalogSiteInventoryLocationRow,
} from '../../types/catalog-site-inventory';
import {
  catalogSiteInventoryDocId,
  getCatalogSiteInventoryLocations,
} from '../../types/catalog-site-inventory';

const now = () => new Date().toISOString();

function siteInventoryRef(catalogProductId: string, site: CatalogInventorySite) {
  return doc(db, 'catalogSiteInventory', catalogSiteInventoryDocId(catalogProductId, site));
}

function normalizeLocations(
  locations: CatalogSiteInventoryLocationRow[],
): CatalogSiteInventoryLocationRow[] {
  return locations
    .map(row => ({
      zoneId: row.zoneId.trim().toLowerCase(),
      zoneRowNumber: Math.max(1, Math.floor(row.zoneRowNumber)),
      quantity: Math.max(0, Math.floor(row.quantity)),
    }))
    .filter(row => row.zoneId && row.zoneRowNumber > 0);
}

export async function getCatalogSiteInventory(
  catalogProductId: string,
  site: CatalogInventorySite,
): Promise<CatalogSiteInventoryDoc | null> {
  const snap = await getDoc(siteInventoryRef(catalogProductId, site));
  if (!snap.exists()) return null;
  return snap.data() as CatalogSiteInventoryDoc;
}

/** All Cochin warehouse site-inventory records (for catalog audit filters). */
export async function listCochinSiteInventory(): Promise<CatalogSiteInventoryDoc[]> {
  const snap = await getDocs(
    query(collection(db, 'catalogSiteInventory'), where('site', '==', 'cochin')),
  );
  return snap.docs.map(d => d.data() as CatalogSiteInventoryDoc);
}

/** Head Office zero-stock / no-location audit records (spares without bins). */
export async function listHeadOfficeSiteInventory(): Promise<CatalogSiteInventoryDoc[]> {
  const snap = await getDocs(
    query(collection(db, 'catalogSiteInventory'), where('site', '==', 'head_office')),
  );
  return snap.docs.map(d => d.data() as CatalogSiteInventoryDoc);
}

export async function saveCatalogSiteInventory(input: {
  catalogProductId: string;
  site: CatalogInventorySite;
  locations: CatalogSiteInventoryLocationRow[];
  updatedByUid: string;
  updatedByName?: string | null;
}): Promise<CatalogSiteInventoryDoc> {
  const locations = normalizeLocations(input.locations);
  const quantity = locations.reduce((sum, row) => sum + row.quantity, 0);
  const first = locations[0] ?? null;

  const id = catalogSiteInventoryDocId(input.catalogProductId, input.site);
  const updatedAt = now();
  const docData: CatalogSiteInventoryDoc = {
    id,
    catalogProductId: input.catalogProductId,
    site: input.site,
    quantity,
    zoneId: first?.zoneId ?? null,
    zoneRowNumber: first?.zoneRowNumber ?? null,
    locations,
    updatedAt,
    updatedByUid: input.updatedByUid,
    updatedByName: input.updatedByName?.trim() || null,
  };
  await setDoc(siteInventoryRef(input.catalogProductId, input.site), docData);
  return docData;
}

function applyLocationDelta(
  locations: CatalogSiteInventoryLocationRow[],
  zoneId: string,
  zoneRowNumber: number,
  deltaQty: number,
): CatalogSiteInventoryLocationRow[] {
  if (!deltaQty) return locations;
  const zone = zoneId.trim().toLowerCase();
  const row = Math.max(1, Math.floor(zoneRowNumber));
  const next = locations.map(loc => ({ ...loc }));
  const idx = next.findIndex(loc => loc.zoneId === zone && loc.zoneRowNumber === row);
  if (idx >= 0) {
    next[idx] = {
      ...next[idx],
      quantity: Math.max(0, next[idx].quantity + deltaQty),
    };
  } else if (deltaQty > 0) {
    next.push({ zoneId: zone, zoneRowNumber: row, quantity: Math.floor(deltaQty) });
  }
  return next.filter(loc => loc.quantity > 0);
}

/**
 * Add/subtract bin qty in a transaction so two goods receipts cannot overwrite each other.
 */
export async function applyCatalogSiteInventoryDeltas(input: {
  catalogProductId: string;
  site: CatalogInventorySite;
  deltas: Array<{ zoneId: string; zoneRowNumber: number; quantityDelta: number }>;
  updatedByUid: string;
  updatedByName?: string | null;
}): Promise<CatalogSiteInventoryDoc> {
  const catalogProductId = String(input.catalogProductId || '').trim();
  const ref = siteInventoryRef(catalogProductId, input.site);
  const merged = new Map<string, { zoneId: string; zoneRowNumber: number; quantityDelta: number }>();
  for (const row of input.deltas) {
    const zoneId = String(row.zoneId ?? '').trim().toLowerCase();
    const zoneRowNumber = Math.max(1, Math.floor(Number(row.zoneRowNumber)));
    const quantityDelta = Math.trunc(Number(row.quantityDelta));
    if (!zoneId || !Number.isFinite(zoneRowNumber) || !Number.isFinite(quantityDelta) || !quantityDelta) {
      continue;
    }
    const key = `${zoneId}:${zoneRowNumber}`;
    const existing = merged.get(key);
    if (existing) existing.quantityDelta += quantityDelta;
    else merged.set(key, { zoneId, zoneRowNumber, quantityDelta });
  }
  const deltas = [...merged.values()].filter(row => row.quantityDelta !== 0);
  if (deltas.length === 0) {
    const current = await getCatalogSiteInventory(catalogProductId, input.site);
    if (current) return current;
    return saveCatalogSiteInventory({
      catalogProductId,
      site: input.site,
      locations: [],
      updatedByUid: input.updatedByUid,
      updatedByName: input.updatedByName,
    });
  }

  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() as CatalogSiteInventoryDoc : null;
    let locations = getCatalogSiteInventoryLocations(existing).map(row => ({ ...row }));
    for (const delta of deltas) {
      locations = applyLocationDelta(locations, delta.zoneId, delta.zoneRowNumber, delta.quantityDelta);
    }
    locations = normalizeLocations(locations).filter(row => row.quantity > 0);
    const quantity = locations.reduce((sum, row) => sum + row.quantity, 0);
    const first = locations[0] ?? null;
    const updatedAt = now();
    const docData: CatalogSiteInventoryDoc = {
      id: catalogSiteInventoryDocId(catalogProductId, input.site),
      catalogProductId,
      site: input.site,
      quantity,
      zoneId: first?.zoneId ?? null,
      zoneRowNumber: first?.zoneRowNumber ?? null,
      locations,
      updatedAt,
      updatedByUid: input.updatedByUid,
      updatedByName: input.updatedByName?.trim() || null,
    };
    transaction.set(ref, docData);
    return docData;
  });
}

/** Mark site audited with qty 0 and no locations. */
export async function markCatalogSiteNoStock(input: {
  catalogProductId: string;
  site: CatalogInventorySite;
  updatedByUid: string;
  updatedByName?: string | null;
}): Promise<CatalogSiteInventoryDoc> {
  return saveCatalogSiteInventory({
    catalogProductId: input.catalogProductId,
    site: input.site,
    locations: [],
    updatedByUid: input.updatedByUid,
    updatedByName: input.updatedByName,
  });
}

export async function deleteCatalogSiteInventory(
  catalogProductId: string,
  site: CatalogInventorySite,
): Promise<void> {
  await deleteDoc(siteInventoryRef(catalogProductId, site));
}
