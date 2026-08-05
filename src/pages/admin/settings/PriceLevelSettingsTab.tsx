import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Package,
  Percent,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { CategoryBrowseCard } from '../../../components/catalog/CategoryBrowseCard';
import { CategoryThumbnail } from '../../../components/catalog/CategoryThumbnail';
import { useAuth } from '../../../context/AuthContext';
import { fetchCatalog, isHiddenCatalogCategory } from '../../../lib/catalog';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../../lib/dealer-cache';
import { dealerMatchesLogisticsQuery } from '../../../lib/logisticsDealers';
import {
  categoryRuleHasEffect,
  createEmptyPriceLevel,
  emptyCategoryRule,
  enforceUniqueDealerAssignments,
  loadPriceLevels,
  priceLevelsEqual,
  priceLevelsLiveSaveMs,
  savePriceLevels,
} from '../../../lib/priceLevels';
import type { CatalogCategory, CatalogProduct } from '../../../types/catalog';
import type { ZohoDealer } from '../../../types/dealers';
import type {
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelItemRule,
  PriceLevelItemRuleKind,
  PriceLevelRuleMode,
} from '../../../types/priceLevels';

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function dealerLabel(d: Pick<ZohoDealer, 'contactName' | 'companyName' | 'id'>): string {
  return (d.companyName || d.contactName || d.id).trim();
}

function namesFromDealers(
  dealers: ZohoDealer[],
  dealerIds: string[],
): Record<string, string> {
  const byId = new Map(dealers.map(d => [d.id, dealerLabel(d)]));
  const names: Record<string, string> = {};
  for (const id of dealerIds) {
    names[id] = byId.get(id) || id;
  }
  return names;
}

export const PriceLevelSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [savedLevels, setSavedLevels] = useState<PriceLevel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [dealerNames, setDealerNames] = useState<Record<string, string>>({});
  const [allDealers, setAllDealers] = useState<ZohoDealer[]>(() => peekCachedDealers() ?? []);
  const [dealersLoading, setDealersLoading] = useState(() => !(peekCachedDealers()?.length));
  const [dealerSearchError, setDealerSearchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dealerQuery, setDealerQuery] = useState('');
  /** Category selected from the catalogue-style grid for editing rules. */
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');

  const levelsRef = useRef(levels);
  const savedRef = useRef(savedLevels);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveEpochRef = useRef(0);
  const userUid = user?.uid ?? null;

  levelsRef.current = levels;
  savedRef.current = savedLevels;

  const selected = useMemo(
    () => levels.find(l => l.id === selectedId) ?? null,
    [levels, selectedId],
  );

  useEffect(() => {
    setRuleCategoryId(null);
    setItemQuery('');
  }, [selectedId]);

  const rulesByCategoryId = useMemo(() => {
    const map = new Map<string, PriceLevelCategoryRule>();
    for (const rule of selected?.categoryRules ?? []) {
      map.set(rule.categoryId, rule);
    }
    return map;
  }, [selected]);

  const activeRuleCount = useMemo(
    () => (selected?.categoryRules ?? []).filter(categoryRuleHasEffect).length,
    [selected],
  );

  const productsByCategory = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    for (const product of products) {
      const catId = String(product.categoryId ?? '').trim();
      if (!catId) continue;
      const list = map.get(catId) ?? [];
      list.push(product);
      map.set(catId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [products]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [docData, catalog] = await Promise.all([
        loadPriceLevels(),
        fetchCatalog(),
      ]);
      setLevels(docData.levels);
      setSavedLevels(docData.levels);
      setSelectedId(prev => prev && docData.levels.some(l => l.id === prev)
        ? prev
        : (docData.levels[0]?.id ?? null));
      // Same browse filter as catalogue: drop hidden names (e.g. Inactive, Stamping) and empty cats.
      setCategories(
        [...catalog.categories]
          .filter(c => c.id && c.productCount > 0 && !isHiddenCatalogCategory(c))
          .sort((a, b) => {
            const orderDiff = a.displayOrder - b.displayOrder;
            if (orderDiff !== 0) return orderDiff;
            return a.name.localeCompare(b.name);
          }),
      );
      setProducts(catalog.items ?? []);

      const allDealerIds = [...new Set(docData.levels.flatMap(l => l.dealerIds))];
      if (allDealerIds.length) {
        const cached = peekCachedDealers() ?? [];
        setDealerNames(namesFromDealers(cached, allDealerIds));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load price levels.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedDealers();
    if (cached?.length) {
      setAllDealers(cached);
      setDealersLoading(false);
    } else {
      setDealersLoading(true);
    }

    const unsubscribe = subscribeDealerCache((list, complete) => {
      if (cancelled) return;
      setAllDealers(list);
      if (complete || list.length > 0) setDealersLoading(false);
    });

    void ensureDealersCached()
      .then(list => {
        if (cancelled) return;
        setAllDealers(list);
        setDealersLoading(false);
        setDealerSearchError('');
      })
      .catch(err => {
        if (cancelled || peekCachedDealers()?.length) return;
        setAllDealers([]);
        setDealersLoading(false);
        setDealerSearchError(
          err instanceof Error ? err.message : 'Could not load dealers for search.',
        );
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const ids = [...new Set(levels.flatMap(l => l.dealerIds))];
    if (!ids.length || !allDealers.length) return;
    setDealerNames(prev => ({ ...prev, ...namesFromDealers(allDealers, ids) }));
  }, [levels, allDealers]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const dealerHits = useMemo(() => {
    const q = dealerQuery.trim();
    if (q.length < 2) return [];
    return allDealers
      .filter(dealer => dealerMatchesLogisticsQuery(dealer, q))
      .slice(0, 20);
  }, [allDealers, dealerQuery]);

  const queueSave = useCallback((nextLevels: PriceLevel[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(() => {
      const current = enforceUniqueDealerAssignments(levelsRef.current);
      if (priceLevelsEqual(current, savedRef.current)) {
        setSaveStatus(prev => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      setError('');
      void savePriceLevels(current, userUid)
        .then(saved => {
          setSavedLevels(saved.levels);
          setLevels(prev => {
            if (!priceLevelsEqual(prev, nextLevels) && !priceLevelsEqual(prev, current)) {
              return prev;
            }
            return saved.levels;
          });
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          setError(err instanceof Error ? err.message : 'Could not save price levels.');
        });
    }, priceLevelsLiveSaveMs());
  }, [userUid]);

  const patchLevels = useCallback((updater: (prev: PriceLevel[]) => PriceLevel[]) => {
    setLevels(prev => {
      const next = enforceUniqueDealerAssignments(updater(prev));
      queueSave(next);
      return next;
    });
  }, [queueSave]);

  const addLevel = () => {
    const level = createEmptyPriceLevel(`Level ${levels.length + 1}`, levels.length);
    patchLevels(prev => [...prev, level]);
    setSelectedId(level.id);
  };

  const removeLevel = (id: string) => {
    patchLevels(prev => prev.filter(l => l.id !== id));
    setSelectedId(prev => {
      if (prev !== id) return prev;
      const remaining = levels.filter(l => l.id !== id);
      return remaining[0]?.id ?? null;
    });
  };

  const updateSelected = (patch: Partial<PriceLevel>) => {
    if (!selectedId) return;
    patchLevels(prev => prev.map(l => (l.id === selectedId ? { ...l, ...patch } : l)));
  };

  const addDealer = (dealer: ZohoDealer) => {
    if (!selected) return;
    setDealerNames(prev => ({ ...prev, [dealer.id]: dealerLabel(dealer) }));
    patchLevels(prev => prev.map(level => {
      if (level.id === selected.id) {
        if (level.dealerIds.includes(dealer.id)) return level;
        return { ...level, dealerIds: [...level.dealerIds, dealer.id] };
      }
      return {
        ...level,
        dealerIds: level.dealerIds.filter(id => id !== dealer.id),
      };
    }));
    setDealerQuery('');
  };

  const removeDealer = (dealerId: string) => {
    if (!selected) return;
    updateSelected({
      dealerIds: selected.dealerIds.filter(id => id !== dealerId),
    });
  };

  const clearCategoryRule = (categoryId: string) => {
    if (!selected) return;
    updateSelected({
      categoryRules: selected.categoryRules.filter(r => r.categoryId !== categoryId),
    });
  };

  const replaceCategoryRule = (nextRule: PriceLevelCategoryRule) => {
    if (!selected) return;
    const others = selected.categoryRules.filter(r => r.categoryId !== nextRule.categoryId);
    if (nextRule.percent <= 0 && nextRule.itemRules.length === 0) {
      updateSelected({ categoryRules: others });
      return;
    }
    updateSelected({ categoryRules: [...others, nextRule] });
  };

  const ensureCategoryRule = (category: CatalogCategory): PriceLevelCategoryRule => {
    return rulesByCategoryId.get(category.id)
      ?? emptyCategoryRule(category.id, category.name);
  };

  const upsertCategoryRule = (
    category: CatalogCategory,
    patch: Partial<Pick<PriceLevelCategoryRule, 'mode' | 'percent'>>,
  ) => {
    if (!selected) return;
    const existing = ensureCategoryRule(category);
    const nextRule: PriceLevelCategoryRule = {
      ...existing,
      categoryName: category.name,
      mode: patch.mode ?? existing.mode,
      percent: patch.percent !== undefined ? patch.percent : existing.percent,
    };
    // Clearing category % drops the rule when there are no item overrides.
    if (
      nextRule.percent <= 0
      && patch.percent !== undefined
      && nextRule.itemRules.length === 0
    ) {
      clearCategoryRule(category.id);
      return;
    }
    replaceCategoryRule(nextRule);
  };

  const upsertItemRule = (
    category: CatalogCategory,
    product: CatalogProduct,
    patch: Partial<Pick<PriceLevelItemRule, 'kind' | 'percent'>>,
  ) => {
    const existing = ensureCategoryRule(category);
    const prevItem = existing.itemRules.find(r => r.productId === product.id);
    const kind: PriceLevelItemRuleKind = patch.kind ?? prevItem?.kind ?? 'except';
    const nextItem: PriceLevelItemRule = {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      kind,
      percent: kind === 'except'
        ? 0
        : (patch.percent !== undefined ? patch.percent : (prevItem?.percent ?? 0)),
    };
    const itemRules = [
      ...existing.itemRules.filter(r => r.productId !== product.id),
      nextItem,
    ];
    replaceCategoryRule({
      ...existing,
      categoryName: category.name,
      itemRules,
    });
    setItemQuery('');
    setRuleCategoryId(category.id);
  };

  const updateItemRule = (
    category: CatalogCategory,
    productId: string,
    patch: Partial<Pick<PriceLevelItemRule, 'kind' | 'percent'>>,
  ) => {
    const existing = ensureCategoryRule(category);
    const prevItem = existing.itemRules.find(r => r.productId === productId);
    if (!prevItem) return;
    const kind = patch.kind ?? prevItem.kind;
    const nextItem: PriceLevelItemRule = {
      ...prevItem,
      kind,
      percent: kind === 'except'
        ? 0
        : (patch.percent !== undefined ? patch.percent : prevItem.percent),
    };
    replaceCategoryRule({
      ...existing,
      itemRules: existing.itemRules.map(r => (r.productId === productId ? nextItem : r)),
    });
  };

  const removeItemRule = (category: CatalogCategory, productId: string) => {
    const existing = ensureCategoryRule(category);
    const itemRules = existing.itemRules.filter(r => r.productId !== productId);
    if (existing.percent <= 0 && itemRules.length === 0) {
      clearCategoryRule(category.id);
      return;
    }
    replaceCategoryRule({ ...existing, itemRules });
  };

  const saveLabel = saveStatus === 'saving' || saveStatus === 'pending'
    ? 'Saving…'
    : saveStatus === 'saved'
      ? 'Saved'
      : saveStatus === 'error'
        ? 'Save failed'
        : '';

  if (loading) {
    return (
      <div className="panel glass price-levels-tab price-levels-tab--loading">
        <Loader2 className="spin-icon" size={22} aria-hidden />
        <p className="text-muted">Loading price levels…</p>
      </div>
    );
  }

  return (
    <div className="panel glass price-levels-tab">
      <header className="price-levels-tab__header">
        <div>
          <h3>Price level setting</h3>
          <p className="text-muted text-sm">
            Create levels, assign dealers, and set category discount or price hike %.
            Changes save automatically.
          </p>
        </div>
        {saveLabel ? (
          <span
            className={`price-levels-tab__save ${
              saveStatus === 'error' ? 'is-error' : saveStatus === 'saved' ? 'is-saved' : ''
            }`}
          >
            {saveStatus === 'saved' ? <Check size={14} aria-hidden /> : null}
            {(saveStatus === 'saving' || saveStatus === 'pending')
              ? <Loader2 size={14} className="spin-icon" aria-hidden />
              : null}
            {saveLabel}
          </span>
        ) : null}
      </header>

      {error ? <p className="price-levels-tab__error">{error}</p> : null}

      <div className="price-levels-tab__layout">
        <aside className="price-levels-tab__levels">
          <div className="price-levels-tab__levels-head">
            <span>Levels</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={addLevel}>
              <Plus size={14} aria-hidden />
              Add
            </button>
          </div>
          {levels.length === 0 ? (
            <p className="text-muted text-sm price-levels-tab__empty">
              No levels yet. Add one (e.g. Directors, Agents, Dealers).
            </p>
          ) : (
            <ul className="price-levels-tab__level-list">
              {levels.map(level => (
                <li key={level.id}>
                  <button
                    type="button"
                    className={`price-levels-tab__level-btn ${
                      level.id === selectedId ? 'is-active' : ''
                    }`}
                    onClick={() => setSelectedId(level.id)}
                  >
                    <Users size={15} aria-hidden />
                    <span className="price-levels-tab__level-name">{level.name}</span>
                    <span className="price-levels-tab__level-meta">
                      {level.dealerIds.length} dealers ·{' '}
                      {level.categoryRules.filter(categoryRuleHasEffect).length} rules
                    </span>
                  </button>
                  <button
                    type="button"
                    className="price-levels-tab__level-delete"
                    title="Delete level"
                    aria-label={`Delete ${level.name}`}
                    onClick={() => removeLevel(level.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="price-levels-tab__detail">
          {!selected ? (
            <p className="text-muted">Select or create a level to edit.</p>
          ) : (
            <>
              <label className="price-levels-tab__field">
                <span>Level name</span>
                <input
                  type="text"
                  value={selected.name}
                  onChange={e => updateSelected({ name: e.target.value })}
                  placeholder="e.g. Directors"
                />
              </label>

              <div className="price-levels-tab__block">
                <h4>
                  <UserPlus size={16} aria-hidden />
                  Dealers in this level
                </h4>
                <div className="price-levels-tab__dealer-search">
                  <Search size={16} aria-hidden />
                  <input
                    type="search"
                    value={dealerQuery}
                    onChange={e => setDealerQuery(e.target.value)}
                    placeholder="Search dealers by name, company, phone…"
                    autoComplete="off"
                  />
                  {dealersLoading ? <Loader2 size={14} className="spin-icon" aria-hidden /> : null}
                </div>
                {dealerSearchError ? (
                  <p className="price-levels-tab__error text-sm">{dealerSearchError}</p>
                ) : null}
                {dealerQuery.trim().length >= 2 && !dealersLoading && dealerHits.length === 0
                  && !dealerSearchError ? (
                  <p className="text-muted text-sm">No matching dealers.</p>
                ) : null}
                {dealerHits.length > 0 ? (
                  <ul className="price-levels-tab__dealer-hits">
                    {dealerHits.map(d => {
                      const already = selected.dealerIds.includes(d.id);
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            disabled={already}
                            onClick={() => addDealer(d)}
                          >
                            <strong>{dealerLabel(d)}</strong>
                            <span className="text-muted text-sm">
                              {[d.contactName, d.phone || d.mobile].filter(Boolean).join(' · ')}
                            </span>
                            {already ? <span className="text-muted">Added</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {selected.dealerIds.length === 0 ? (
                  <p className="text-muted text-sm">No dealers assigned yet.</p>
                ) : (
                  <ul className="price-levels-tab__dealer-chips">
                    {selected.dealerIds.map(id => (
                      <li key={id}>
                        <span>{dealerNames[id] || id}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${dealerNames[id] || id}`}
                          onClick={() => removeDealer(id)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="price-levels-tab__block">
                <h4>
                  <Percent size={16} aria-hidden />
                  Category pricing rules
                  {activeRuleCount > 0 ? (
                    <span className="price-levels-tab__rule-count">{activeRuleCount} active</span>
                  ) : null}
                </h4>
                <p className="text-muted text-sm">
                  Pick a category card (same as catalogue), then set discount or hike % and optional item overrides.
                </p>
                {categories.length === 0 ? (
                  <p className="text-muted text-sm">No catalog categories found.</p>
                ) : (
                  <>
                    <div className="catalog-categories catalog-categories--bare price-levels-tab__cat-grid">
                      <div className="catalog-categories__grid">
                        {categories.map((cat, idx) => {
                          const rule = rulesByCategoryId.get(cat.id);
                          const active = categoryRuleHasEffect(
                            rule ?? emptyCategoryRule(cat.id, cat.name),
                          );
                          const percent = rule?.percent ?? 0;
                          const mode = rule?.mode ?? 'discount';
                          const itemCount = rule?.itemRules.length ?? 0;
                          const badge = active
                            ? (percent > 0
                              ? `${mode === 'increment' ? '+' : '−'}${percent}%`
                              : `${itemCount} item${itemCount === 1 ? '' : 's'}`)
                            : null;
                          return (
                            <div
                              key={cat.id}
                              className={[
                                'price-levels-tab__cat-tile',
                                ruleCategoryId === cat.id ? 'is-selected' : '',
                                active ? 'is-active' : '',
                              ].filter(Boolean).join(' ')}
                            >
                              {badge ? (
                                <span className="price-levels-tab__cat-badge">{badge}</span>
                              ) : null}
                              <CategoryBrowseCard
                                category={cat}
                                index={idx}
                                onClick={() => {
                                  setRuleCategoryId(cat.id);
                                  setItemQuery('');
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {(() => {
                      const cat = categories.find(c => c.id === ruleCategoryId) ?? null;
                      if (!cat) {
                        return (
                          <p className="text-muted text-sm price-levels-tab__pick-hint">
                            Select a category card to edit its pricing rule.
                          </p>
                        );
                      }
                      const rule = rulesByCategoryId.get(cat.id);
                      const mode: PriceLevelRuleMode = rule?.mode ?? 'discount';
                      const percent = rule?.percent ?? 0;
                      const itemRules = rule?.itemRules ?? [];
                      const active = categoryRuleHasEffect(
                        rule ?? emptyCategoryRule(cat.id, cat.name),
                      );
                      const usedItemIds = new Set(itemRules.map(r => r.productId));
                      const catProducts = productsByCategory.get(cat.id) ?? [];
                      const itemHits = itemQuery.trim().length < 2
                        ? []
                        : catProducts
                          .filter(p => {
                            if (usedItemIds.has(p.id)) return false;
                            const q = itemQuery.trim().toLowerCase();
                            return p.name.toLowerCase().includes(q)
                              || (p.sku ?? '').toLowerCase().includes(q);
                          })
                          .slice(0, 12);

                      return (
                        <div className="price-levels-tab__rule-editor">
                          <div className="price-levels-tab__rule-editor-head">
                            <strong>{cat.name}</strong>
                            <button
                              type="button"
                              className="price-levels-tab__rule-delete"
                              aria-label={`Clear rule for ${cat.name}`}
                              title="Clear category + item rules"
                              disabled={!active}
                              onClick={() => clearCategoryRule(cat.id)}
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </div>
                          <div className="price-levels-tab__rule-main">
                            <select
                              value={mode}
                              onChange={e => upsertCategoryRule(cat, {
                                mode: e.target.value as PriceLevelRuleMode,
                              })}
                              aria-label={`Rule type for ${cat.name}`}
                            >
                              <option value="discount">Discount %</option>
                              <option value="increment">Price hike %</option>
                            </select>
                            <label className="price-levels-tab__percent">
                              <input
                                type="number"
                                min={0}
                                max={1000}
                                step={0.1}
                                value={percent === 0 ? '' : percent}
                                placeholder="0"
                                onChange={e => {
                                  const v = e.target.value;
                                  upsertCategoryRule(cat, {
                                    mode,
                                    percent: v === '' ? 0 : Number(v),
                                  });
                                }}
                                aria-label={`Percent for ${cat.name}`}
                              />
                              <span>%</span>
                            </label>
                          </div>

                          <div className="price-levels-tab__item-rules">
                            <div className="price-levels-tab__item-toggle">
                              Item rules
                              {itemRules.length > 0 ? ` (${itemRules.length})` : ''}
                            </div>
                            <div className="price-levels-tab__item-search">
                              <Search size={14} aria-hidden />
                              <input
                                type="search"
                                value={itemQuery}
                                onChange={e => setItemQuery(e.target.value)}
                                placeholder="Search item in this category…"
                                autoComplete="off"
                              />
                            </div>
                            {itemHits.length > 0 ? (
                              <ul className="price-levels-tab__item-hits">
                                {itemHits.map(product => (
                                  <li key={product.id} className="price-levels-tab__item-hit-row">
                                    <div className="price-levels-tab__item-hit-thumb" aria-hidden>
                                      {product.imageUrl ? (
                                        <CategoryThumbnail src={product.imageUrl} />
                                      ) : (
                                        <Package size={18} />
                                      )}
                                    </div>
                                    <div className="price-levels-tab__item-hit-body">
                                      <button
                                        type="button"
                                        className="price-levels-tab__item-hit"
                                        onClick={() => upsertItemRule(cat, product, {
                                          kind: 'except',
                                        })}
                                      >
                                        <strong>{product.name}</strong>
                                        <span className="text-muted text-sm">
                                          {[product.sku, `₹${product.rate.toLocaleString('en-IN')}`]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </span>
                                      </button>
                                      <div className="price-levels-tab__item-hit-actions">
                                        <button
                                          type="button"
                                          onClick={() => upsertItemRule(cat, product, {
                                            kind: 'except',
                                          })}
                                        >
                                          Except
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => upsertItemRule(cat, product, {
                                            kind: 'discount',
                                            percent: percent > 0 ? percent : 10,
                                          })}
                                        >
                                          Discount
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => upsertItemRule(cat, product, {
                                            kind: 'increment',
                                            percent: 5,
                                          })}
                                        >
                                          Hike
                                        </button>
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : itemQuery.trim().length >= 2 ? (
                              <p className="text-muted text-sm">No matching items in this category.</p>
                            ) : null}

                            {itemRules.length > 0 ? (
                              <ul className="price-levels-tab__item-list">
                                {itemRules.map(item => (
                                  <li key={item.productId}>
                                    <div className="price-levels-tab__item-meta">
                                      <strong>{item.productName}</strong>
                                      {item.sku ? (
                                        <span className="text-muted text-sm">{item.sku}</span>
                                      ) : null}
                                    </div>
                                    <select
                                      value={item.kind}
                                      onChange={e => updateItemRule(cat, item.productId, {
                                        kind: e.target.value as PriceLevelItemRuleKind,
                                      })}
                                      aria-label={`Override type for ${item.productName}`}
                                    >
                                      <option value="except">Except (list price)</option>
                                      <option value="discount">Special discount %</option>
                                      <option value="increment">Special hike %</option>
                                    </select>
                                    {item.kind === 'except' ? (
                                      <span className="price-levels-tab__item-except-label">
                                        No category %
                                      </span>
                                    ) : (
                                      <label className="price-levels-tab__percent">
                                        <input
                                          type="number"
                                          min={0}
                                          max={1000}
                                          step={0.1}
                                          value={item.percent === 0 ? '' : item.percent}
                                          placeholder="0"
                                          onChange={e => {
                                            const v = e.target.value;
                                            updateItemRule(cat, item.productId, {
                                              percent: v === '' ? 0 : Number(v),
                                            });
                                          }}
                                          aria-label={`Percent for ${item.productName}`}
                                        />
                                        <span>%</span>
                                      </label>
                                    )}
                                    <button
                                      type="button"
                                      className="price-levels-tab__rule-delete"
                                      aria-label={`Remove item rule for ${item.productName}`}
                                      onClick={() => removeItemRule(cat, item.productId)}
                                    >
                                      <X size={14} aria-hidden />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-muted text-sm">
                                No item overrides. Search above to except or special-price an item.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
