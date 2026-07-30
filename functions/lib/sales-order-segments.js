/**
 * Strict catalog segment classification for multi-SO split.
 * spare = generic spare parts + uncategorized
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
 * @param {{ categoryId?: string|null, categoryName?: string|null }} line
 * @returns {'product'|'spare'|'software'}
 */
export function classifyOrderLineSegment(line = {}) {
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
  for (const line of lines) {
    const segment = classifyOrderLineSegment(line);
    groups[segment].push(line);
  }
  return groups;
}

export function segmentLabel(segment) {
  if (segment === 'spare') return 'Spare';
  if (segment === 'software') return 'Software';
  return 'Product';
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
