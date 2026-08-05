/**
 * Dealer price levels — mirror of src/lib/priceLevels.ts resolve logic.
 * Stored at appSettings/priceLevels. Applied on dealer order submit so charged
 * rates match catalog display (client rates are not trusted).
 */

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

function normalizeMode(raw) {
  return raw === 'increment' ? 'increment' : 'discount';
}

function normalizeItemKind(raw) {
  if (raw === 'except' || raw === 'increment' || raw === 'fixed') return raw;
  return 'discount';
}

function normalizeItemRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const productId = String(raw.productId ?? '').trim();
  if (!productId) return null;
  const kind = normalizeItemKind(raw.kind);
  const customRaw = raw.customRate ?? raw.fixedRate;
  return {
    productId,
    productName: String(raw.productName ?? '').trim() || productId,
    sku: raw.sku != null && String(raw.sku).trim() ? String(raw.sku).trim() : null,
    kind,
    percent: kind === 'except' || kind === 'fixed' ? 0 : clampPercent(raw.percent),
    customRate: kind === 'fixed' ? clampMoney(customRaw) : null,
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
    sortOrder,
  };
}

export function normalizePriceLevelsDoc(raw) {
  if (!raw || typeof raw !== 'object') return { levels: [] };
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map((level, i) => normalizeLevel(level, i)).filter(Boolean)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : [];
  return { levels };
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
  return levels.find(level => level.dealerIds.includes(id)) || null;
}

/**
 * @returns {{
 *   listRate: number,
 *   chargeRate: number,
 *   mode: string,
 *   percent: number,
 *   itemOverride: boolean,
 *   levelId: string | null,
 *   levelName: string | null,
 * }}
 */
export function resolveDealerUnitPrice(levels, dealerId, product) {
  const listRate = roundMoney(Number(product?.rate) || 0);
  const none = {
    listRate,
    chargeRate: listRate,
    mode: 'none',
    percent: 0,
    itemOverride: false,
    levelId: null,
    levelName: null,
  };
  const level = findPriceLevelForDealer(levels, dealerId);
  const categoryId = String(product?.categoryId ?? '').trim() || null;
  const productId = String(product?.id ?? product?.productId ?? '').trim();
  if (!level || !categoryId) return none;
  const rule = level.categoryRules.find(r => r.categoryId === categoryId);
  if (!rule) return none;

  const levelMeta = { levelId: level.id, levelName: level.name };
  const itemRule = productId
    ? (rule.itemRules || []).find(r => r.productId === productId)
    : null;

  if (itemRule) {
    if (itemRule.kind === 'except') {
      return { ...none, itemOverride: true, ...levelMeta };
    }
    if (itemRule.kind === 'fixed') {
      return {
        listRate,
        chargeRate: roundMoney(Number(itemRule.customRate) || 0),
        mode: 'fixed',
        percent: 0,
        itemOverride: true,
        ...levelMeta,
      };
    }
    if (itemRule.percent <= 0) {
      return { ...none, itemOverride: true, ...levelMeta };
    }
    return {
      listRate,
      chargeRate: applyPriceLevelPercent(listRate, itemRule.kind, itemRule.percent),
      mode: itemRule.kind,
      percent: itemRule.percent,
      itemOverride: true,
      ...levelMeta,
    };
  }

  if (rule.percent <= 0) {
    return { ...none, ...levelMeta };
  }
  return {
    listRate,
    chargeRate: applyPriceLevelPercent(listRate, rule.mode, rule.percent),
    mode: rule.mode,
    percent: rule.percent,
    itemOverride: false,
    ...levelMeta,
  };
}

export async function loadPriceLevelsFromFirestore(db) {
  const snap = await db.doc('appSettings/priceLevels').get();
  if (!snap.exists) return { levels: [] };
  return normalizePriceLevelsDoc(snap.data());
}
