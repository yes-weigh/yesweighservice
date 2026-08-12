/**
 * Dealer price levels — mirror of src/lib/priceLevels.ts resolve logic.
 * Stored at appSettings/priceLevels. Applied on dealer order submit so charged
 * rates match catalog display (client rates are not trusted).
 */

/** Virtual category id for spare-pool rules (not a Zoho category). */
export const SPARE_PRICE_LEVEL_CATEGORY_ID = '__spare_parts__';

/** Built-in catch-all: every dealer not assigned to another level. */
export const DEFAULT_DEALER_PRICE_LEVEL_ID = '__default_dealers__';
export const DEFAULT_DEALER_PRICE_LEVEL_NAME = 'Dealers';

/**
 * Directors level: these SKUs share quantity for slab-tier selection.
 * Each SKU still uses its own slab ₹ rates; clubbed qty picks the tier.
 * Mirror of src/lib/priceLevels.ts — keep in sync.
 */
export const DIRECTORS_QTY_CLUB_SKUS = ['Q9LBL', 'Q10LBL', 'ECS5W', 'ECS4W'];

const DIRECTORS_QTY_CLUB_SKU_SET = new Set(
  DIRECTORS_QTY_CLUB_SKUS.map(sku => String(sku).toUpperCase()),
);

export function normalizePriceLevelSku(sku) {
  return String(sku ?? '').trim().toUpperCase();
}

export function isDirectorsPriceLevelName(name) {
  return String(name ?? '').trim().toLowerCase() === 'directors';
}

export function isDirectorsQtyClubSku(sku) {
  const key = normalizePriceLevelSku(sku);
  return Boolean(key) && DIRECTORS_QTY_CLUB_SKU_SET.has(key);
}

export function sumDirectorsClubCartQty(lines) {
  let sum = 0;
  for (const line of lines || []) {
    if (!isDirectorsQtyClubSku(line?.sku)) continue;
    const qty = Math.floor(Number(line?.quantity) || 0);
    if (qty > 0) sum += qty;
  }
  return sum;
}

/** Qty used to pick slab tier: clubbed total for Directors club SKUs, else line qty. */
export function resolveSlabQuantityForDealerPrice({
  level,
  sku,
  lineQuantity,
  directorsClubQty,
} = {}) {
  const lineQty = clampQty(lineQuantity);
  if (
    level
    && isDirectorsPriceLevelName(level.name)
    && isDirectorsQtyClubSku(sku)
  ) {
    const club = Math.floor(Number(directorsClubQty) || 0);
    return club > 0 ? club : lineQty;
  }
  return lineQty;
}

export function isDefaultDealerPriceLevel(level) {
  const id = typeof level === 'string' || level == null
    ? String(level ?? '').trim()
    : String(level.id ?? '').trim();
  return id === DEFAULT_DEALER_PRICE_LEVEL_ID;
}

function ensureDefaultDealerPriceLevel(levels) {
  const list = Array.isArray(levels) ? [...levels] : [];
  const byDefaultId = list.findIndex(l => isDefaultDealerPriceLevel(l));
  if (byDefaultId >= 0) {
    const current = list[byDefaultId];
    list[byDefaultId] = {
      ...current,
      id: DEFAULT_DEALER_PRICE_LEVEL_ID,
      name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
      dealerIds: [],
    };
  } else {
    const legacyIdx = list.findIndex(
      l => String(l?.name ?? '').trim().toLowerCase() === DEFAULT_DEALER_PRICE_LEVEL_NAME.toLowerCase(),
    );
    if (legacyIdx >= 0) {
      const legacy = list[legacyIdx];
      list[legacyIdx] = {
        ...legacy,
        id: DEFAULT_DEALER_PRICE_LEVEL_ID,
        name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
        dealerIds: [],
      };
    } else {
      const maxOrder = list.reduce((max, l) => Math.max(max, Number(l.sortOrder) || 0), -1);
      list.push({
        id: DEFAULT_DEALER_PRICE_LEVEL_ID,
        name: DEFAULT_DEALER_PRICE_LEVEL_NAME,
        dealerIds: [],
        categoryRules: [],
        restrictedCategoryIds: [],
        sortOrder: maxOrder + 1,
      });
    }
  }

  const defaultLevel = list.find(isDefaultDealerPriceLevel);
  const others = list
    .filter(l => !isDefaultDealerPriceLevel(l))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name)))
    .map((level, index) => ({ ...level, sortOrder: index }));
  return [
    ...others,
    { ...defaultLevel, sortOrder: others.length, dealerIds: [] },
  ];
}

function clampPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clampMoney(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney(n);
}

function clampQty(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000);
}

function normalizeMode(raw) {
  return raw === 'increment' ? 'increment' : 'discount';
}

function normalizeItemKind(raw) {
  if (raw === 'except' || raw === 'increment' || raw === 'fixed') return raw;
  return 'discount';
}

function isGenericSparePartsCategoryName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  return (
    n === 'generic spare parts'
    || n === 'generic spares'
    || n.includes('generic spare')
  );
}

export function productUsesSparePriceLevel(product) {
  const catId = String(product?.categoryId ?? '').trim();
  if (!catId) return true;
  return isGenericSparePartsCategoryName(product?.categoryName);
}

export function normalizePriceLevelSlabs(raw) {
  if (!Array.isArray(raw)) return [];
  const byQty = new Map();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const minQty = clampQty(row.minQty ?? row.qty ?? row.fromQty);
    const rate = clampMoney(row.rate ?? row.customRate ?? row.price);
    byQty.set(minQty, rate);
  }
  return [...byQty.entries()]
    .map(([minQty, rate]) => ({ minQty, rate }))
    .sort((a, b) => a.minQty - b.minQty);
}

export function resolveSlabUnitRate(slabs, quantity, fallbackRate) {
  const list = normalizePriceLevelSlabs(slabs);
  if (!list.length) return roundMoney(fallbackRate);
  const qty = clampQty(quantity);
  let rate = list[0].rate;
  for (const slab of list) {
    if (qty >= slab.minQty) rate = slab.rate;
    else break;
  }
  return roundMoney(rate);
}

function normalizeItemRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const productId = String(raw.productId ?? '').trim();
  if (!productId) return null;
  const kind = normalizeItemKind(raw.kind);
  const customRaw = raw.customRate ?? raw.fixedRate;
  const slabs = kind === 'fixed' ? normalizePriceLevelSlabs(raw.slabs) : [];
  let customRate = null;
  if (kind === 'fixed') {
    customRate = slabs.length > 0 ? slabs[0].rate : clampMoney(customRaw);
  }
  return {
    productId,
    productName: String(raw.productName ?? '').trim() || productId,
    sku: raw.sku != null && String(raw.sku).trim() ? String(raw.sku).trim() : null,
    kind,
    percent: kind === 'except' || kind === 'fixed' ? 0 : clampPercent(raw.percent),
    customRate,
    slabs,
  };
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const categoryId = String(raw.categoryId ?? '').trim();
  if (!categoryId) return null;
  const itemRules = Array.isArray(raw.itemRules)
    ? raw.itemRules.map(normalizeItemRule).filter(Boolean)
    : [];
  const byProduct = new Map();
  for (const item of itemRules) byProduct.set(item.productId, item);
  return {
    categoryId,
    categoryName: String(raw.categoryName ?? '').trim() || categoryId,
    mode: normalizeMode(raw.mode),
    percent: clampPercent(raw.percent),
    itemRules: [...byProduct.values()],
  };
}

function normalizeRestrictedCategoryIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))];
}

function normalizeLevel(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const dealerIds = Array.isArray(raw.dealerIds)
    ? [...new Set(raw.dealerIds.map(v => String(v ?? '').trim()).filter(Boolean))]
    : [];
  const categoryRules = Array.isArray(raw.categoryRules)
    ? raw.categoryRules.map(normalizeRule).filter(Boolean)
    : [];
  const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index;
  return {
    id,
    name: String(raw.name ?? '').trim() || 'Untitled level',
    dealerIds,
    categoryRules,
    restrictedCategoryIds: normalizeRestrictedCategoryIds(
      raw.restrictedCategoryIds ?? raw.hiddenCategoryIds ?? raw.restrictedCategories,
    ),
    sortOrder,
  };
}

export function normalizePriceLevelsDoc(raw) {
  if (!raw || typeof raw !== 'object') {
    return { levels: ensureDefaultDealerPriceLevel([]) };
  }
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map((level, i) => normalizeLevel(level, i)).filter(Boolean)
    : [];
  return { levels: ensureDefaultDealerPriceLevel(levels) };
}

export function applyPriceLevelPercent(listRate, mode, percent) {
  const list = Number(listRate) || 0;
  const pct = clampPercent(percent);
  if (pct <= 0) return roundMoney(list);
  if (mode === 'increment') {
    return roundMoney(list * (1 + pct / 100));
  }
  return roundMoney(list * (1 - pct / 100));
}

export function findPriceLevelForDealer(levels, dealerId) {
  const id = String(dealerId ?? '').trim();
  if (!id) return null;
  const list = Array.isArray(levels) ? levels : [];
  const assigned = list.find(
    level => !isDefaultDealerPriceLevel(level) && (level.dealerIds || []).includes(id),
  );
  if (assigned) return assigned;
  return list.find(isDefaultDealerPriceLevel) || null;
}

function nonePrice(listRate, level, categoryId, itemOverride = false) {
  return {
    listRate,
    chargeRate: listRate,
    mode: 'none',
    percent: 0,
    itemOverride,
    levelId: level?.id || null,
    levelName: level?.name || null,
    categoryId: categoryId || null,
    slabs: [],
  };
}

function applyItemOrCategoryRule(listRate, level, rule, productId, reportCategoryId, quantity) {
  const itemRule = productId
    ? (rule.itemRules || []).find(r => r.productId === productId)
    : null;

  if (itemRule) {
    if (itemRule.kind === 'except') {
      return nonePrice(listRate, level, reportCategoryId, true);
    }
    if (itemRule.kind === 'fixed') {
      const slabs = normalizePriceLevelSlabs(itemRule.slabs);
      const fallback = roundMoney(Number(itemRule.customRate) || 0);
      const chargeRate = slabs.length > 0
        ? resolveSlabUnitRate(slabs, quantity, fallback)
        : fallback;
      return {
        listRate,
        chargeRate,
        mode: 'fixed',
        percent: 0,
        itemOverride: true,
        levelId: level.id,
        levelName: level.name,
        categoryId: reportCategoryId,
        slabs,
      };
    }
    if (itemRule.percent <= 0) {
      return nonePrice(listRate, level, reportCategoryId, true);
    }
    return {
      listRate,
      chargeRate: applyPriceLevelPercent(listRate, itemRule.kind, itemRule.percent),
      mode: itemRule.kind,
      percent: itemRule.percent,
      itemOverride: true,
      levelId: level.id,
      levelName: level.name,
      categoryId: reportCategoryId,
      slabs: [],
    };
  }

  if (rule.percent <= 0) {
    return nonePrice(listRate, level, reportCategoryId);
  }
  return {
    listRate,
    chargeRate: applyPriceLevelPercent(listRate, rule.mode, rule.percent),
    mode: rule.mode,
    percent: rule.percent,
    itemOverride: false,
    levelId: level.id,
    levelName: level.name,
    categoryId: reportCategoryId,
    slabs: [],
  };
}

/**
 * @param {number} [quantity=1]
 * @param {{ directorsClubQty?: number|null }} [options]
 */
export function resolveDealerUnitPrice(levels, dealerId, product, quantity = 1, options) {
  const listRate = roundMoney(Number(product?.rate) || 0);
  const level = findPriceLevelForDealer(levels, dealerId);
  const categoryId = String(product?.categoryId ?? '').trim() || null;
  const productId = String(product?.id ?? product?.productId ?? '').trim();
  const sku = product?.sku ?? null;
  const lineQty = clampQty(quantity);
  const qty = resolveSlabQuantityForDealerPrice({
    level,
    sku,
    lineQuantity: lineQty,
    directorsClubQty: options?.directorsClubQty,
  });
  if (!level) {
    return nonePrice(listRate, null, categoryId);
  }

  const spareRule = level.categoryRules.find(r => r.categoryId === SPARE_PRICE_LEVEL_CATEGORY_ID);
  const categoryRule = categoryId
    ? level.categoryRules.find(r => r.categoryId === categoryId)
    : null;
  const useSpareBucket = productUsesSparePriceLevel(product);

  if (useSpareBucket && spareRule) {
    const priced = applyItemOrCategoryRule(
      listRate,
      level,
      spareRule,
      productId,
      SPARE_PRICE_LEVEL_CATEGORY_ID,
      qty,
    );
    if (priced.itemOverride || priced.mode !== 'none') {
      return priced;
    }
  }

  if (useSpareBucket && categoryRule && categoryId) {
    return applyItemOrCategoryRule(listRate, level, categoryRule, productId, categoryId, qty);
  }

  if (!useSpareBucket && categoryRule && categoryId) {
    return applyItemOrCategoryRule(listRate, level, categoryRule, productId, categoryId, qty);
  }

  return nonePrice(listRate, level, categoryId);
}

export async function loadPriceLevelsFromFirestore(db) {
  const snap = await db.doc('appSettings/priceLevels').get();
  if (!snap.exists) return { levels: [] };
  return normalizePriceLevelsDoc(snap.data());
}
