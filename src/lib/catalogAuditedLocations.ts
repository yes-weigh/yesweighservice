import {
  formatItemLocationShort,
  type YesStoreItemDoc,
} from '../types/yes-store';
import {
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
} from '../types/catalog-site-inventory';

/** Compact audited location label for product browse cards (admin/staff). */
export function buildAuditedLocationByProductId(
  auditItems: YesStoreItemDoc[],
  cochinInventory: CatalogSiteInventoryDoc[],
): Map<string, string> {
  const map = new Map<string, string>();

  // Prefer Cochin warehouse zone/row for products that have site inventory.
  for (const record of cochinInventory) {
    const productId = record.catalogProductId?.trim();
    if (!productId || map.has(productId)) continue;
    const locations = getCatalogSiteInventoryLocations(record);
    if (locations.length === 0) continue;
    const primary = [...locations].sort((a, b) => b.quantity - a.quantity)[0];
    if (!primary) continue;
    map.set(
      productId,
      `${primary.zoneId.trim().toUpperCase()} · ${primary.zoneRowNumber}`,
    );
  }

  // Head Office store room: rack · row · bin (first linked bin if multiple).
  const headOffice = new Map<string, YesStoreItemDoc>();
  for (const item of auditItems) {
    const productId = item.catalogProductId?.trim();
    if (!productId || map.has(productId) || headOffice.has(productId)) continue;
    headOffice.set(productId, item);
  }
  for (const [productId, item] of headOffice) {
    map.set(
      productId,
      formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber),
    );
  }

  return map;
}
