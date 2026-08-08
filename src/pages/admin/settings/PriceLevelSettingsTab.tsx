import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
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
import { ProductBrowseCard } from '../../../components/catalog/ProductBrowseCard';
import { SparePricingView } from '../../../components/catalog/SparePricingView';
import { useAuth } from '../../../context/AuthContext';
import {
  excludeHiddenCatalogProducts,
  fetchCatalog,
  getCatalogSparePartsPool,
  getShopCatalogCategories,
  getShopCatalogProducts,
  isGenericSparePartsCategory,
} from '../../../lib/catalog';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../../lib/dealer-cache';
import { dealerMatchesLogisticsQuery } from '../../../lib/logisticsDealers';
import {
  applyPriceLevelPercent,
  categoryRuleHasEffect,
  createEmptyPriceLevel,
  emptyCategoryRule,
  enforceUniqueDealerAssignments,
  isDefaultDealerPriceLevel,
  isSparePriceLevelCategoryId,
  loadPriceLevels,
  normalizePriceLevelSlabs,
  priceLevelsEqual,
  priceLevelsLiveSaveMs,
  savePriceLevels,
  SPARE_PRICE_LEVEL_CATEGORY_ID,
  SPARE_PRICE_LEVEL_CATEGORY_NAME,
  toggleRestrictedCategoryId,
} from '../../../lib/priceLevels';
import type { CatalogCategory, CatalogProduct } from '../../../types/catalog';
import type { ZohoDealer } from '../../../types/dealers';
import type {
  PriceLevel,
  PriceLevelCategoryRule,
  PriceLevelItemRule,
  PriceLevelItemRuleKind,
  PriceLevelQtySlab,
  PriceLevelRuleMode,
} from '../../../types/priceLevels';

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

type OverrideEditorDraft = {
  kind: PriceLevelItemRuleKind;
  percent: number;
  customRate: number;
  slabs: PriceLevelQtySlab[];
};

type OverrideEditorState = {
  category: CatalogCategory;
  product: CatalogProduct;
  draft: OverrideEditorDraft;
  isExisting: boolean;
};

function dealerLabel(d: Pick<ZohoDealer, 'contactName' | 'companyName' | 'id'>): string {
  return (d.companyName || d.contactName || d.id).trim();
}

function draftFromItemRule(rule: PriceLevelItemRule, listRate: number): OverrideEditorDraft {
  const slabs = rule.kind === 'fixed' ? normalizePriceLevelSlabs(rule.slabs) : [];
  return {
    kind: rule.kind,
    percent: rule.percent,
    customRate: rule.kind === 'fixed'
      ? (slabs[0]?.rate ?? rule.customRate ?? listRate)
      : listRate,
    slabs,
  };
}

function emptyOverrideDraft(listRate: number): OverrideEditorDraft {
  return {
    kind: 'fixed',
    percent: 0,
    customRate: listRate,
    slabs: [],
  };
}

function countAlteredItemRules(rule: PriceLevelCategoryRule | undefined): number {
  if (!rule) return 0;
  return rule.itemRules.filter(item => (
    item.kind === 'except'
    || item.kind === 'fixed'
    || item.slabs.length > 0
    || item.percent > 0
  )).length;
}

/** Badge on category tiles: global % and/or altered item count. */
function formatCategoryRuleBadge(
  mode: PriceLevelRuleMode,
  percent: number,
  alteredCount: number,
): string | null {
  const parts: string[] = [];
  if (percent > 0) {
    parts.push(`${mode === 'increment' ? '+' : '−'}${percent}%`);
  }
  if (alteredCount > 0) {
    parts.push(
      `${alteredCount} item${alteredCount === 1 ? '' : 's'}`,
    );
  }
  return parts.length ? parts.join(' · ') : null;
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

function formatOverrideMoney(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-IN', {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

/** Compact lines for product-grid override chips. */
function itemOverrideDisplay(rule: PriceLevelItemRule, listRate: number): {
  kindLabel: string;
  lines: Array<{ text: string; emphasize?: boolean }>;
} {
  if (rule.kind === 'except') {
    return {
      kindLabel: 'Except',
      lines: [{ text: `₹${formatOverrideMoney(listRate)}`, emphasize: true }],
    };
  }
  if (rule.kind === 'discount') {
    const effective = applyPriceLevelPercent(listRate, 'discount', rule.percent);
    return {
      kindLabel: 'Disc.',
      lines: [
        { text: `−${rule.percent}%` },
        { text: `₹${formatOverrideMoney(effective)}`, emphasize: true },
      ],
    };
  }
  if (rule.kind === 'increment') {
    const effective = applyPriceLevelPercent(listRate, 'increment', rule.percent);
    return {
      kindLabel: 'Hike',
      lines: [
        { text: `+${rule.percent}%` },
        { text: `₹${formatOverrideMoney(effective)}`, emphasize: true },
      ],
    };
  }
  const slabs = normalizePriceLevelSlabs(rule.slabs);
  if (slabs.length > 0) {
    return {
      kindLabel: 'Slabs',
      lines: slabs.map(s => ({
        text: `≥${s.minQty} · ₹${formatOverrideMoney(s.rate)}`,
      })),
    };
  }
  return {
    kindLabel: 'Custom',
    lines: [{ text: `₹${formatOverrideMoney(rule.customRate ?? 0)}`, emphasize: true }],
  };
}

export const PriceLevelSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [savedLevels, setSavedLevels] = useState<PriceLevel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Shop + synthetic Spare parts card (catalogue-aligned). */
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [spareProducts, setSpareProducts] = useState<CatalogProduct[]>([]);
  const [dealerNames, setDealerNames] = useState<Record<string, string>>({});
  const [allDealers, setAllDealers] = useState<ZohoDealer[]>(() => peekCachedDealers() ?? []);
  const [dealersLoading, setDealersLoading] = useState(() => !(peekCachedDealers()?.length));
  const [dealerSearchError, setDealerSearchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dealerQuery, setDealerQuery] = useState('');
  /** Level name + dealer assignment — rarely edited; collapsed by default. */
  const [showLevelMeta, setShowLevelMeta] = useState(false);
  /** Category selected from productsue-style grid for editing rules (Items mode). */
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  /** Category workspace: level overrides vs Costs & New sell. */
  const [spareWorkspace, setSpareWorkspace] = useState<'overrides' | 'costs'>('overrides');
  /** Filters the product browse grid in Items mode only. */
  const [itemQuery, setItemQuery] = useState('');
  const [overrideEditor, setOverrideEditor] = useState<OverrideEditorState | null>(null);
  /** Flat discount/hike applied to every category on the selected level. */
  const [flatAllMode, setFlatAllMode] = useState<PriceLevelRuleMode>('discount');
  const [flatAllPercent, setFlatAllPercent] = useState<number | ''>('');

  const levelsRef = useRef(levels);
  const savedRef = useRef(savedLevels);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveEpochRef = useRef(0);
  const itemsChromeRef = useRef<HTMLDivElement | null>(null);
  const itemsModeRef = useRef<HTMLDivElement | null>(null);
  const userUid = user?.uid ?? null;

  /** Keep Costs & New sell toolbar stuck below category chrome. */
  useEffect(() => {
    const chrome = itemsChromeRef.current;
    const mode = itemsModeRef.current;
    if (!chrome || !mode || spareWorkspace !== 'costs') return undefined;
    const apply = () => {
      mode.style.setProperty(
        '--price-levels-items-chrome-height',
        `${Math.ceil(chrome.getBoundingClientRect().height)}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [spareWorkspace, selectedId, ruleCategoryId]);

  const exitCategoryEdit = useCallback(() => {
    setRuleCategoryId(null);
    setItemQuery('');
    setOverrideEditor(null);
    setSpareWorkspace('overrides');
  }, []);

  useEffect(() => {
    setFlatAllMode('discount');
    setFlatAllPercent('');
  }, [selectedId]);

  levelsRef.current = levels;
  savedRef.current = savedLevels;

  const selected = useMemo(
    () => levels.find(l => l.id === selectedId) ?? null,
    [levels, selectedId],
  );

  const selectedIsDefault = selected ? isDefaultDealerPriceLevel(selected) : false;

  const unassignedDealerCount = useMemo(() => {
    const assigned = new Set(
      levels
        .filter(level => !isDefaultDealerPriceLevel(level))
        .flatMap(level => level.dealerIds),
    );
    return allDealers.filter(d => d.id && !assigned.has(d.id)).length;
  }, [levels, allDealers]);

  useEffect(() => {
    setRuleCategoryId(null);
    setItemQuery('');
    setShowLevelMeta(false);
    setDealerQuery('');
    setOverrideEditor(null);
    setSpareWorkspace('overrides');
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
      if (!catId || isGenericSparePartsCategory({ name: product.categoryName || '' })) {
        continue;
      }
      const list = map.get(catId) ?? [];
      list.push(product);
      map.set(catId, list);
    }
    const spares = [...spareProducts].sort((a, b) => a.name.localeCompare(b.name));
    map.set(SPARE_PRICE_LEVEL_CATEGORY_ID, spares);
    for (const [key, list] of map.entries()) {
      if (key === SPARE_PRICE_LEVEL_CATEGORY_ID) continue;
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [products, spareProducts]);

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

      const allItems = catalog.items ?? [];
      const allCats = catalog.categories ?? [];
      const shopProducts = excludeHiddenCatalogProducts(
        getShopCatalogProducts(allItems, allCats),
        allCats,
      );
      const spares = getCatalogSparePartsPool(allItems, allCats);
      setProducts(shopProducts);
      setSpareProducts(spares);

      // Same category cards as catalogue Categories tab, but one Spare parts card
      // for the full spare pool (generic + uncategorized) — not Zoho generic alone.
      const shopCats = getShopCatalogCategories(allCats, shopProducts, spares)
        .filter(c => !isGenericSparePartsCategory(c));
      const spareCard: CatalogCategory = {
        id: SPARE_PRICE_LEVEL_CATEGORY_ID,
        name: SPARE_PRICE_LEVEL_CATEGORY_NAME,
        productCount: spares.length,
        displayOrder: 9999,
        thumbnailUrl: allCats.find(isGenericSparePartsCategory)?.thumbnailUrl ?? null,
      };
      setCategories(spares.length > 0 ? [...shopCats, spareCard] : shopCats);

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
    if (isDefaultDealerPriceLevel(id)) return;
    patchLevels(prev => prev.filter(l => l.id !== id));
    setSelectedId(prev => {
      if (prev !== id) return prev;
      const remaining = levels.filter(l => l.id !== id);
      return remaining[0]?.id ?? null;
    });
  };

  const updateSelected = (patch: Partial<PriceLevel>) => {
    if (!selectedId) return;
    patchLevels(prev => prev.map(l => {
      if (l.id !== selectedId) return l;
      if (isDefaultDealerPriceLevel(l)) {
        // Catch-all: pricing + visibility — name/dealers are fixed.
        return {
          ...l,
          ...(patch.categoryRules !== undefined ? { categoryRules: patch.categoryRules } : {}),
          ...(patch.restrictedCategoryIds !== undefined
            ? { restrictedCategoryIds: patch.restrictedCategoryIds }
            : {}),
          ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
          dealerIds: [],
        };
      }
      return { ...l, ...patch };
    }));
  };

  const setCategoryRestricted = (categoryId: string, restricted: boolean) => {
    if (!selected) return;
    const next = toggleRestrictedCategoryId(selected, categoryId, restricted);
    updateSelected({ restrictedCategoryIds: next.restrictedCategoryIds });
  };

  const addDealer = (dealer: ZohoDealer) => {
    if (!selected || isDefaultDealerPriceLevel(selected)) return;
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
    if (!selected || isDefaultDealerPriceLevel(selected)) return;
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

  /** Same discount/hike % on every category; keeps per-item overrides. */
  const applyFlatRuleToAllCategories = (
    mode: PriceLevelRuleMode,
    percentRaw: number | '',
  ) => {
    if (!selected || categories.length === 0) return;
    const percent = percentRaw === '' || !Number.isFinite(Number(percentRaw))
      ? 0
      : Math.max(0, Math.min(1000, Number(percentRaw)));
    const knownIds = new Set(categories.map(cat => cat.id));
    const preserved = selected.categoryRules.filter(rule => !knownIds.has(rule.categoryId));
    const nextRules: PriceLevelCategoryRule[] = [];
    for (const cat of categories) {
      const existing = rulesByCategoryId.get(cat.id);
      const itemRules = existing?.itemRules ?? [];
      if (percent <= 0 && itemRules.length === 0) continue;
      nextRules.push({
        categoryId: cat.id,
        categoryName: cat.name,
        mode,
        percent,
        itemRules,
      });
    }
    updateSelected({ categoryRules: [...preserved, ...nextRules] });
    setFlatAllMode(mode);
    setFlatAllPercent(percent > 0 ? percent : '');
  };

  const upsertItemRule = (
    category: CatalogCategory,
    product: CatalogProduct,
    patch: Partial<Pick<PriceLevelItemRule, 'kind' | 'percent' | 'customRate' | 'slabs'>>,
  ) => {
    const existing = ensureCategoryRule(category);
    const prevItem = existing.itemRules.find(r => r.productId === product.id);
    const kind: PriceLevelItemRuleKind = patch.kind ?? prevItem?.kind ?? 'fixed';
    const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
    const slabs = kind === 'fixed'
      ? normalizePriceLevelSlabs(patch.slabs !== undefined ? patch.slabs : (prevItem?.slabs ?? []))
      : [];
    const customRate = kind === 'fixed'
      ? (slabs.length > 0
        ? slabs[0].rate
        : (patch.customRate !== undefined
          ? patch.customRate
          : (prevItem?.customRate ?? listRate)))
      : null;
    const nextItem: PriceLevelItemRule = {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      kind,
      percent: kind === 'except' || kind === 'fixed'
        ? 0
        : (patch.percent !== undefined ? patch.percent : (prevItem?.percent ?? 0)),
      customRate,
      slabs,
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
    setRuleCategoryId(category.id);
  };

  const openOverrideEditor = (category: CatalogCategory, product: CatalogProduct) => {
    const existingRule = selected?.categoryRules
      .find(r => r.categoryId === category.id)
      ?.itemRules.find(r => r.productId === product.id) ?? null;
    const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
    setOverrideEditor({
      category,
      product,
      isExisting: Boolean(existingRule),
      draft: existingRule
        ? draftFromItemRule(existingRule, listRate)
        : emptyOverrideDraft(listRate),
    });
  };

  const patchOverrideDraft = (patch: Partial<OverrideEditorDraft>) => {
    setOverrideEditor(prev => {
      if (!prev) return prev;
      const nextKind = patch.kind ?? prev.draft.kind;
      let nextSlabs = patch.slabs !== undefined ? patch.slabs : prev.draft.slabs;
      let nextCustom = patch.customRate !== undefined ? patch.customRate : prev.draft.customRate;
      let nextPercent = patch.percent !== undefined ? patch.percent : prev.draft.percent;
      if (patch.kind && patch.kind !== prev.draft.kind) {
        if (nextKind !== 'fixed') {
          nextSlabs = [];
        }
        if (nextKind === 'except' || nextKind === 'fixed') {
          nextPercent = 0;
        }
        if (nextKind === 'fixed' && nextSlabs.length === 0 && nextCustom <= 0) {
          nextCustom = Math.round((Number(prev.product.rate) || 0) * 100) / 100;
        }
      }
      return {
        ...prev,
        draft: {
          kind: nextKind,
          percent: nextPercent,
          customRate: nextCustom,
          // Keep editor order as typed — sorting/deduping here remounts inputs and steals focus.
          slabs: nextKind === 'fixed' ? nextSlabs : [],
        },
      };
    });
  };

  const closeOverrideEditor = () => setOverrideEditor(null);

  const saveOverrideEditor = () => {
    if (!overrideEditor) return;
    const { category, product, draft } = overrideEditor;
    upsertItemRule(category, product, {
      kind: draft.kind,
      percent: draft.percent,
      customRate: draft.customRate,
      slabs: draft.kind === 'fixed' ? normalizePriceLevelSlabs(draft.slabs) : [],
    });
    setOverrideEditor(null);
  };

  useEffect(() => {
    if (!overrideEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverrideEditor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overrideEditor]);

  const removeItemRule = (category: CatalogCategory, productId: string) => {
    const existing = ensureCategoryRule(category);
    const itemRules = existing.itemRules.filter(r => r.productId !== productId);
    if (existing.percent <= 0 && itemRules.length === 0) {
      clearCategoryRule(category.id);
      return;
    }
    replaceCategoryRule({ ...existing, itemRules });
  };

  const removeOverrideFromEditor = () => {
    if (!overrideEditor?.isExisting) return;
    removeItemRule(overrideEditor.category, overrideEditor.product.id);
    setOverrideEditor(null);
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
      <div className="price-levels-tab price-levels-tab--loading">
        <Loader2 className="spin-icon" size={22} aria-hidden />
        <p className="text-muted">Loading price levels…</p>
      </div>
    );
  }

  return (
    <div className="price-levels-tab">
      <header className="price-levels-tab__header">
        <div>
          <h3>Price level setting</h3>
          <p className="text-muted text-sm">
            Create levels, assign dealers, and set category discount or hike %.
            Each category has Level overrides (Custom ₹ / %) and Costs & New sell —
            single source for dealer charge rules. Changes save automatically.
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

      <div className="price-levels-tab__levels-bar">
        <label className="price-levels-tab__level-picker" htmlFor="price-level-select">
          <span>Level</span>
          <select
            id="price-level-select"
            value={selectedId ?? ''}
            onChange={event => setSelectedId(event.target.value || null)}
            aria-label="Select price level"
          >
            {levels.length === 0 ? (
              <option value="">No levels yet</option>
            ) : null}
            {levels.map(level => {
              const isDefault = isDefaultDealerPriceLevel(level);
              const rules = level.categoryRules.filter(categoryRuleHasEffect).length;
              const dealersLabel = isDefault
                ? `All others${allDealers.length ? ` (${unassignedDealerCount})` : ''}`
                : `${level.dealerIds.length} dealer${level.dealerIds.length === 1 ? '' : 's'}`;
              return (
                <option key={level.id} value={level.id}>
                  {level.name}
                  {isDefault ? ' (default)' : ''}
                  {' — '}
                  {dealersLabel}
                  {' · '}
                  {rules}
                  {' '}
                  rule
                  {rules === 1 ? '' : 's'}
                </option>
              );
            })}
          </select>
        </label>
        <div className="price-levels-tab__level-actions">
          {selected && !selectedIsDefault ? (
            <button
              type="button"
              className="btn btn-sm btn-secondary price-levels-tab__level-delete-btn"
              title="Delete level"
              aria-label={`Delete ${selected.name}`}
              onClick={() => removeLevel(selected.id)}
            >
              <Trash2 size={14} aria-hidden />
              Delete
            </button>
          ) : null}
          <button type="button" className="btn btn-sm btn-primary" onClick={addLevel}>
            <Plus size={14} aria-hidden />
            Add
          </button>
        </div>
      </div>

      <section className="price-levels-tab__detail">
          {!selected ? (
            <p className="text-muted">Select or create a level to edit.</p>
          ) : (
            <>
              <div className="price-levels-tab__meta">
                <button
                  type="button"
                  className={`price-levels-tab__meta-toggle ${showLevelMeta ? 'is-open' : ''}`}
                  aria-expanded={showLevelMeta}
                  onClick={() => setShowLevelMeta(open => !open)}
                >
                  <Users size={15} aria-hidden />
                  <span>Level name & dealers</span>
                  <span className="price-levels-tab__meta-summary">
                    {selectedIsDefault
                      ? `All unassigned${allDealers.length ? ` (${unassignedDealerCount})` : ''}`
                      : `${selected.dealerIds.length} dealer${selected.dealerIds.length === 1 ? '' : 's'}`}
                  </span>
                  <ChevronDown size={16} aria-hidden />
                </button>
                {showLevelMeta ? (
                  <div className="price-levels-tab__meta-body">
                    <label className="price-levels-tab__field price-levels-tab__field--inline">
                      <span>Level name</span>
                      <input
                        type="text"
                        value={selected.name}
                        onChange={e => updateSelected({ name: e.target.value })}
                        placeholder="e.g. Directors"
                        disabled={selectedIsDefault}
                        readOnly={selectedIsDefault}
                      />
                    </label>

                    {selectedIsDefault ? (
                      <div className="price-levels-tab__block">
                        <h4>
                          <Users size={16} aria-hidden />
                          Default catch-all
                        </h4>
                        <p className="text-muted text-sm">
                          Covers every dealer who is not assigned to another level
                          {allDealers.length
                            ? ` (${unassignedDealerCount} of ${allDealers.length} right now)`
                            : ''}
                          . Assign dealers to Directors / Agents / etc. to exclude them from this level.
                        </p>
                      </div>
                    ) : (
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
                    )}
                  </div>
                ) : null}
              </div>

              <div className="price-levels-tab__block">
                <h4>
                  <Percent size={16} aria-hidden />
                  Category pricing rules
                  {activeRuleCount > 0 ? (
                    <span className="price-levels-tab__rule-count">{activeRuleCount} active</span>
                  ) : null}
                </h4>
                {categories.length === 0 ? (
                  <p className="text-muted text-sm">No catalog categories found.</p>
                ) : (() => {
                  const editCat = categories.find(c => c.id === ruleCategoryId) ?? null;
                  if (!editCat) {
                    return (
                      <>
                        <p className="text-muted text-sm price-levels-tab__visibility-legend">
                          <Eye size={14} aria-hidden />
                          {' '}
                          Show (default) /
                          {' '}
                          <EyeOff size={14} aria-hidden />
                          {' '}
                          Hide — hidden categories and their items are invisible to dealers on this level.
                          {selected.restrictedCategoryIds.length > 0
                            ? ` ${selected.restrictedCategoryIds.length} hidden.`
                            : ''}
                        </p>
                        <div className="price-levels-tab__flat-all" aria-label="Flat rule for all categories">
                          <div className="price-levels-tab__flat-all-main">
                            <div
                              className="price-levels-tab__mode-toggle"
                              role="group"
                              aria-label="Flat discount or hike for all categories"
                            >
                              <button
                                type="button"
                                className={flatAllMode === 'discount' ? 'is-active' : ''}
                                onClick={() => setFlatAllMode('discount')}
                              >
                                Discount
                              </button>
                              <button
                                type="button"
                                className={flatAllMode === 'increment' ? 'is-active' : ''}
                                onClick={() => setFlatAllMode('increment')}
                              >
                                Hike
                              </button>
                            </div>
                            <label className="price-levels-tab__percent">
                              <input
                                type="number"
                                min={0}
                                max={1000}
                                step={0.1}
                                value={flatAllPercent === '' ? '' : flatAllPercent}
                                placeholder="0"
                                onChange={e => {
                                  const v = e.target.value;
                                  setFlatAllPercent(v === '' ? '' : Number(v));
                                }}
                                aria-label="Flat percent for all categories"
                              />
                              <span>%</span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={categories.length === 0}
                              onClick={() => applyFlatRuleToAllCategories(flatAllMode, flatAllPercent)}
                            >
                              Apply to all
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              disabled={categories.length === 0}
                              onClick={() => applyFlatRuleToAllCategories(flatAllMode, 0)}
                              title="Clear category % on every category (item overrides stay)"
                            >
                              Clear %
                            </button>
                          </div>
                          <p className="text-muted text-sm price-levels-tab__flat-all-hint">
                            Sets the same
                            {' '}
                            {flatAllMode === 'increment' ? 'hike' : 'discount'}
                            {' '}
                            on every category for this level. Per-item overrides are kept.
                            Tap a category to fine-tune.
                          </p>
                        </div>
                        <div className="catalog-categories catalog-categories--bare price-levels-tab__cat-grid">
                          <div className="catalog-categories__grid">
                            {categories.map((cat, idx) => {
                              const isSpare = isSparePriceLevelCategoryId(cat.id);
                              const rule = rulesByCategoryId.get(cat.id);
                              const active = categoryRuleHasEffect(
                                rule ?? emptyCategoryRule(cat.id, cat.name),
                              );
                              const percent = rule?.percent ?? 0;
                              const mode = rule?.mode ?? 'discount';
                              const alteredCount = countAlteredItemRules(rule);
                              const badge = active
                                ? formatCategoryRuleBadge(mode, percent, alteredCount)
                                : null;
                              const restricted = selected.restrictedCategoryIds.includes(cat.id);
                              return (
                                <div
                                  key={cat.id}
                                  className={[
                                    'price-levels-tab__cat-tile',
                                    isSpare ? 'is-spare' : '',
                                    active ? 'is-active' : '',
                                    restricted ? 'is-restricted' : 'is-permitted',
                                  ].filter(Boolean).join(' ')}
                                >
                                  {badge ? (
                                    <span className="price-levels-tab__cat-badge">{badge}</span>
                                  ) : null}
                                  <div
                                    className="price-levels-tab__visibility"
                                    role="group"
                                    aria-label={`Visibility for ${cat.name}`}
                                  >
                                    <button
                                      type="button"
                                      className={`price-levels-tab__visibility-btn${restricted ? '' : ' is-active'}`}
                                      title="Permitted — dealers on this level can see this category"
                                      aria-pressed={!restricted}
                                      onClick={event => {
                                        event.stopPropagation();
                                        setCategoryRestricted(cat.id, false);
                                      }}
                                    >
                                      <Eye size={13} aria-hidden />
                                      <span>Show</span>
                                    </button>
                                    <button
                                      type="button"
                                      className={`price-levels-tab__visibility-btn is-restrict${restricted ? ' is-active' : ''}`}
                                      title="Restricted — dealers on this level cannot see this category"
                                      aria-pressed={restricted}
                                      onClick={event => {
                                        event.stopPropagation();
                                        setCategoryRestricted(cat.id, true);
                                      }}
                                    >
                                      <EyeOff size={13} aria-hidden />
                                      <span>Hide</span>
                                    </button>
                                  </div>
                                  <CategoryBrowseCard
                                    category={cat}
                                    index={idx}
                                    simple={isSpare}
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
                      </>
                    );
                  }

                  const rule = rulesByCategoryId.get(editCat.id);
                  const mode: PriceLevelRuleMode = rule?.mode ?? 'discount';
                  const percent = rule?.percent ?? 0;
                  const itemRules = rule?.itemRules ?? [];
                  const active = categoryRuleHasEffect(
                    rule ?? emptyCategoryRule(editCat.id, editCat.name),
                  );
                  const itemRuleById = new Map(itemRules.map(r => [r.productId, r]));
                  const isSpareEdit = isSparePriceLevelCategoryId(editCat.id);
                  const catProducts = productsByCategory.get(editCat.id) ?? [];
                  const q = itemQuery.trim().toLowerCase();
                  const browseProducts = q
                    ? catProducts.filter(p => (
                      p.name.toLowerCase().includes(q)
                      || (p.sku ?? '').toLowerCase().includes(q)
                    ))
                    : catProducts;

                  const costsProducts = isSpareEdit ? spareProducts : catProducts;

                  return (
                    <div
                      ref={itemsModeRef}
                      className={[
                        'price-levels-tab__items-mode',
                        'price-levels-tab__items-mode--spare',
                        spareWorkspace === 'costs'
                          ? 'price-levels-tab__items-mode--spare-costs'
                          : '',
                      ].filter(Boolean).join(' ')}
                      aria-label={`${editCat.name} pricing`}
                    >
                      <div
                        ref={itemsChromeRef}
                        className="price-levels-tab__items-chrome"
                      >
                        <div className="price-levels-tab__items-chrome-row">
                          <button
                            type="button"
                            className="price-levels-tab__back"
                            onClick={exitCategoryEdit}
                          >
                            <ArrowLeft size={15} aria-hidden />
                            Categories
                          </button>
                          <div className="price-levels-tab__items-chrome-title">
                            <strong>{editCat.name}</strong>
                            {isSpareEdit ? (
                              <span className="price-levels-tab__spare-hint">
                                Generic + uncategorized pool
                              </span>
                            ) : null}
                            {active ? (
                              <span className="price-levels-tab__rule-editor-pill">
                                {formatCategoryRuleBadge(
                                  mode,
                                  percent,
                                  countAlteredItemRules(rule),
                                )}
                              </span>
                            ) : (
                              <span className="price-levels-tab__rule-editor-pill is-muted">
                                No rule yet
                              </span>
                            )}
                          </div>
                          <div className="price-levels-tab__rule-editor-actions">
                            <button
                              type="button"
                              className="price-levels-tab__rule-delete"
                              aria-label={`Clear rule for ${editCat.name}`}
                              title="Clear category + item rules"
                              disabled={!active}
                              onClick={() => clearCategoryRule(editCat.id)}
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="price-levels-tab__rule-close"
                              aria-label="Close and return to categories"
                              title="Close"
                              onClick={exitCategoryEdit}
                            >
                              <X size={15} aria-hidden />
                            </button>
                          </div>
                        </div>

                        <div
                          className="price-levels-tab__mode-toggle price-levels-tab__spare-workspace"
                          role="tablist"
                          aria-label={`${editCat.name} workspace`}
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={spareWorkspace === 'overrides'}
                            className={spareWorkspace === 'overrides' ? 'is-active' : ''}
                            onClick={() => setSpareWorkspace('overrides')}
                          >
                            Level overrides
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={spareWorkspace === 'costs'}
                            className={spareWorkspace === 'costs' ? 'is-active' : ''}
                            onClick={() => setSpareWorkspace('costs')}
                          >
                            Costs & New sell
                          </button>
                        </div>
                        <p className="price-levels-tab__workspace-hint text-muted text-sm">
                          Costs set list price; Level overrides set what each tier pays vs list.
                        </p>

                        {spareWorkspace === 'overrides' ? (
                          <div className="price-levels-tab__rule-main">
                            <div
                              className="price-levels-tab__mode-toggle"
                              role="group"
                              aria-label={`Rule type for ${editCat.name}`}
                            >
                              <button
                                type="button"
                                className={mode === 'discount' ? 'is-active' : ''}
                                onClick={() => upsertCategoryRule(editCat, { mode: 'discount' })}
                              >
                                Discount
                              </button>
                              <button
                                type="button"
                                className={mode === 'increment' ? 'is-active' : ''}
                                onClick={() => upsertCategoryRule(editCat, { mode: 'increment' })}
                              >
                                Hike
                              </button>
                            </div>
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
                                  upsertCategoryRule(editCat, {
                                    mode,
                                    percent: v === '' ? 0 : Number(v),
                                  });
                                }}
                                aria-label={`Percent for ${editCat.name}`}
                              />
                              <span>%</span>
                            </label>
                          </div>
                        ) : null}
                      </div>

                      {spareWorkspace === 'costs' ? (
                        <div className="price-levels-tab__spare-costs">
                          <SparePricingView
                            products={costsProducts}
                            priceLevelCategoryId={editCat.id}
                            priceLevelCategoryName={editCat.name}
                            onProductRatesSaved={updates => {
                              if (!updates.length) return;
                              const byId = new Map(updates.map(u => [u.productId, u.rate]));
                              if (isSpareEdit) {
                                setSpareProducts(prev => prev.map(p => (
                                  byId.has(p.id) ? { ...p, rate: byId.get(p.id)! } : p
                                )));
                              }
                              setProducts(prev => prev.map(p => (
                                byId.has(p.id) ? { ...p, rate: byId.get(p.id)! } : p
                              )));
                            }}
                            onProductHidden={productId => {
                              if (isSpareEdit) {
                                setSpareProducts(prev => prev.filter(p => p.id !== productId));
                              }
                              setProducts(prev => prev.filter(p => p.id !== productId));
                            }}
                            onPriceLevelsChanged={next => {
                              setLevels(next);
                              setSavedLevels(next);
                            }}
                          />
                        </div>
                      ) : null}

                      {spareWorkspace === 'overrides' ? (
                      <div className="price-levels-tab__browse-head">
                        <span className="price-levels-tab__browse-label">
                          {isSpareEdit ? 'Browse spares' : 'Browse items'}
                          <span className="text-muted">
                            {' '}· {browseProducts.length}
                            {q ? ` of ${catProducts.length}` : ''}
                            {itemRules.length > 0
                              ? ` · ${itemRules.length} override${itemRules.length === 1 ? '' : 's'}`
                              : ''}
                          </span>
                        </span>
                        <div className="price-levels-tab__item-search">
                          <Search size={14} aria-hidden />
                          <input
                            type="search"
                            value={itemQuery}
                            onChange={e => setItemQuery(e.target.value)}
                            placeholder={isSpareEdit ? 'Filter spares…' : 'Filter products…'}
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      ) : null}

                      {spareWorkspace === 'overrides' ? (
                        browseProducts.length === 0 ? (
                          <p className="text-muted text-sm">
                            {catProducts.length === 0
                              ? (isSpareEdit ? 'No spare parts in catalog.' : 'No products in this category.')
                              : 'No products match this filter.'}
                          </p>
                        ) : (
                          <div className="price-levels-tab__product-grid catalog-grid catalog-grid--tiles">
                            {browseProducts.map((product, idx) => {
                              const override = itemRuleById.get(product.id) ?? null;
                              const overrideView = override
                                ? itemOverrideDisplay(override, product.rate)
                                : null;
                              return (
                                <div
                                  key={product.id}
                                  className={[
                                    'price-levels-tab__product-tile',
                                    override ? 'is-override' : '',
                                  ].filter(Boolean).join(' ')}
                                >
                                  {overrideView ? (
                                    <div
                                      className="price-levels-tab__product-override"
                                      aria-label={`${overrideView.kindLabel}: ${overrideView.lines.map(l => l.text).join(', ')}`}
                                    >
                                      <span className="price-levels-tab__product-override-kind">
                                        {overrideView.kindLabel}
                                      </span>
                                      <ul>
                                        {overrideView.lines.map(line => (
                                          <li
                                            key={line.text}
                                            className={line.emphasize
                                              ? 'price-levels-tab__product-override-rate'
                                              : undefined}
                                          >
                                            {line.text}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  <ProductBrowseCard
                                    product={product}
                                    index={idx}
                                    enableCart={false}
                                    onSelect={() => openOverrideEditor(editCat, product)}
                                    highlighted={overrideEditor?.product.id === product.id}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </>
          )}
      </section>

      {overrideEditor ? (() => {
        const { product, draft, isExisting } = overrideEditor;
        const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
        const editorSlabs = draft.kind === 'fixed' ? draft.slabs : [];
        const hasSlabs = editorSlabs.length > 0;
        const previewSlabs = hasSlabs ? normalizePriceLevelSlabs(editorSlabs) : [];
        const percentEffective = draft.kind === 'discount' || draft.kind === 'increment'
          ? applyPriceLevelPercent(
            listRate,
            draft.kind === 'increment' ? 'increment' : 'discount',
            draft.percent,
          )
          : null;
        const preview = itemOverrideDisplay(
          {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            kind: draft.kind,
            percent: draft.percent,
            customRate: draft.customRate,
            slabs: previewSlabs,
          },
          listRate,
        );
        return (
          <div
            className="price-levels-tab__editor-backdrop"
            role="presentation"
            onClick={closeOverrideEditor}
          >
            <div
              className="price-levels-tab__editor"
              role="dialog"
              aria-modal="true"
              aria-label={`${isExisting ? 'Edit' : 'Add'} override for ${product.name}`}
              onClick={e => e.stopPropagation()}
            >
              <header className="price-levels-tab__editor-head">
                <div className="price-levels-tab__editor-product">
                  <div className="price-levels-tab__item-thumb" aria-hidden>
                    {product.imageUrl ? (
                      <CategoryThumbnail src={product.imageUrl} />
                    ) : (
                      <Package size={16} />
                    )}
                  </div>
                  <div className="price-levels-tab__item-meta">
                    <strong title={product.name}>{product.name}</strong>
                    <span className="text-muted">
                      {[product.sku, `List ₹${formatOverrideMoney(listRate)}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="price-levels-tab__rule-delete"
                  aria-label="Close"
                  onClick={closeOverrideEditor}
                >
                  <X size={16} aria-hidden />
                </button>
              </header>

              <div className="price-levels-tab__editor-body">
                <label className="price-levels-tab__editor-field">
                  <span>Override type</span>
                  <select
                    value={draft.kind}
                    onChange={e => patchOverrideDraft({
                      kind: e.target.value as PriceLevelItemRuleKind,
                    })}
                  >
                    <option value="fixed">Custom ₹</option>
                    <option value="except">Except (list price)</option>
                    <option value="discount">Discount %</option>
                    <option value="increment">Hike %</option>
                  </select>
                </label>

                {draft.kind === 'except' ? (
                  <p className="text-muted text-sm price-levels-tab__editor-hint">
                    Charges list price and ignores the category %.
                  </p>
                ) : null}

                {draft.kind === 'fixed' && !hasSlabs ? (
                  <label className="price-levels-tab__editor-field">
                    <span>Custom unit price</span>
                    <span className="price-levels-tab__custom-rate">
                      <span>₹</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={draft.customRate === 0 ? '' : draft.customRate}
                        placeholder="0"
                        onChange={e => {
                          const v = e.target.value;
                          patchOverrideDraft({
                            customRate: v === '' ? 0 : Number(v),
                            slabs: [],
                          });
                        }}
                      />
                    </span>
                  </label>
                ) : null}

                {draft.kind === 'discount' || draft.kind === 'increment' ? (
                  <label className="price-levels-tab__editor-field">
                    <span>{draft.kind === 'discount' ? 'Discount' : 'Hike'}</span>
                    <span className="price-levels-tab__editor-percent-row">
                      <span className="price-levels-tab__percent">
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          step={0.1}
                          value={draft.percent === 0 ? '' : draft.percent}
                          placeholder="0"
                          onChange={e => {
                            const v = e.target.value;
                            patchOverrideDraft({ percent: v === '' ? 0 : Number(v) });
                          }}
                        />
                        <span>%</span>
                      </span>
                      {percentEffective != null ? (
                        <span className="price-levels-tab__item-effective">
                          → ₹{formatOverrideMoney(percentEffective)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ) : null}

                {draft.kind === 'fixed' ? (
                  <div className="price-levels-tab__editor-slabs">
                    <div className="price-levels-tab__editor-slabs-head">
                      <span>Qty slabs</span>
                      <span className="text-muted text-sm">Optional tiered unit rates</span>
                    </div>
                    {hasSlabs ? (
                      <table className="price-levels-tab__slabs-table">
                        <thead>
                          <tr>
                            <th scope="col">Qty</th>
                            <th scope="col">₹</th>
                            <th scope="col" aria-label="Remove" />
                          </tr>
                        </thead>
                        <tbody>
                          {editorSlabs.map((slab, slabIdx) => (
                            <tr key={`editor-slab-${slabIdx}`}>
                              <td>
                                <label className="price-levels-tab__slabs-qty">
                                  <span>≥</span>
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={slab.minQty === 0 ? '' : slab.minQty}
                                    onChange={e => {
                                      const v = e.target.value;
                                      const next = [...editorSlabs];
                                      next[slabIdx] = {
                                        ...slab,
                                        // Allow empty while typing; clamp on save via normalize.
                                        minQty: v === ''
                                          ? 0
                                          : Math.max(1, Math.floor(Number(v) || 0)),
                                      };
                                      patchOverrideDraft({ slabs: next });
                                    }}
                                  />
                                </label>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={slab.rate === 0 ? '' : slab.rate}
                                  placeholder="0"
                                  onChange={e => {
                                    const v = e.target.value;
                                    const next = [...editorSlabs];
                                    next[slabIdx] = {
                                      ...slab,
                                      rate: v === '' ? 0 : Number(v),
                                    };
                                    patchOverrideDraft({ slabs: next });
                                  }}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="price-levels-tab__rule-delete"
                                  aria-label={
                                    editorSlabs.length <= 1
                                      ? 'Clear qty slabs'
                                      : `Remove slab ${slabIdx + 1}`
                                  }
                                  onClick={() => {
                                    const next = editorSlabs.filter((_, i) => i !== slabIdx);
                                    if (next.length === 0) {
                                      patchOverrideDraft({
                                        slabs: [],
                                        customRate: slab.rate || listRate,
                                      });
                                      return;
                                    }
                                    patchOverrideDraft({ slabs: next });
                                  }}
                                >
                                  <X size={12} aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))}
                          <tr className="price-levels-tab__slabs-add-row">
                            <td colSpan={3}>
                              <button
                                type="button"
                                className="price-levels-tab__slabs-add"
                                onClick={() => {
                                  const base = editorSlabs.length > 0
                                    ? editorSlabs
                                    : [{ minQty: 1, rate: draft.customRate || listRate }];
                                  const last = base[base.length - 1];
                                  patchOverrideDraft({
                                    slabs: [
                                      ...base,
                                      {
                                        minQty: (last?.minQty ?? 1) + 10,
                                        rate: last?.rate ?? (draft.customRate || listRate),
                                      },
                                    ],
                                  });
                                }}
                              >
                                <Plus size={12} aria-hidden />
                                Slab
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <button
                        type="button"
                        className="price-levels-tab__slabs-add"
                        onClick={() => {
                          patchOverrideDraft({
                            slabs: [
                              { minQty: 1, rate: draft.customRate || listRate },
                              { minQty: 11, rate: draft.customRate || listRate },
                            ],
                          });
                        }}
                      >
                        <Plus size={12} aria-hidden />
                        Add qty slabs
                      </button>
                    )}
                  </div>
                ) : null}

                <div className="price-levels-tab__editor-preview" aria-live="polite">
                  <span className="price-levels-tab__product-override-kind">
                    {preview.kindLabel}
                  </span>
                  <ul>
                    {preview.lines.map(line => (
                      <li
                        key={line.text}
                        className={line.emphasize
                          ? 'price-levels-tab__product-override-rate'
                          : undefined}
                      >
                        {line.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <footer className="price-levels-tab__editor-foot">
                {isExisting ? (
                  <button
                    type="button"
                    className="price-levels-tab__editor-remove"
                    onClick={removeOverrideFromEditor}
                  >
                    Remove override
                  </button>
                ) : (
                  <span />
                )}
                <div className="price-levels-tab__editor-actions">
                  <button
                    type="button"
                    className="price-levels-tab__editor-cancel"
                    onClick={closeOverrideEditor}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="price-levels-tab__editor-save"
                    onClick={saveOverrideEditor}
                  >
                    {isExisting ? 'Save changes' : 'Apply override'}
                  </button>
                </div>
              </footer>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
};
