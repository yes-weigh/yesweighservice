import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Package,
  Percent,
  Plus,
  Search,
  Trash2,
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
  applyPriceLevelPercent,
  categoryRuleHasEffect,
  DEFAULT_DEALER_PRICE_LEVEL_ID,
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
  /** Active level tab (default Dealers first). */
  activeLevelId: string;
  draftsByLevelId: Record<string, OverrideEditorDraft>;
  existingByLevelId: Record<string, boolean>;
};

/** Default Dealers level first, then other levels by sortOrder / name. */
function orderPriceLevelsForUi(levels: PriceLevel[]): PriceLevel[] {
  return [...levels].sort((a, b) => {
    const aDef = isDefaultDealerPriceLevel(a) ? 0 : 1;
    const bDef = isDefaultDealerPriceLevel(b) ? 0 : 1;
    if (aDef !== bDef) return aDef - bDef;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
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
    const lines: Array<{ text: string; emphasize?: boolean }> = [];
    if (slabs[0].minQty > 1) {
      lines.push({
        text: `Qty 1–${slabs[0].minQty - 1} · list ₹${formatOverrideMoney(listRate)}`,
      });
    }
    for (const s of slabs) {
      lines.push({
        text: `≥${s.minQty} · ₹${formatOverrideMoney(s.rate)}`,
      });
    }
    return { kindLabel: 'Slabs', lines };
  }
  return {
    kindLabel: 'Custom',
    lines: [{ text: `₹${formatOverrideMoney(rule.customRate ?? 0)}`, emphasize: true }],
  };
}

/** Aggregate badge across all levels for a category tile. */
function formatCategoryAggregateBadge(
  levels: PriceLevel[],
  categoryId: string,
): string | null {
  let levelCount = 0;
  let maxAltered = 0;
  for (const level of levels) {
    const rule = level.categoryRules.find(r => r.categoryId === categoryId);
    if (!categoryRuleHasEffect(rule ?? emptyCategoryRule(categoryId, ''))) continue;
    levelCount += 1;
    maxAltered = Math.max(maxAltered, countAlteredItemRules(rule));
  }
  if (levelCount === 0) return null;
  const parts = [`${levelCount} level${levelCount === 1 ? '' : 's'}`];
  if (maxAltered > 0) {
    parts.push(`${maxAltered} item${maxAltered === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export const PriceLevelSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [savedLevels, setSavedLevels] = useState<PriceLevel[]>([]);
  /**
   * Level being edited in a category's Level overrides workspace
   * (tabs inside the category — not a page-level picker).
   */
  const [workspaceLevelId, setWorkspaceLevelId] = useState<string>(
    DEFAULT_DEALER_PRICE_LEVEL_ID,
  );
  /** Shop + synthetic Spare parts card (catalogue-aligned). */
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [spareProducts, setSpareProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  /** Category selected from productsue-style grid for editing rules (Items mode). */
  const [ruleCategoryId, setRuleCategoryId] = useState<string | null>(null);
  /** Category workspace: level overrides vs Costs & New sell. */
  const [spareWorkspace, setSpareWorkspace] = useState<'overrides' | 'costs'>('overrides');
  /** Filters the product browse grid in Items mode only. */
  const [itemQuery, setItemQuery] = useState('');
  const [overrideEditor, setOverrideEditor] = useState<OverrideEditorState | null>(null);
  /** Category whose visibility rules dialog is open. */
  const [visibilityCategory, setVisibilityCategory] = useState<CatalogCategory | null>(null);
  /** Flat discount/hike applied to every category on every level. */
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
  }, [spareWorkspace, workspaceLevelId, ruleCategoryId]);

  const exitCategoryEdit = useCallback(() => {
    setRuleCategoryId(null);
    setItemQuery('');
    setOverrideEditor(null);
    setSpareWorkspace('overrides');
    setWorkspaceLevelId(DEFAULT_DEALER_PRICE_LEVEL_ID);
  }, []);

  levelsRef.current = levels;
  savedRef.current = savedLevels;

  const levelsOrdered = useMemo(() => orderPriceLevelsForUi(levels), [levels]);

  const workspaceLevel = useMemo(
    () => levelsOrdered.find(l => l.id === workspaceLevelId)
      ?? levelsOrdered.find(isDefaultDealerPriceLevel)
      ?? levelsOrdered[0]
      ?? null,
    [levelsOrdered, workspaceLevelId],
  );

  useEffect(() => {
    if (levelsOrdered.length === 0) return;
    if (!levelsOrdered.some(l => l.id === workspaceLevelId)) {
      setWorkspaceLevelId(
        levelsOrdered.find(isDefaultDealerPriceLevel)?.id
          ?? levelsOrdered[0].id,
      );
    }
  }, [levelsOrdered, workspaceLevelId]);

  const rulesByCategoryId = useMemo(() => {
    const map = new Map<string, PriceLevelCategoryRule>();
    for (const rule of workspaceLevel?.categoryRules ?? []) {
      map.set(rule.categoryId, rule);
    }
    return map;
  }, [workspaceLevel]);

  const activeRuleCount = useMemo(() => {
    const ids = new Set<string>();
    for (const level of levels) {
      for (const rule of level.categoryRules) {
        if (categoryRuleHasEffect(rule)) ids.add(rule.categoryId);
      }
    }
    return ids.size;
  }, [levels]);

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
      const ordered = orderPriceLevelsForUi(docData.levels);
      setWorkspaceLevelId(
        ordered.find(isDefaultDealerPriceLevel)?.id
          ?? ordered[0]?.id
          ?? DEFAULT_DEALER_PRICE_LEVEL_ID,
      );

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load price levels.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

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

  const updateLevel = (levelId: string, patch: Partial<PriceLevel>) => {
    patchLevels(prev => prev.map(l => {
      if (l.id !== levelId) return l;
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

  const setCategoryRestrictedOnLevel = (
    levelId: string,
    categoryId: string,
    restricted: boolean,
  ) => {
    const level = levels.find(l => l.id === levelId);
    if (!level) return;
    const next = toggleRestrictedCategoryId(level, categoryId, restricted);
    updateLevel(levelId, { restrictedCategoryIds: next.restrictedCategoryIds });
  };

  const clearCategoryRule = (categoryId: string, levelId = workspaceLevel?.id) => {
    if (!levelId) return;
    const level = levels.find(l => l.id === levelId);
    if (!level) return;
    updateLevel(levelId, {
      categoryRules: level.categoryRules.filter(r => r.categoryId !== categoryId),
    });
  };

  const replaceCategoryRule = (
    nextRule: PriceLevelCategoryRule,
    levelId = workspaceLevel?.id,
  ) => {
    if (!levelId) return;
    const level = levels.find(l => l.id === levelId);
    if (!level) return;
    const others = level.categoryRules.filter(r => r.categoryId !== nextRule.categoryId);
    if (nextRule.percent <= 0 && nextRule.itemRules.length === 0) {
      updateLevel(levelId, { categoryRules: others });
      return;
    }
    updateLevel(levelId, { categoryRules: [...others, nextRule] });
  };

  const ensureCategoryRule = (
    category: CatalogCategory,
    levelId = workspaceLevel?.id,
  ): PriceLevelCategoryRule => {
    const level = levels.find(l => l.id === levelId);
    const existing = level?.categoryRules.find(r => r.categoryId === category.id);
    return existing ?? emptyCategoryRule(category.id, category.name);
  };

  const upsertCategoryRule = (
    category: CatalogCategory,
    patch: Partial<Pick<PriceLevelCategoryRule, 'mode' | 'percent'>>,
  ) => {
    if (!workspaceLevel) return;
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

  /** Same discount/hike % on every category for every level; keeps per-item overrides. */
  const applyFlatRuleToAllCategories = (
    mode: PriceLevelRuleMode,
    percentRaw: number | '',
  ) => {
    if (levels.length === 0 || categories.length === 0) return;
    const percent = percentRaw === '' || !Number.isFinite(Number(percentRaw))
      ? 0
      : Math.max(0, Math.min(1000, Number(percentRaw)));
    const knownIds = new Set(categories.map(cat => cat.id));
    patchLevels(prev => prev.map(level => {
      const preserved = level.categoryRules.filter(rule => !knownIds.has(rule.categoryId));
      const nextRules: PriceLevelCategoryRule[] = [];
      for (const cat of categories) {
        const existing = level.categoryRules.find(r => r.categoryId === cat.id);
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
      return { ...level, categoryRules: [...preserved, ...nextRules] };
    }));
    setFlatAllMode(mode);
    setFlatAllPercent(percent > 0 ? percent : '');
  };

  const openOverrideEditor = (category: CatalogCategory, product: CatalogProduct) => {
    const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
    const draftsByLevelId: Record<string, OverrideEditorDraft> = {};
    const existingByLevelId: Record<string, boolean> = {};
    for (const level of levelsOrdered) {
      const existingRule = level.categoryRules
        .find(r => r.categoryId === category.id)
        ?.itemRules.find(r => r.productId === product.id) ?? null;
      existingByLevelId[level.id] = Boolean(existingRule);
      draftsByLevelId[level.id] = existingRule
        ? draftFromItemRule(existingRule, listRate)
        : emptyOverrideDraft(listRate);
    }
    const activeLevelId = levelsOrdered.find(isDefaultDealerPriceLevel)?.id
      ?? levelsOrdered[0]?.id
      ?? DEFAULT_DEALER_PRICE_LEVEL_ID;
    setOverrideEditor({
      category,
      product,
      activeLevelId,
      draftsByLevelId,
      existingByLevelId,
    });
  };

  const patchOverrideDraft = (patch: Partial<OverrideEditorDraft>) => {
    setOverrideEditor(prev => {
      if (!prev) return prev;
      const levelId = prev.activeLevelId;
      const current = prev.draftsByLevelId[levelId] ?? emptyOverrideDraft(
        Math.round((Number(prev.product.rate) || 0) * 100) / 100,
      );
      const nextKind = patch.kind ?? current.kind;
      let nextSlabs = patch.slabs !== undefined ? patch.slabs : current.slabs;
      let nextCustom = patch.customRate !== undefined ? patch.customRate : current.customRate;
      let nextPercent = patch.percent !== undefined ? patch.percent : current.percent;
      if (patch.kind && patch.kind !== current.kind) {
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
        draftsByLevelId: {
          ...prev.draftsByLevelId,
          [levelId]: {
            kind: nextKind,
            percent: nextPercent,
            customRate: nextCustom,
            // Keep editor order as typed — sorting/deduping here remounts inputs and steals focus.
            slabs: nextKind === 'fixed' ? nextSlabs : [],
          },
        },
      };
    });
  };

  const closeOverrideEditor = () => setOverrideEditor(null);

  const saveOverrideEditor = () => {
    if (!overrideEditor) return;
    const { category, product, draftsByLevelId, existingByLevelId } = overrideEditor;
    const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
    const writes: Array<{
      levelId: string;
      item: PriceLevelItemRule;
    }> = [];
    for (const level of levelsOrdered) {
      const draft = draftsByLevelId[level.id];
      if (!draft) continue;
      const hadExisting = existingByLevelId[level.id];
      const isDefaultFixed = draft.kind === 'fixed'
        && draft.slabs.length === 0
        && Math.round((draft.customRate || 0) * 100) / 100 === listRate;
      if (!hadExisting && isDefaultFixed) continue;
      if (!hadExisting && draft.kind === 'discount' && draft.percent <= 0) continue;
      if (!hadExisting && draft.kind === 'increment' && draft.percent <= 0) continue;
      const kind = draft.kind;
      const slabs = kind === 'fixed' ? normalizePriceLevelSlabs(draft.slabs) : [];
      writes.push({
        levelId: level.id,
        item: {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          kind,
          percent: kind === 'except' || kind === 'fixed' ? 0 : draft.percent,
          customRate: kind === 'fixed'
            ? (slabs.length > 0 ? slabs[0].rate : draft.customRate)
            : null,
          slabs,
        },
      });
    }
    if (writes.length > 0) {
      patchLevels(prev => prev.map(level => {
        const write = writes.find(w => w.levelId === level.id);
        if (!write) return level;
        const existing = level.categoryRules.find(r => r.categoryId === category.id)
          ?? emptyCategoryRule(category.id, category.name);
        const itemRules = [
          ...existing.itemRules.filter(r => r.productId !== product.id),
          write.item,
        ];
        const nextRule: PriceLevelCategoryRule = {
          ...existing,
          categoryName: category.name,
          itemRules,
        };
        const others = level.categoryRules.filter(r => r.categoryId !== category.id);
        if (nextRule.percent <= 0 && nextRule.itemRules.length === 0) {
          return { ...level, categoryRules: others };
        }
        return { ...level, categoryRules: [...others, nextRule] };
      }));
      setRuleCategoryId(category.id);
    }
    setOverrideEditor(null);
  };

  useEffect(() => {
    if (!overrideEditor && !visibilityCategory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (overrideEditor) setOverrideEditor(null);
      else setVisibilityCategory(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overrideEditor, visibilityCategory]);

  const removeItemRuleOnLevel = (
    levelId: string,
    category: CatalogCategory,
    productId: string,
  ) => {
    const existing = ensureCategoryRule(category, levelId);
    const itemRules = existing.itemRules.filter(r => r.productId !== productId);
    if (existing.percent <= 0 && itemRules.length === 0) {
      clearCategoryRule(category.id, levelId);
      return;
    }
    replaceCategoryRule({ ...existing, itemRules }, levelId);
  };

  const removeOverrideFromEditor = () => {
    if (!overrideEditor) return;
    const { category, product, activeLevelId, existingByLevelId } = overrideEditor;
    if (!existingByLevelId[activeLevelId]) return;
    removeItemRuleOnLevel(activeLevelId, category, product.id);
    const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
    setOverrideEditor(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        existingByLevelId: { ...prev.existingByLevelId, [activeLevelId]: false },
        draftsByLevelId: {
          ...prev.draftsByLevelId,
          [activeLevelId]: emptyOverrideDraft(listRate),
        },
      };
    });
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
            Set category discount or hike % and item overrides per dealer level.
            Create levels and assign dealers under Settings → Price level.
            Visibility is set per category; item pricing uses a tab per level
            (Dealers first). Changes save automatically.
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

      <section className="price-levels-tab__detail">
          {levels.length === 0 ? (
            <p className="text-muted">
              No levels yet — create them under Settings → Price level.
            </p>
          ) : (
            <>
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
                          Use Visibility on each category to Show/Hide it per dealer level.
                          Hidden categories and their items are invisible to dealers on that level.
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
                              title="Clear category % on every category for every level (item overrides stay)"
                            >
                              Clear %
                            </button>
                          </div>
                          <p className="text-muted text-sm price-levels-tab__flat-all-hint">
                            Sets the same
                            {' '}
                            {flatAllMode === 'increment' ? 'hike' : 'discount'}
                            {' '}
                            on every category for every level. Per-item overrides are kept.
                            Tap a category to fine-tune per level.
                          </p>
                        </div>
                        <div className="catalog-categories catalog-categories--bare price-levels-tab__cat-grid">
                          <div className="catalog-categories__grid">
                            {categories.map((cat, idx) => {
                              const isSpare = isSparePriceLevelCategoryId(cat.id);
                              const badge = formatCategoryAggregateBadge(levels, cat.id);
                              const hiddenOnLevels = levelsOrdered.filter(level =>
                                level.restrictedCategoryIds.includes(cat.id),
                              ).length;
                              const hasAnyRule = Boolean(badge);
                              return (
                                <div
                                  key={cat.id}
                                  className={[
                                    'price-levels-tab__cat-tile',
                                    isSpare ? 'is-spare' : '',
                                    hasAnyRule ? 'is-active' : '',
                                    hiddenOnLevels > 0 ? 'is-restricted' : 'is-permitted',
                                  ].filter(Boolean).join(' ')}
                                >
                                  {badge ? (
                                    <span className="price-levels-tab__cat-badge">{badge}</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={[
                                      'price-levels-tab__visibility-open',
                                      hiddenOnLevels > 0 ? 'is-restricted' : '',
                                    ].filter(Boolean).join(' ')}
                                    title={`Visibility rules for ${cat.name}`}
                                    aria-label={`Visibility rules for ${cat.name}`}
                                    onClick={event => {
                                      event.stopPropagation();
                                      setVisibilityCategory(cat);
                                    }}
                                  >
                                    {hiddenOnLevels > 0 ? (
                                      <EyeOff size={13} aria-hidden />
                                    ) : (
                                      <Eye size={13} aria-hidden />
                                    )}
                                    <span>
                                      {hiddenOnLevels > 0
                                        ? `Hidden · ${hiddenOnLevels}`
                                        : 'Visibility'}
                                    </span>
                                  </button>
                                  <CategoryBrowseCard
                                    category={cat}
                                    index={idx}
                                    simple={isSpare}
                                    onClick={() => {
                                      setRuleCategoryId(cat.id);
                                      setItemQuery('');
                                      setWorkspaceLevelId(
                                        levelsOrdered.find(isDefaultDealerPriceLevel)?.id
                                          ?? levelsOrdered[0]?.id
                                          ?? DEFAULT_DEALER_PRICE_LEVEL_ID,
                                      );
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
                          <>
                            <div
                              className="price-levels-tab__level-tabs"
                              role="tablist"
                              aria-label="Dealer level for category rules"
                            >
                              {levelsOrdered.map(level => (
                                  <button
                                    key={level.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={workspaceLevel?.id === level.id}
                                    className={workspaceLevel?.id === level.id ? 'is-active' : ''}
                                    onClick={() => setWorkspaceLevelId(level.id)}
                                  >
                                    {level.name}
                                  </button>
                              ))}
                            </div>
                            <div className="price-levels-tab__rule-main">
                              <div
                                className="price-levels-tab__mode-toggle"
                                role="group"
                                aria-label={`Rule type for ${editCat.name} · ${workspaceLevel?.name ?? 'level'}`}
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
                          </>
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

      {visibilityCategory ? (
        <div
          className="price-levels-tab__editor-backdrop"
          role="presentation"
          onClick={() => setVisibilityCategory(null)}
        >
          <div
            className="price-levels-tab__editor price-levels-tab__visibility-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Visibility for ${visibilityCategory.name}`}
            onClick={e => e.stopPropagation()}
          >
            <header className="price-levels-tab__editor-head">
              <div className="price-levels-tab__item-meta">
                <strong>{visibilityCategory.name}</strong>
                <span className="text-muted">
                  Show or hide this category for each dealer level
                </span>
              </div>
              <button
                type="button"
                className="price-levels-tab__rule-delete"
                aria-label="Close"
                onClick={() => setVisibilityCategory(null)}
              >
                <X size={16} aria-hidden />
              </button>
            </header>
            <div className="price-levels-tab__editor-body">
              <p className="text-muted text-sm price-levels-tab__editor-hint">
                Hidden categories and their items are invisible to dealers on that level.
              </p>
              <ul className="price-levels-tab__visibility-list">
                {levelsOrdered.map(level => {
                  const restricted = level.restrictedCategoryIds.includes(
                    visibilityCategory.id,
                  );
                  const isDefault = isDefaultDealerPriceLevel(level);
                  return (
                    <li key={level.id} className="price-levels-tab__visibility-row">
                      <div className="price-levels-tab__visibility-row-meta">
                        <strong>{level.name}</strong>
                        <span className="text-muted text-sm">
                          {isDefault
                            ? 'All other dealers'
                            : `${level.dealerIds.length} dealer${level.dealerIds.length === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <div
                        className="price-levels-tab__visibility"
                        role="group"
                        aria-label={`Visibility for ${level.name}`}
                      >
                        <button
                          type="button"
                          className={`price-levels-tab__visibility-btn${restricted ? '' : ' is-active'}`}
                          aria-pressed={!restricted}
                          onClick={() => setCategoryRestrictedOnLevel(
                            level.id,
                            visibilityCategory.id,
                            false,
                          )}
                        >
                          <Eye size={13} aria-hidden />
                          <span>Show</span>
                        </button>
                        <button
                          type="button"
                          className={`price-levels-tab__visibility-btn is-restrict${restricted ? ' is-active' : ''}`}
                          aria-pressed={restricted}
                          onClick={() => setCategoryRestrictedOnLevel(
                            level.id,
                            visibilityCategory.id,
                            true,
                          )}
                        >
                          <EyeOff size={13} aria-hidden />
                          <span>Hide</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <footer className="price-levels-tab__editor-foot">
              <span />
              <div className="price-levels-tab__editor-actions">
                <button
                  type="button"
                  className="price-levels-tab__editor-save"
                  onClick={() => setVisibilityCategory(null)}
                >
                  Done
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {overrideEditor ? (() => {
        const { product, activeLevelId, draftsByLevelId, existingByLevelId } = overrideEditor;
        const listRate = Math.round((Number(product.rate) || 0) * 100) / 100;
        const activeLevel = levelsOrdered.find(l => l.id === activeLevelId) ?? null;
        const draft = draftsByLevelId[activeLevelId] ?? emptyOverrideDraft(listRate);
        const isExisting = Boolean(existingByLevelId[activeLevelId]);
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
        const anyExisting = Object.values(existingByLevelId).some(Boolean);
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
              aria-label={`${anyExisting ? 'Edit' : 'Add'} override for ${product.name}`}
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
                <div
                  className="price-levels-tab__level-tabs"
                  role="tablist"
                  aria-label="Dealer level pricing"
                >
                  {levelsOrdered.map(level => {
                    const hasRule = existingByLevelId[level.id];
                    return (
                      <button
                        key={level.id}
                        type="button"
                        role="tab"
                        aria-selected={activeLevelId === level.id}
                        className={[
                          activeLevelId === level.id ? 'is-active' : '',
                          hasRule ? 'has-rule' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => setOverrideEditor(prev => (
                          prev ? { ...prev, activeLevelId: level.id } : prev
                        ))}
                      >
                        {level.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-muted text-sm price-levels-tab__editor-hint">
                  Editing
                  {' '}
                  <strong>{activeLevel?.name ?? 'level'}</strong>
                  {isDefaultDealerPriceLevel(activeLevel)
                    ? ' — applies to all dealers not assigned to another level.'
                    : '.'}
                </p>

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
                    {anyExisting ? 'Save changes' : 'Apply override'}
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
