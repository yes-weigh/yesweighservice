import {
  hasCatalogCategory,
  isGenericSparePartsCategory,
  isSoftwareKeysCategory,
} from './catalog';
import { isFullSuperAdmin } from './staffAccess';
import type { Role, User } from '../types';

export type OrderSegment = 'product' | 'spare' | 'software';

export const ORDER_SEGMENTS: OrderSegment[] = ['product', 'spare', 'software'];

export function isSoftwareSegmentCategoryName(name: string | null | undefined): boolean {
  const normalized = String(name ?? '').trim().toLowerCase();
  return normalized === 'software keys' || normalized === 'sanoft';
}

/**
 * Strict catalog segment for multi-SO split.
 * spare = generic spare parts + uncategorized
 * software = software keys + sanoft
 * product = everything else
 */
export function classifyOrderLineSegment(line: {
  categoryId?: string | null;
  categoryName?: string | null;
}): OrderSegment {
  if (!hasCatalogCategory({ categoryId: line.categoryId ?? null })) {
    return 'spare';
  }
  if (line.categoryName && isGenericSparePartsCategory({ name: line.categoryName })) {
    return 'spare';
  }
  if (line.categoryName && isSoftwareSegmentCategoryName(line.categoryName)) {
    return 'software';
  }
  // software keys helper is exact-match only; sanoft handled above
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
}>(lines: T[]): Record<OrderSegment, T[]> {
  const groups: Record<OrderSegment, T[]> = {
    product: [],
    spare: [],
    software: [],
  };
  for (const line of lines) {
    groups[classifyOrderLineSegment(line)].push(line);
  }
  return groups;
}

export function summarizeSegments(lines: Array<{
  categoryId?: string | null;
  categoryName?: string | null;
}>): OrderSegment[] {
  const groups = groupLinesBySegment(lines);
  return ORDER_SEGMENTS.filter(segment => groups[segment].length > 0);
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
  product: { categoryId?: string | null; categoryName?: string | null },
): boolean {
  if (isDealerCartRole(user?.role)) return true;
  return staffCanAddOrderSegment(user, classifyOrderLineSegment(product));
}
