import {
  hasCatalogCategory,
  isGenericSparePartsCategory,
  isSoftwareKeysCategory,
} from './catalog';
import { isFreightProductId, isFreightSku } from '../constants/freightLines';
import { isFullSuperAdmin } from './staffAccess';
import { canUseCart, type Role, type User } from '../types';

export type OrderSegment = 'product' | 'spare' | 'software';

export const ORDER_SEGMENTS: OrderSegment[] = ['product', 'spare', 'software'];

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

export function segmentLabel(segment: OrderSegment): string {
  if (segment === 'spare') return 'Spare';
  if (segment === 'software') return 'Software';
  return 'Product';
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

/** Dealer / dealer_staff can add any segment (canBuySpares enforced on submit). */
export function isDealerCartRole(role: Role | undefined | null): boolean {
  return role === 'dealer' || role === 'dealer_staff';
}

/**
 * Staff/super-admin create path: which segments may be added.
 * Full SA: all. Spare Incharge (non-SA): spare only. Other staff: product + software.
 */
export function staffCanAddOrderSegment(
  user: User | null | undefined,
  segment: OrderSegment,
): boolean {
  if (!user) return false;
  if (isDealerCartRole(user.role)) return true;
  if (isFullSuperAdmin(user)) return true;
  if (user.spareIncharge === true) return segment === 'spare';
  return segment === 'product' || segment === 'software';
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
export function orderCartPathForUser(user: User | null | undefined, homePath: string): string {
  return `${homePath}/orders`;
}
