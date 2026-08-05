/**
 * yesOnePriceChanges attribution helpers.
 * - price_level: settings rule at create — show level name, no user
 * - user: staff/admin (or manual) rate change — stamp actor
 */

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function rateKey(productId, rate) {
  return `${String(productId ?? '')}:${roundMoney(rate)}`;
}

/**
 * Stamp create-time audit rows. Level-sourced rows get no user; others get actor.
 */
export function stampCreatePriceAudit(priceChanges, { uid, name, at }) {
  const list = Array.isArray(priceChanges) ? priceChanges : [];
  return list.map(change => {
    if (change.source === 'price_level') {
      return {
        ...change,
        source: 'price_level',
        priceLevelId: change.priceLevelId ? String(change.priceLevelId) : null,
        priceLevelName: change.priceLevelName ? String(change.priceLevelName) : null,
        changedAt: at,
        changedByUid: null,
        changedByName: null,
      };
    }
    return {
      ...change,
      source: 'user',
      priceLevelId: null,
      priceLevelName: null,
      changedAt: at,
      changedByUid: uid || null,
      changedByName: name || null,
    };
  });
}

/**
 * On draft line save: keep prior attribution when productId+rate match; else stamp current user.
 */
export function mergePriceChangeAudit(previous, nextBare, { uid, name, at }) {
  const prevList = Array.isArray(previous) ? previous : [];
  const byKey = new Map();
  for (const prev of prevList) {
    byKey.set(rateKey(prev.productId, prev.rate), prev);
  }

  return (Array.isArray(nextBare) ? nextBare : []).map(change => {
    const prev = byKey.get(rateKey(change.productId, change.rate));
    if (prev) {
      const isLevel = prev.source === 'price_level'
        || (!prev.changedByUid && Boolean(prev.priceLevelName));
      if (isLevel) {
        return {
          ...change,
          source: 'price_level',
          priceLevelId: prev.priceLevelId ? String(prev.priceLevelId) : null,
          priceLevelName: prev.priceLevelName ? String(prev.priceLevelName) : null,
          changedAt: prev.changedAt || at,
          changedByUid: null,
          changedByName: null,
        };
      }
      return {
        ...change,
        source: 'user',
        priceLevelId: null,
        priceLevelName: null,
        changedAt: prev.changedAt || at,
        changedByUid: prev.changedByUid || null,
        changedByName: prev.changedByName || null,
      };
    }
    return {
      ...change,
      source: 'user',
      priceLevelId: null,
      priceLevelName: null,
      changedAt: at,
      changedByUid: uid || null,
      changedByName: name || null,
    };
  });
}

/** Keep only audit rows for products on this SO segment. */
export function filterPriceAuditForLines(priceChanges, lines) {
  const list = Array.isArray(priceChanges) ? priceChanges : [];
  if (!list.length) return [];
  const ids = new Set(
    (Array.isArray(lines) ? lines : [])
      .map(line => String(line?.productId ?? line?.itemId ?? '').trim())
      .filter(Boolean),
  );
  return list.filter(change => ids.has(String(change?.productId ?? '').trim()));
}
