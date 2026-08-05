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

function normalizeMode(raw) {
  return raw === 'increment' ? 'increment' : 'discount';
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const categoryId = String(raw.categoryId ?? '').trim();
  if (!categoryId) return null;
  return {
    categoryId,
    categoryName: String(raw.categoryName ?? '').trim() || categoryId,
    mode: normalizeMode(raw.mode),
    percent: clampPercent(raw.percent),
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
 * @returns {{ listRate: number, chargeRate: number, mode: string, percent: number }}
 */
export function resolveDealerUnitPrice(levels, dealerId, product) {
  const listRate = roundMoney(Number(product?.rate) || 0);
  const level = findPriceLevelForDealer(levels, dealerId);
  const categoryId = String(product?.categoryId ?? '').trim() || null;
  if (!level || !categoryId) {
    return { listRate, chargeRate: listRate, mode: 'none', percent: 0 };
  }
  const rule = level.categoryRules.find(r => r.categoryId === categoryId);
  if (!rule || rule.percent <= 0) {
    return { listRate, chargeRate: listRate, mode: 'none', percent: 0 };
  }
  return {
    listRate,
    chargeRate: applyPriceLevelPercent(listRate, rule.mode, rule.percent),
    mode: rule.mode,
    percent: rule.percent,
  };
}

export async function loadPriceLevelsFromFirestore(db) {
  const snap = await db.doc('appSettings/priceLevels').get();
  if (!snap.exists) return { levels: [] };
  return normalizePriceLevelsDoc(snap.data());
}
