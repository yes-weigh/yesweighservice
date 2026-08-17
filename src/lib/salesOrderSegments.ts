import type { InvoiceCategory } from '../types/invoices';
import {
  hasCatalogCategory,
  isGenericSparePartsCategory,
  isSoftwareKeysCategory,
} from './catalog';
import { isFreightProductId, isFreightSku } from '../constants/freightLines';
import { isFullSuperAdmin } from './staffAccess';
import { canUseCart, type Role, type User } from '../types';

export type OrderSegment = 'product' | 'spare' | 'software';
export type InventorySite = 'cochin' | 'head_office';

export const ORDER_SEGMENTS: OrderSegment[] = ['product', 'spare', 'software'];
export const INVENTORY_SITES: InventorySite[] = ['cochin', 'head_office'];

export const WAREHOUSE_NAME_COCHIN = 'Cochin';
export const WAREHOUSE_NAME_HEAD_OFFICE = 'Head Office';

export type SegmentSiteBucket<T> = {
  key: string;
  segment: OrderSegment;
  site: InventorySite;
  lines: T[];
};

export function isSoftwareSegmentCategoryName(name: string | null | undefined): boolean {
  const normalized = String(name ?? '').trim().toLowerCase();
  return normalized === 'software keys' || normalized === 'sanoft';
}

export function isFreightOrderLine(line: {
  productId?: string | null;
  sku?: string | null;
}): boolean {
  return isFreightProductId(line.productId) || isFreightSku(line.sku);
}

/**
 * Strict catalog segment for multi-SO split.
 * spare = generic spare parts + uncategorized (except freight)
 * software = software keys + sanoft
 * product = everything else
 * null = freight charge (attached to host segment on submit)
 */
export function classifyOrderLineSegment(line: {
  categoryId?: string | null;
  categoryName?: string | null;
  productId?: string | null;
  sku?: string | null;
}): OrderSegment | null {
  if (isFreightOrderLine(line)) return null;
  if (!hasCatalogCategory({ categoryId: line.categoryId ?? null })) {
    return 'spare';
  }
  if (line.categoryName && isGenericSparePartsCategory({ name: line.categoryName })) {
    return 'spare';
  }
  if (line.categoryName && isSoftwareSegmentCategoryName(line.categoryName)) {
    return 'software';
  }
  if (line.categoryName && isSoftwareKeysCategory({ name: line.categoryName })) {
    return 'software';
  }
  return 'product';
}

/** Map SO invoice category → order segment (create/submit stamp). */
export function orderSegmentFromInvoiceCategory(
  category: InvoiceCategory | null | undefined,
): OrderSegment | null {
  if (category === 'spare') return 'spare';
  if (category === 'software_key') return 'software';
  if (category === 'product') return 'product';
  return null;
}

/** Software keys skip ops review and open as Awaiting payment.
 * Directors price-level dealers skip review as well (see priceLevelSkipsOpsReview).
 */
export function segmentSkipsOpsReview(segment: OrderSegment | string | null | undefined): boolean {
  return segment === 'software';
}

export function parseInventorySite(value: unknown): InventorySite | null {
  const site = String(value ?? '').trim().toLowerCase();
  if (site === 'cochin' || site === 'head_office') return site;
  return null;
}

/**
 * Default site when SO has no yesOneInventorySite (legacy rows).
 * Matches empty-stock defaults in resolveLineInventorySite.
 */
export function defaultInventorySiteForSegment(segment: OrderSegment): InventorySite {
  if (segment === 'spare' || segment === 'software') return 'head_office';
  return 'cochin';
}

export function segmentLabel(segment: OrderSegment): string {
  if (segment === 'spare') return 'Spare';
  if (segment === 'software') return 'Software';
  return 'Product';
}

export function inventorySiteLabel(site: InventorySite): string {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}

function warehouseStock(
  warehouses: Array<{ warehouseName?: string; stock?: number }> | null | undefined,
  warehouseName: string,
): number {
  const target = warehouseName.trim().toLowerCase();
  if (!target || !warehouses?.length) return 0;
  const match = warehouses.find(
    row => String(row.warehouseName ?? '').trim().toLowerCase() === target,
  );
  const stock = Number(match?.stock ?? 0);
  return Number.isFinite(stock) ? stock : 0;
}

/**
 * Pick Cochin vs Head Office from Zoho warehouse stock.
 * Software always Head Office. Prefer higher positive stock; empty → segment default.
 */
export function resolveLineInventorySite(
  segment: OrderSegment | null,
  warehouses?: Array<{ warehouseName?: string; stock?: number }> | null,
): InventorySite {
  if (segment === 'software') return 'head_office';

  const cochinStock = warehouseStock(warehouses, WAREHOUSE_NAME_COCHIN);
  const headOfficeStock = warehouseStock(warehouses, WAREHOUSE_NAME_HEAD_OFFICE);

  if (cochinStock > 0 || headOfficeStock > 0) {
    if (cochinStock === headOfficeStock) {
      return segment === 'spare' ? 'head_office' : 'cochin';
    }
    return cochinStock > headOfficeStock ? 'cochin' : 'head_office';
  }

  return segment === 'spare' ? 'head_office' : 'cochin';
}

/**
 * Whether a catalog item may be carted onto an existing SO (add-line).
 * Freight is never catalog-carted here (auto freight). Must match segment × site
 * the same way create/submit would bucket the line.
 */
export function productMatchesSalesOrderBucket(
  product: {
    categoryId?: string | null;
    categoryName?: string | null;
    productId?: string | null;
    id?: string | null;
    sku?: string | null;
    warehouses?: Array<{ warehouseName?: string; stock?: number }> | null;
  },
  bucket: {
    segment: OrderSegment | null | undefined;
    site: InventorySite | null | undefined;
  },
): boolean {
  if (!bucket.segment) return false;
  const productId = product.productId ?? product.id ?? null;
  if (isFreightOrderLine({ productId, sku: product.sku })) return false;

  const segment = classifyOrderLineSegment({
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    productId,
    sku: product.sku,
  });
  if (segment !== bucket.segment) return false;

  // Spare SOs accept any spare part (not only Head Office stock / linked-to-product).
  if (segment === 'spare') return true;

  const site = bucket.site ?? defaultInventorySiteForSegment(bucket.segment);
  return resolveLineInventorySite(segment, product.warehouses) === site;
}

export function segmentSiteBucketKey(segment: OrderSegment, site: InventorySite): string {
  return `${segment}:${site}`;
}

export function segmentSiteLabel(segment: OrderSegment, site: InventorySite): string {
  if (segment === 'software') return 'Software · Head Office';
  return `${segmentLabel(segment)} · ${inventorySiteLabel(site)}`;
}

export function groupLinesBySegment<T extends {
  categoryId?: string | null;
  categoryName?: string | null;
  productId?: string | null;
  sku?: string | null;
}>(lines: T[]): Record<OrderSegment, T[]> {
  const groups: Record<OrderSegment, T[]> = {
    product: [],
    spare: [],
    software: [],
  };
  const freight: T[] = [];
  for (const line of lines) {
    const segment = classifyOrderLineSegment(line);
    if (!segment) {
      freight.push(line);
      continue;
    }
    groups[segment].push(line);
  }
  if (freight.length) {
    const host = (['product', 'spare'] as OrderSegment[]).find(segment => groups[segment].length > 0);
    if (host) groups[host].push(...freight);
  }
  return groups;
}

export function groupLinesBySegmentAndSite<T extends {
  categoryId?: string | null;
  categoryName?: string | null;
  productId?: string | null;
  sku?: string | null;
  warehouses?: Array<{ warehouseName?: string; stock?: number }> | null;
  /** When set on a freight line, attach to this inventory site. */
  freightInventorySite?: InventorySite | null;
  /** When set on a freight line, attach to this host segment. */
  freightHostSegment?: OrderSegment | null;
}>(lines: T[]): SegmentSiteBucket<T>[] {
  const buckets = new Map<string, SegmentSiteBucket<T>>();
  const freight: T[] = [];

  const ensureBucket = (segment: OrderSegment, site: InventorySite) => {
    const key = segmentSiteBucketKey(segment, site);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, segment, site, lines: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const line of lines) {
    const segment = classifyOrderLineSegment(line);
    if (!segment) {
      const hostSegment = line.freightHostSegment;
      const hostSite = line.freightInventorySite;
      if (
        (hostSegment === 'product' || hostSegment === 'spare')
        && (hostSite === 'cochin' || hostSite === 'head_office')
      ) {
        ensureBucket(hostSegment, hostSite).lines.push(line);
      } else {
        freight.push(line);
      }
      continue;
    }
    const site = resolveLineInventorySite(segment, line.warehouses);
    ensureBucket(segment, site).lines.push(line);
  }

  if (freight.length) {
    const hostOrder = [
      'product:cochin',
      'product:head_office',
      'spare:cochin',
      'spare:head_office',
    ] as const;
    const hostKey = hostOrder.find(key => (buckets.get(key)?.lines.length ?? 0) > 0);
    if (hostKey) buckets.get(hostKey)!.lines.push(...freight);
  }

  const order = [
    'product:cochin',
    'product:head_office',
    'spare:cochin',
    'spare:head_office',
    'software:head_office',
    'software:cochin',
  ] as const;
  const ordered: SegmentSiteBucket<T>[] = [];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (bucket?.lines.length) ordered.push(bucket);
  }
  for (const [key, bucket] of buckets) {
    if (!(order as readonly string[]).includes(key) && bucket.lines.length) {
      ordered.push(bucket);
    }
  }
  return ordered;
}

/** Freight attaches to product or spare only — never software. */
export function segmentAllowsFreight(segment: OrderSegment | null | undefined): boolean {
  return segment === 'product' || segment === 'spare';
}

export function summarizeSegments(lines: Array<{
  categoryId?: string | null;
  categoryName?: string | null;
  productId?: string | null;
  sku?: string | null;
}>): OrderSegment[] {
  const groups = groupLinesBySegment(lines);
  return ORDER_SEGMENTS.filter(segment => {
    // Count only non-freight for preview messaging — freight is attached to host.
    return groups[segment].some(line => !isFreightOrderLine(line));
  });
}

/** Preview buckets for multi-SO checkout (type × location). */
export function summarizeSegmentSiteBuckets(lines: Array<{
  categoryId?: string | null;
  categoryName?: string | null;
  productId?: string | null;
  sku?: string | null;
  warehouses?: Array<{ warehouseName?: string; stock?: number }> | null;
}>): Array<{ segment: OrderSegment; site: InventorySite; label: string }> {
  return groupLinesBySegmentAndSite(lines)
    .filter(bucket => bucket.lines.some(line => !isFreightOrderLine(line)))
    .map(bucket => ({
      segment: bucket.segment,
      site: bucket.site,
      label: segmentSiteLabel(bucket.segment, bucket.site),
    }));
}

/** Dealer / dealer_staff can add any segment (canBuySpares enforced on submit). */
export function isDealerCartRole(role: Role | undefined | null): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}

/**
 * Staff/super-admin create path: which segments may be added.
 * Full SA: all. Spare Incharge (non-SA): spare only.
 * Other sales staff: product + spare + software (submit splits; spare → Spare Incharge SP).
 */
export function staffCanAddOrderSegment(
  user: User | null | undefined,
  segment: OrderSegment,
): boolean {
  if (!user) return false;
  if (isDealerCartRole(user.role)) return true;
  if (isFullSuperAdmin(user)) return true;
  if (user.spareIncharge === true) return segment === 'spare';
  return segment === 'product' || segment === 'spare' || segment === 'software';
}

export function catalogProductAllowedForUser(
  user: User | null | undefined,
  product: {
    categoryId?: string | null;
    categoryName?: string | null;
    productId?: string | null;
    id?: string | null;
    sku?: string | null;
  },
): boolean {
  if (isDealerCartRole(user?.role)) return true;
  if (isFreightOrderLine({ productId: product.productId ?? product.id, sku: product.sku })) {
    return true;
  }
  const segment = classifyOrderLineSegment(product);
  if (!segment) return true;
  return staffCanAddOrderSegment(user, segment);
}

/** Segments the signed-in staff/SA may shop in the create-SO catalog. */
export function staffAllowedOrderSegments(user: User | null | undefined): OrderSegment[] {
  return ORDER_SEGMENTS.filter(segment => staffCanAddOrderSegment(user, segment));
}

/**
 * Normal catalog cart — dealers only.
 * Staff/SA shop via the multi-stage create-SO flow, not the main catalog.
 */
export function canUseOrderCart(user: User | null | undefined): boolean {
  if (!user) return false;
  return canUseCart(user.role);
}

/** Show add-to-cart control for this product for the signed-in user. */
export function isCatalogProductCartable(
  user: User | null | undefined,
  product: { categoryId?: string | null; categoryName?: string | null },
): boolean {
  if (!canUseOrderCart(user)) return false;
  return catalogProductAllowedForUser(user, product);
}

/** Checkout path after adding to cart (dealer portal). */
export function orderCartPathForUser(_user: User | null | undefined, homePath: string): string {
  return `${homePath}/orders`;
}
