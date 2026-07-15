import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  CatalogInventorySite,
  CatalogSiteInventoryDoc,
  CatalogSiteInventoryLocationRow,
} from '../../types/catalog-site-inventory';
import { catalogSiteInventoryDocId } from '../../types/catalog-site-inventory';

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
