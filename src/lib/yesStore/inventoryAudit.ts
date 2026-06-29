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

export function groupUsesBundleMode(items: YesStoreItemDoc[]): boolean {
  return items.some(item => readLinkMode(item) === 'part');
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
