import {
  isFreightOrderLine,
} from './freight-lines.js';

/**
 * Strict catalog segment classification for multi-SO split.
 * spare = generic spare parts + uncategorized (except freight SKUs)
 * software = software keys + sanoft
 * product = everything else with a real category
 */

export const ORDER_SEGMENTS = ['product', 'spare', 'software'];

export function isGenericSparePartsCategoryName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return (
    normalized === 'generic spare parts'
    || normalized === 'generic spares'
    || normalized.includes('generic spare')
  );
}

export function isSoftwareSegmentCategoryName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return normalized === 'software keys' || normalized === 'sanoft';
}

/** Uncategorized = missing category id or Zoho ROOT (-1). */
export function isUncategorizedCategoryId(categoryId) {
  const id = String(categoryId ?? '').trim();
  return !id || id === '-1';
}

/**
 * @param {{ categoryId?: string|null, categoryName?: string|null, sku?: string|null, productId?: string|null, itemId?: string|null }} line
 * @returns {'product'|'spare'|'software'|null} null = freight (attach to host segment)
 */
export function classifyOrderLineSegment(line = {}) {
  if (isFreightOrderLine(line)) return null;

  const categoryId = line.categoryId ?? null;
  const categoryName = line.categoryName ?? null;

  if (isUncategorizedCategoryId(categoryId)) {
    return 'spare';
  }
  if (isGenericSparePartsCategoryName(categoryName)) {
    return 'spare';
  }
  if (isSoftwareSegmentCategoryName(categoryName)) {
    return 'software';
  }
  return 'product';
}

/**
 * @param {object[]} lines
 * @returns {Record<'product'|'spare'|'software', object[]>}
 */
export function groupLinesBySegment(lines) {
  const groups = {
    product: [],
    spare: [],
    software: [],
  };
  const freight = [];
  for (const line of lines) {
    const segment = classifyOrderLineSegment(line);
    if (!segment) {
      freight.push(line);
      continue;
    }
    groups[segment].push(line);
  }
  if (freight.length) {
    // Freight belongs on product or spare SOs only — never software.
    const host = (['product', 'spare']).find(segment => groups[segment].length > 0) || null;
    if (!host) {
      // Software-only (or empty) cart — drop freight rather than attach to software.
      // Callers that require freight should validate before grouping.
    } else {
      groups[host].push(...freight);
    }
  }
  return groups;
}

/** Host segment for freight lines: product, else spare; never software. */
export function freightHostSegment(groups) {
  if (groups?.product?.length) return 'product';
  if (groups?.spare?.length) return 'spare';
  return null;
}

export function segmentLabel(segment) {
  if (segment === 'spare') return 'Spare';
  if (segment === 'software') return 'Software';
  return 'Product';
}

export function segmentToInvoiceCategory(segment) {
  if (segment === 'spare') return 'spare';
  if (segment === 'software') return 'software_key';
  return 'product';
}

export function parseOrderSegment(value) {
  const segment = String(value ?? '').trim().toLowerCase();
  if (segment === 'product' || segment === 'spare' || segment === 'software') return segment;
  return null;
}

/**
 * Who may add a segment on staff/super-admin create paths.
 * Dealers are not gated here (cart path).
 *
 * @param {{ role?: string, spareIncharge?: boolean, viewOnly?: boolean }} user
 * @param {'product'|'spare'|'software'} segment
 * @param {{ isFullSuperAdmin?: boolean }} opts
 */
export function staffCanAddOrderSegment(user, segment, opts = {}) {
  const isFullSA = Boolean(opts.isFullSuperAdmin);
  const isSI = user?.spareIncharge === true;

  if (isFullSA) return true;
  if (isSI) return segment === 'spare';
  return segment === 'product' || segment === 'software';
}
