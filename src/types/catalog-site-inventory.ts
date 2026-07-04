export type CatalogInventorySite = 'cochin' | 'head_office';

export interface CatalogSiteInventoryLocationRow {
  zoneId: string;
  zoneRowNumber: number;
  quantity: number;
}

export interface CatalogSiteInventoryDoc {
  id: string;
  catalogProductId: string;
  site: CatalogInventorySite;
  quantity: number;
  zoneId: string | null;
  zoneRowNumber: number | null;
  locations?: CatalogSiteInventoryLocationRow[];
  updatedAt: string;
  updatedByUid: string | null;
  updatedByName: string | null;
}

export function catalogSiteInventoryDocId(
  catalogProductId: string,
  site: CatalogInventorySite,
): string {
  return `${catalogProductId}_${site}`;
}

export function getCatalogSiteInventoryLocations(
  doc: CatalogSiteInventoryDoc | null | undefined,
): CatalogSiteInventoryLocationRow[] {
  if (!doc) return [];
  if (doc.locations?.length) return doc.locations;
  if (doc.zoneId && doc.zoneRowNumber != null) {
    return [{
      zoneId: doc.zoneId,
      zoneRowNumber: doc.zoneRowNumber,
      quantity: doc.quantity,
    }];
  }
  return [];
}

export function catalogSiteInventoryTotalQuantity(
  doc: CatalogSiteInventoryDoc | null | undefined,
): number {
  const locations = getCatalogSiteInventoryLocations(doc);
  if (locations.length > 0) {
    return locations.reduce((sum, row) => sum + row.quantity, 0);
  }
  return doc?.quantity ?? 0;
}
