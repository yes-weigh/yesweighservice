import type { CatalogProduct } from '../../types/catalog';
import {
  formatItemLocationShort,
  readItemQuantity,
  type CatalogLinkMode,
  type YesStoreItemDoc,
} from '../../types/yes-store';

export interface InventoryAuditLinkInput {
  mode?: CatalogLinkMode;
  partLabel?: string | null;
  unitsPerProduct?: number;
}

export interface InventoryAuditPartBreakdown {
  itemId: string;
  location: string;
  partLabel: string;
  countedQty: number;
  unitsPerProduct: number;
  completeUnits: number;
  remainderQty: number;
  photos: YesStoreItemDoc['photos'];
}

export interface InventoryAuditGroupTotals {
  mode: 'unit' | 'bundle';
  /** Effective complete Zoho units (sum or bundle min). */
  countedQty: number;
  rawCountedQty: number;
  zohoQty: number | null;
  difference: number | null;
  parts: InventoryAuditPartBreakdown[];
}

export interface InventoryAuditLinkedGroup {
  catalogProductId: string;
  catalogProductName: string;
  catalogProductSku: string | null;
  items: YesStoreItemDoc[];
  totals: InventoryAuditGroupTotals;
  /** Warehouse count stamp (staff audit). */
  lastCountedAt: string | null;
  countedByName: string;
  /** Admin catalog link stamp. */
  linkedAt: string | null;
  linkedByName: string | null;
  linkedByUid: string | null;
}

export type InventoryAuditListRow =
  | { kind: 'item'; item: YesStoreItemDoc }
  | { kind: 'group'; group: InventoryAuditLinkedGroup };

function readLinkMode(item: YesStoreItemDoc): CatalogLinkMode {
  return item.catalogLinkMode === 'part' ? 'part' : 'unit';
}

function readUnitsPerProduct(item: YesStoreItemDoc): number {
  const value = item.unitsPerProduct;
  if (typeof value === 'number' && value > 0) return Math.floor(value);
  return 1;
}

function partLabelFor(item: YesStoreItemDoc): string {
  const label = item.partLabel?.trim();
  if (label) return label;
  return formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber);
}

/** @deprecated use readItemCountedAt — warehouse staff audit time */
export function readItemAuditedAt(item: YesStoreItemDoc): string | null {
  return readItemCountedAt(item);
}

/** @deprecated use readItemCountedByName — warehouse staff auditor */
export function readItemAuditedByName(item: YesStoreItemDoc): string | null {
  const name = item.countedByName?.trim();
  return name || null;
}

/** @deprecated use countedByUid */
export function readItemAuditedByUid(item: YesStoreItemDoc): string | null {
  return item.countedByUid?.trim() || null;
}

export function readItemLinkedAt(item: YesStoreItemDoc): string | null {
  return item.linkedAt?.trim() || null;
}

export function readItemLinkedByName(item: YesStoreItemDoc): string | null {
  return item.linkedByName?.trim() || null;
}

export function readItemLinkedByUid(item: YesStoreItemDoc): string | null {
  return item.linkedByUid?.trim() || null;
}

export function resolveGroupLinkInfo(items: YesStoreItemDoc[]): {
  linkedAt: string | null;
  linkedByName: string | null;
  linkedByUid: string | null;
} {
  let latest: YesStoreItemDoc | null = null;
  let latestTime = 0;

  for (const item of items) {
    const linkedAt = readItemLinkedAt(item);
    if (!linkedAt) continue;
    const time = new Date(linkedAt).getTime();
    if (Number.isNaN(time)) continue;
    if (!latest || time >= latestTime) {
      latest = item;
      latestTime = time;
    }
  }

  if (!latest) {
    return { linkedAt: null, linkedByName: null, linkedByUid: null };
  }

  return {
    linkedAt: readItemLinkedAt(latest),
    linkedByName: readItemLinkedByName(latest),
    linkedByUid: readItemLinkedByUid(latest),
  };
}

export function resolveAuditorDisplayName(
  name: string | null | undefined,
  uid: string | null | undefined,
  namesByUid?: Map<string, string>,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const resolvedUid = uid?.trim();
  if (resolvedUid && namesByUid?.has(resolvedUid)) {
    return namesByUid.get(resolvedUid) || '—';
  }
  return '—';
}

export function groupUsesBundleMode(items: YesStoreItemDoc[]): boolean {
  return items.some(item => readLinkMode(item) === 'part');
}

export function buildWarehouseLinkedProductIds(items: YesStoreItemDoc[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const productId = item.catalogProductId?.trim();
    if (productId) ids.add(productId);
  }
  return ids;
}

export function calculateGroupTotals(
  items: YesStoreItemDoc[],
  catalogProduct?: Pick<CatalogProduct, 'stock'> | null,
): InventoryAuditGroupTotals {
  const bundle = groupUsesBundleMode(items);

  if (!bundle) {
    const countedQty = items.reduce((sum, item) => sum + readItemQuantity(item), 0);
    const zohoQty = catalogProduct?.stock ?? null;
    const difference = zohoQty != null ? countedQty - zohoQty : null;
    return {
      mode: 'unit',
      countedQty,
      rawCountedQty: countedQty,
      zohoQty,
      difference,
      parts: items.map(item => {
        const qty = readItemQuantity(item);
        return {
          itemId: item.id,
          location: formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber),
          partLabel: partLabelFor(item),
          countedQty: qty,
          unitsPerProduct: 1,
          completeUnits: qty,
          remainderQty: 0,
          photos: item.photos ?? [],
        };
      }),
    };
  }

  const parts: InventoryAuditPartBreakdown[] = items.map(item => {
    const countedQty = readItemQuantity(item);
    const unitsPerProduct = readUnitsPerProduct(item);
    const completeUnits = Math.floor(countedQty / unitsPerProduct);
    const remainderQty = countedQty % unitsPerProduct;
    return {
      itemId: item.id,
      location: formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber),
      partLabel: partLabelFor(item),
      countedQty,
      unitsPerProduct,
      completeUnits,
      remainderQty,
      photos: item.photos ?? [],
    };
  });

  const completeFromParts = parts.map(part => part.completeUnits);
  const countedQty = completeFromParts.length
    ? Math.min(...completeFromParts)
    : 0;
  const rawCountedQty = parts.reduce((sum, part) => sum + part.countedQty, 0);
  const zohoQty = catalogProduct?.stock ?? null;
  const difference = zohoQty != null ? countedQty - zohoQty : null;

  return {
    mode: 'bundle',
    countedQty,
    rawCountedQty,
    zohoQty,
    difference,
    parts,
  };
}

export function buildInventoryAuditLinkedGroups(
  items: YesStoreItemDoc[],
  catalogById?: Map<string, CatalogProduct>,
): InventoryAuditLinkedGroup[] {
  const byProduct = new Map<string, YesStoreItemDoc[]>();

  for (const item of items) {
    const productId = item.catalogProductId?.trim();
    if (!productId) continue;
    const list = byProduct.get(productId) ?? [];
    list.push(item);
    byProduct.set(productId, list);
  }

  return [...byProduct.entries()]
    .map(([catalogProductId, groupItems]) => {
      const first = groupItems[0];
      const catalog = catalogById?.get(catalogProductId);
      const warehouseCount = resolveGroupWarehouseCount(groupItems);
      const linkInfo = resolveGroupLinkInfo(groupItems);
      return {
        catalogProductId,
        catalogProductName: first.catalogProductName?.trim() || catalog?.name || 'Linked item',
        catalogProductSku: first.catalogProductSku?.trim() || catalog?.sku || null,
        items: groupItems.sort((a, b) =>
          formatItemLocationShort(a.rackId, a.rowNumber, a.binNumber).localeCompare(
            formatItemLocationShort(b.rackId, b.rowNumber, b.binNumber),
          ),
        ),
        totals: calculateGroupTotals(groupItems, catalog),
        lastCountedAt: warehouseCount.lastCountedAt,
        countedByName: warehouseCount.countedByName,
        ...linkInfo,
      };
    })
    .sort((a, b) => a.catalogProductName.localeCompare(b.catalogProductName));
}

export function buildInventoryAuditListRows(
  items: YesStoreItemDoc[],
  filter: 'all' | 'linked' | 'unlinked',
  catalogById?: Map<string, CatalogProduct>,
): InventoryAuditListRow[] {
  const linkedGroups = buildInventoryAuditLinkedGroups(items, catalogById);
  const unlinked = items.filter(item => !item.catalogProductId?.trim());

  if (filter === 'linked') {
    return linkedGroups.map(group => ({ kind: 'group', group }));
  }

  if (filter === 'unlinked') {
    return unlinked.map(item => ({ kind: 'item', item }));
  }

  return [
    ...unlinked.map(item => ({ kind: 'item', item } as InventoryAuditListRow)),
    ...linkedGroups.map(group => ({ kind: 'group', group } as InventoryAuditListRow)),
  ];
}

export function formatQtyDifference(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return String(value);
  return '0';
}

export const DEFAULT_WAREHOUSE_COUNTED_BY_NAME = 'Diya';

export function readItemCountedAt(item: YesStoreItemDoc): string | null {
  const countedAt = item.countedAt?.trim();
  if (countedAt) return countedAt;
  return item.createdAt?.trim() || item.updatedAt?.trim() || null;
}

export function readItemCountedByName(item: YesStoreItemDoc): string {
  const name = item.countedByName?.trim();
  if (name) return name;
  return DEFAULT_WAREHOUSE_COUNTED_BY_NAME;
}

export function resolveGroupWarehouseCount(items: YesStoreItemDoc[]): {
  lastCountedAt: string | null;
  countedByName: string;
} {
  let latest: YesStoreItemDoc | null = null;
  let latestTime = 0;

  for (const item of items) {
    const countedAt = readItemCountedAt(item);
    if (!countedAt) continue;
    const time = new Date(countedAt).getTime();
    if (Number.isNaN(time)) continue;
    if (!latest || time >= latestTime) {
      latest = item;
      latestTime = time;
    }
  }

  if (!latest) {
    return { lastCountedAt: null, countedByName: DEFAULT_WAREHOUSE_COUNTED_BY_NAME };
  }

  return {
    lastCountedAt: readItemCountedAt(latest),
    countedByName: readItemCountedByName(latest),
  };
}

export function collectWarehouseAuditPhotoUrls(items: YesStoreItemDoc[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const photo of item.photos ?? []) {
      const url = photo.url?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
