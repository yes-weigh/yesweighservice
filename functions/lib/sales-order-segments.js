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

/** Inventory / Zoho Branch sites used when splitting cart → SO. */
export const INVENTORY_SITES = ['cochin', 'head_office'];

export const WAREHOUSE_NAME_COCHIN = 'Cochin';
export const WAREHOUSE_NAME_HEAD_OFFICE = 'Head Office';

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

function warehouseStock(warehouses, warehouseName) {
  const target = String(warehouseName ?? '').trim().toLowerCase();
  if (!target || !Array.isArray(warehouses)) return 0;
  const match = warehouses.find(
    row => String(row?.warehouseName ?? '').trim().toLowerCase() === target,
  );
  const stock = Number(match?.stock ?? 0);
  return Number.isFinite(stock) ? stock : 0;
}

/**
 * Pick Cochin vs Head Office for a cart line from Zoho warehouse stock.
 * Software always Head Office. Prefer higher positive stock; empty → segment default.
 *
 * @param {'product'|'spare'|'software'|null} segment
 * @param {Array<{ warehouseName?: string, stock?: number }>|null|undefined} warehouses
 * @returns {'cochin'|'head_office'}
 */
export function resolveLineInventorySite(segment, warehouses) {
  if (segment === 'software') return 'head_office';

  const cochinStock = warehouseStock(warehouses, WAREHOUSE_NAME_COCHIN);
  const headOfficeStock = warehouseStock(warehouses, WAREHOUSE_NAME_HEAD_OFFICE);

  if (cochinStock > 0 || headOfficeStock > 0) {
    if (cochinStock === headOfficeStock) {
      return segment === 'spare' ? 'head_office' : 'cochin';
    }
    return cochinStock > headOfficeStock ? 'cochin' : 'head_office';
  }

  // No positive stock at either primary warehouse.
  return segment === 'spare' ? 'head_office' : 'cochin';
}

export function orderSegmentFromInvoiceCategory(category) {
  const value = String(category ?? '').trim().toLowerCase();
  if (value === 'spare') return 'spare';
  if (value === 'software_key' || value === 'software') return 'software';
  if (value === 'product') return 'product';
  return null;
}

export function parseInventorySite(value) {
  const site = String(value ?? '').trim().toLowerCase();
  if (site === 'cochin' || site === 'head_office') return site;
  return null;
}

export function defaultInventorySiteForSegment(segment) {
  if (segment === 'spare' || segment === 'software') return 'head_office';
  return 'cochin';
}

/**
 * Existing-SO add-line gate: item must match the SO's segment × inventory site.
 * Freight is not catalog-carted (auto freight).
 */
export function productMatchesSalesOrderBucket(product, bucket = {}) {
  const requiredSegment = parseOrderSegment(bucket.segment)
    || orderSegmentFromInvoiceCategory(bucket.salesOrderCategory);
  if (!requiredSegment) return false;

  const productId = product?.productId ?? product?.id ?? null;
  if (isFreightOrderLine({ productId, sku: product?.sku })) return false;

  const segment = classifyOrderLineSegment({
    categoryId: product?.categoryId,
    categoryName: product?.categoryName,
    productId,
    sku: product?.sku,
  });
  if (segment !== requiredSegment) return false;

  const requiredSite = parseInventorySite(bucket.site)
    || parseInventorySite(bucket.yesOneInventorySite)
    || defaultInventorySiteForSegment(requiredSegment);
  return resolveLineInventorySite(segment, product?.warehouses) === requiredSite;
}

export function inventorySiteLabel(site) {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}

export function segmentSiteBucketKey(segment, site) {
  return `${segment}:${site === 'head_office' ? 'head_office' : 'cochin'}`;
}

export function parseSegmentSiteBucketKey(key) {
  const raw = String(key ?? '');
  const [segment, site] = raw.split(':');
  if (segment !== 'product' && segment !== 'spare' && segment !== 'software') return null;
  if (site !== 'cochin' && site !== 'head_office') return null;
  return { segment, site };
}

/**
 * Split cart into segment × inventory-site buckets for multi-SO create.
 * Freight attaches to first product bucket (prefer Cochin), else first spare bucket.
 *
 * @param {object[]} lines lines should include warehouses[] when available
 * @returns {Array<{ key: string, segment: 'product'|'spare'|'software', site: 'cochin'|'head_office', lines: object[] }>}
 */
export function groupLinesBySegmentAndSite(lines) {
  /** @type {Map<string, { key: string, segment: string, site: string, lines: object[] }>} */
  const buckets = new Map();
  const freight = [];

  const ensureBucket = (segment, site) => {
    const key = segmentSiteBucketKey(segment, site);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, segment, site, lines: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const line of lines || []) {
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
    ];
    const hostKey = hostOrder.find(key => (buckets.get(key)?.lines.length ?? 0) > 0) || null;
    if (hostKey) {
      buckets.get(hostKey).lines.push(...freight);
    }
  }

  const order = [
    'product:cochin',
    'product:head_office',
    'spare:cochin',
    'spare:head_office',
    'software:head_office',
    'software:cochin',
  ];
  const ordered = [];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (bucket?.lines.length) ordered.push(bucket);
  }
  for (const [key, bucket] of buckets) {
    if (!order.includes(key) && bucket.lines.length) ordered.push(bucket);
  }
  return ordered;
}

/** Host segment for freight lines: product, else spare; never software. */
export function freightHostSegment(groups) {
  if (groups?.product?.length) return 'product';
  if (groups?.spare?.length) return 'spare';
  return null;
}

/** Freight attaches to product or spare only — never software. */
export function segmentAllowsFreight(segment) {
  return segment === 'product' || segment === 'spare';
}

export function segmentLabel(segment) {
  if (segment === 'spare') return 'Spare';
  if (segment === 'software') return 'Software';
  return 'Product';
}

/** Order-number suffix for a segment×site bucket (multi-SO carts). */
export function segmentSiteOrderSuffix(segment, site) {
  if (segment === 'software') return 'SW';
  const siteTag = site === 'head_office' ? 'HO' : 'C';
  if (segment === 'spare') return `SP-${siteTag}`;
  return `P-${siteTag}`;
}

export function segmentSiteLabel(segment, site) {
  if (segment === 'software') return 'Software · Head Office';
  return `${segmentLabel(segment)} · ${inventorySiteLabel(site)}`;
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

/** Software keys skip ops review and open as Awaiting payment. */
export function segmentSkipsOpsReview(segment) {
  return parseOrderSegment(segment) === 'software';
}

/**
 * Who may add a segment on staff/super-admin create paths.
 * Dealers are not gated here (cart path).
 * Full SA: all. Spare Incharge (non-SA): spare only.
 * Other sales staff: product + spare + software (submit splits; spare → SI SP).
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
  return segment === 'product' || segment === 'spare' || segment === 'software';
}
