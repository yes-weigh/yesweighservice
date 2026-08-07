import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileSpreadsheet,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { useAuth } from '../../context/AuthContext';
import { updateCatalogProductDetails } from '../../lib/catalog';
import {
  computeSpareLandingCostInr,
  emptySparePricingSettings,
  fetchUsdToInrRate,
  levelPriceAdjustsEqual,
  loadSparePricingSettings,
  saveSparePricingSettings,
  sparePricingSettingsEqual,
} from '../../lib/sparePricing';
import {
  currencyPrefix,
  loadLatestPurchaseCostsByItemId,
  loadSparePurchaseCostOverrides,
  resolvePurchaseCost,
  saveSparePurchaseCostOverride,
  type PurchaseItemCostSet,
  type SparePurchaseCostOverride,
} from '../../lib/sparePurchaseCosts';
import type { CatalogProduct } from '../../types/catalog';
import type {
  SparePricingLevelAdjust,
  SparePricingSettings,
  SparePricingSettingsDraft,
} from '../../types/sparePricing';
import { SparePricingFilterSheet } from './SparePricingFilterSheet';
import { SparePricingLevelBulkPanel } from './SparePricingLevelBulkPanel';
import { SparePricingProductPeek } from './SparePricingProductPeek';
import {
  applySpareBulkPricingToLevels,
  dealerPriceFromLanding,
  existingSpareLevelPricingForProduct,
  filterSpareLevelBulkRows,
  formatExistingSpareLevelMode,
  type ExistingSpareLevelPriceRow,
  type SpareLevelBulkRow,
  type SpareLevelPriceAdjust,
} from '../../lib/sparePriceLevelBulk';
import {
  countSparePricingFilters,
  matchesSparePricingFilters,
  type SparePricingFilterKey,
  type SparePricingRowMetrics,
} from '../../lib/sparePricingFilters';
import {
  applyPriceLevelPercent,
  ceilInr,
  loadPriceLevels,
  savePriceLevels,
} from '../../lib/priceLevels';
import type { PriceLevel } from '../../types/priceLevels';

type NewSellLevelTip = {
  left: number;
  top: number;
  newSell: number;
  adjusts: SparePricingLevelAdjust[];
};

type ItemLevelTip = {
  left: number;
  top: number;
  productName: string;
  listRate: number;
  existingRows: ExistingSpareLevelPriceRow[];
  draftAdjusts: SparePricingLevelAdjust[];
};

function tipPositionFromTarget(target: HTMLElement, tipWidth = 280): { left: number; top: number } {
  const rect = target.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + Math.min(rect.width, 180) / 2 - tipWidth / 2),
    window.innerWidth - tipWidth - 8,
  );
  return {
    left,
    top: Math.max(8, rect.top - 8),
  };
}

type Props = {
  spares: CatalogProduct[];
  /** After Zoho rate push — update in-memory catalog rows. */
  onProductRatesSaved?: (updates: Array<{ productId: string; rate: number }>) => void;
  /** After hide-from-catalogue — drop row from in-memory catalog. */
  onProductHidden?: (productId: string) => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type SortKey =
  | 'sn'
  | 'item'
  | 'purchase'
  | 'landing'
  | 'sell'
  | 'profit'
  | 'newSell'
  | 'newProfit';

type SortDir = 'asc' | 'desc';

type CostDraft = {
  amount: number;
  currencyCode: string;
};

function ratesEqual(a: number, b: number): boolean {
  return ceilInr(a) === ceilInr(b);
}

function purchaseAmountInr(cost: CostDraft, usdToInrRate: number): number {
  const amount = Number(cost.amount) || 0;
  if (cost.currencyCode.trim().toUpperCase() === 'USD') {
    return amount * (Number(usdToInrRate) || 0);
  }
  return amount;
}

function compareSpareRows(a: CatalogProduct, b: CatalogProduct): number {
  const skuA = (a.sku ?? '').trim();
  const skuB = (b.sku ?? '').trim();
  const skuCmp = skuA.localeCompare(skuB, undefined, { sensitivity: 'base', numeric: true });
  if (skuCmp !== 0) return skuCmp;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function formatFetchedMeta(settings: SparePricingSettings): string | null {
  if (!settings.exchangeRateFetchedAt && !settings.exchangeRateDate) return null;
  const parts: string[] = [];
  if (settings.exchangeRateDate) parts.push(`market ${settings.exchangeRateDate}`);
  if (settings.exchangeRateFetchedAt) {
    try {
      parts.push(
        `fetched ${new Date(settings.exchangeRateFetchedAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`,
      );
    } catch {
      // ignore bad timestamp
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

function formatInrAmount(value: number): string {
  const n = ceilInr(value);
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatLevelAdjustLabel(adjust: SparePricingLevelAdjust): string {
  const sign = adjust.mode === 'discount' ? '−' : '+';
  return `${sign}${adjust.percent}% ${adjust.mode === 'discount' ? 'discount' : 'hike'}`;
}

/** Profit % on landing cost. Landing 0 → 100%. */
function computeProfitPercent(selling: number, landing: number): number {
  const sell = Number.isFinite(selling) ? selling : 0;
  const land = Number.isFinite(landing) ? landing : 0;
  if (!(land > 0)) return 100;
  return ((sell - land) / land) * 100;
}

/** New sell from target profit %: landing × (1 + pct/100), ceiled to whole ₹. Landing 0 → 0. */
function sellingFromProfitPercent(landing: number, percent: number): number {
  const land = Number.isFinite(landing) ? landing : 0;
  const pct = Number.isFinite(percent) ? percent : 0;
  if (!(land > 0)) return 0;
  return ceilInr(land * (1 + pct / 100));
}

function formatProfitPercent(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const rounded = Math.round(n * 10) / 10;
  const abs = Math.abs(rounded).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  if (rounded > 0) return `+${abs}%`;
  if (rounded < 0) return `−${abs}%`;
  return '0%';
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadTextFile(contents: string, filename: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReadonlyAmountField({
  valueText,
  label,
  title,
  tone = '',
  prefix = '₹',
  prefixClass = ' is-inr',
}: {
  valueText: string;
  label: string;
  title?: string;
  tone?: '' | ' is-profit' | ' is-loss';
  prefix?: string;
  prefixClass?: string;
}) {
  return (
    <div
      className={`spare-pricing__cost-cell spare-pricing__field-box is-readonly${tone}`}
      title={title}
      aria-label={label}
    >
      <span className={`spare-pricing__currency${prefixClass}`} aria-hidden>{prefix}</span>
      <span className="spare-pricing__input spare-pricing__cost-input spare-pricing__readonly-value">
        {valueText}
      </span>
    </div>
  );
}

function MoneyCell({
  value,
  label,
  title,
}: {
  value: number;
  label: string;
  title?: string;
}) {
  return (
    <ReadonlyAmountField
      valueText={formatInrAmount(value)}
      label={label}
      title={title}
    />
  );
}

function ProfitCell({
  percent,
  label,
  title,
}: {
  percent: number;
  label: string;
  title?: string;
}) {
  const tone = !Number.isFinite(percent) || percent === 0
    ? ''
    : percent > 0
      ? ' is-profit'
      : ' is-loss';
  return (
    <ReadonlyAmountField
      valueText={formatProfitPercent(percent)}
      label={label}
      title={title}
      tone={tone}
      prefix=""
      prefixClass=" is-pct"
    />
  );
}

const PurchaseCostCell = React.memo(function PurchaseCostCell({
  productId,
  productName,
  value,
  onChange,
  notFromLatest,
  hint,
}: {
  productId: string;
  productName: string;
  value: CostDraft;
  onChange: (productId: string, amount: number, currencyCode: string) => void;
  notFromLatest?: boolean;
  hint?: string;
}) {
  const code = value.currencyCode.trim().toUpperCase() === 'USD' ? 'USD' : 'INR';
  const currencyClass = code === 'USD' ? ' is-usd' : ' is-inr';
  const nextCode = code === 'USD' ? 'INR' : 'USD';

  return (
    <div
      className={`spare-pricing__cost-cell spare-pricing__field-box is-editable${notFromLatest ? ' is-not-latest' : ''}`}
      title={hint}
    >
      <button
        type="button"
        className={`spare-pricing__currency spare-pricing__currency-toggle${currencyClass}`}
        title={`Currency ${code} — click to switch to ${nextCode}`}
        aria-label={`Purchase currency ${code} for ${productName}. Click to switch to ${nextCode}.`}
        onClick={() => onChange(productId, value.amount, nextCode)}
      >
        {currencyPrefix(code)}
      </button>
      <DecimalAmountInput
        className={`spare-pricing__input spare-pricing__cost-input${notFromLatest ? ' is-not-latest' : ''}`}
        value={value.amount}
        onChange={next => onChange(productId, next ?? 0, code)}
        min={0}
        decimals={4}
        aria-label={`Purchase cost for ${productName}`}
      />
    </div>
  );
});

export const SparePricingView: React.FC<Props> = ({
  spares,
  onProductRatesSaved,
  onProductHidden,
}) => {
  const { user } = useAuth();
  const userUid = user?.uid ?? null;
  const chromeRef = useRef<HTMLDivElement>(null);
  const [peekProduct, setPeekProduct] = useState<CatalogProduct | null>(null);
  const [levelBulkOpen, setLevelBulkOpen] = useState(false);
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([]);
  const [newSellLevelTip, setNewSellLevelTip] = useState<NewSellLevelTip | null>(null);
  const [itemLevelTip, setItemLevelTip] = useState<ItemLevelTip | null>(null);

  const rows = useMemo(
    () => [...spares].sort(compareSpareRows),
    [spares],
  );

  const [loading, setLoading] = useState(true);
  const [costsLoading, setCostsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [tableFilters, setTableFilters] = useState<Set<SparePricingFilterKey>>(() => new Set());
  const [draft, setDraft] = useState<SparePricingSettings>(() => emptySparePricingSettings());
  const [saved, setSaved] = useState<SparePricingSettings>(() => emptySparePricingSettings());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('item');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [poCosts, setPoCosts] = useState<Map<string, PurchaseItemCostSet>>(() => new Map());
  const [overrides, setOverrides] = useState<Map<string, SparePurchaseCostOverride>>(() => new Map());
  /** Local editable values — keyed by productId; never rebuilt from PO while typing. */
  const [costDrafts, setCostDrafts] = useState<Record<string, CostDraft>>({});
  /** Proposed selling prices — default to catalog rate until edited. */
  const [newSellingDrafts, setNewSellingDrafts] = useState<Record<string, number>>({});

  const resolveCostDraft = useCallback((product: CatalogProduct): CostDraft => {
    const existing = costDrafts[product.id];
    if (existing) return existing;
    const resolved = resolvePurchaseCost(
      product.id,
      overrides.get(product.id),
      poCosts.get(product.id),
      draft.usdToInrRate,
    );
    return { amount: resolved.amount, currencyCode: resolved.currencyCode };
  }, [costDrafts, overrides, poCosts, draft.usdToInrRate]);

  const rowMetrics = useCallback((product: CatalogProduct): SparePricingRowMetrics => {
    const cost = resolveCostDraft(product);
    const landingInr = computeSpareLandingCostInr(cost, draft);
    const sell = Number(product.rate) || 0;
    const newSell = newSellingDrafts[product.id] ?? sell;
    return {
      purchaseAmount: Number(cost.amount) || 0,
      currencyCode: cost.currencyCode,
      landingInr,
      sell,
      profitPercent: computeProfitPercent(sell, landingInr),
      newSell,
      stock: Number.isFinite(product.stock) ? product.stock : 0,
    };
  }, [resolveCostDraft, draft, newSellingDrafts]);

  const filterCounts = useMemo(
    () => countSparePricingFilters(rows.map(rowMetrics)),
    [rows, rowMetrics],
  );

  const hasActiveTableFilters = tableFilters.size > 0;

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = rows.filter(product => {
      if (q) {
        const sku = (product.sku ?? '').toLowerCase();
        const name = product.name.toLowerCase();
        if (!sku.includes(q) && !name.includes(q)) return false;
      }
      if (tableFilters.size > 0 && !matchesSparePricingFilters(rowMetrics(product), tableFilters)) {
        return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const resolveCost = resolveCostDraft;

    return [...matched].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'sn':
        case 'item': {
          cmp = compareSpareRows(a, b);
          break;
        }
        case 'purchase': {
          cmp = purchaseAmountInr(resolveCost(a), draft.usdToInrRate)
            - purchaseAmountInr(resolveCost(b), draft.usdToInrRate);
          break;
        }
        case 'landing': {
          cmp = computeSpareLandingCostInr(resolveCost(a), draft)
            - computeSpareLandingCostInr(resolveCost(b), draft);
          break;
        }
        case 'sell': {
          cmp = (Number(a.rate) || 0) - (Number(b.rate) || 0);
          break;
        }
        case 'profit': {
          const landA = computeSpareLandingCostInr(resolveCost(a), draft);
          const landB = computeSpareLandingCostInr(resolveCost(b), draft);
          cmp = computeProfitPercent(Number(a.rate) || 0, landA)
            - computeProfitPercent(Number(b.rate) || 0, landB);
          break;
        }
        case 'newSell': {
          const sellA = newSellingDrafts[a.id] ?? (Number(a.rate) || 0);
          const sellB = newSellingDrafts[b.id] ?? (Number(b.rate) || 0);
          cmp = sellA - sellB;
          break;
        }
        case 'newProfit': {
          const landA = computeSpareLandingCostInr(resolveCost(a), draft);
          const landB = computeSpareLandingCostInr(resolveCost(b), draft);
          const sellA = newSellingDrafts[a.id] ?? (Number(a.rate) || 0);
          const sellB = newSellingDrafts[b.id] ?? (Number(b.rate) || 0);
          cmp = computeProfitPercent(sellA, landA) - computeProfitPercent(sellB, landB);
          break;
        }
        default:
          cmp = compareSpareRows(a, b);
      }
      if (cmp === 0) cmp = compareSpareRows(a, b);
      if (cmp === 0) cmp = a.id.localeCompare(b.id);
      return cmp * dir;
    });
  }, [
    rows,
    searchQuery,
    tableFilters,
    sortKey,
    sortDir,
    resolveCostDraft,
    rowMetrics,
    costDrafts,
    overrides,
    poCosts,
    newSellingDrafts,
    draft,
  ]);

  const dirtyCostIdsRef = useRef<Set<string>>(new Set());
  const dirtyNewSellingRef = useRef<Set<string>>(new Set());
  /** Purchase was 0 → value: keep New sell synced to dealer profit until user edits sell. */
  const autoDealerProfitFromZeroRef = useRef<Set<string>>(new Set());
  /** Bump to recompute hasChanges after dirty-ref mutations. */
  const [dirtyEpoch, setDirtyEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadSparePricingSettings()
      .then(settings => {
        if (cancelled) return;
        setDraft(settings);
        setSaved(settings);
        setSaveStatus('idle');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load spare pricing settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPriceLevels = useCallback(() => {
    void loadPriceLevels()
      .then(docData => {
        setPriceLevels(docData.levels);
      })
      .catch(() => {
        // Hover tip is best-effort; table remains usable.
      });
  }, []);

  useEffect(() => {
    refreshPriceLevels();
  }, [refreshPriceLevels]);

  useEffect(() => {
    let cancelled = false;
    setCostsLoading(true);
    void Promise.all([
      loadLatestPurchaseCostsByItemId(),
      loadSparePurchaseCostOverrides(),
    ])
      .then(([fromPo, fromOverrides]) => {
        if (cancelled) return;
        setPoCosts(fromPo);
        setOverrides(fromOverrides);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load purchase costs.');
      })
      .finally(() => {
        if (!cancelled) setCostsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Seed cost drafts from PO + overrides unless the user edited that row. */
  useEffect(() => {
    if (costsLoading) return;
    setCostDrafts(prev => {
      const next = { ...prev };
      let changed = false;
      for (const product of rows) {
        if (dirtyCostIdsRef.current.has(product.id)) continue;
        const resolved = resolvePurchaseCost(
          product.id,
          overrides.get(product.id),
          poCosts.get(product.id),
          draft.usdToInrRate,
        );
        const existing = next[product.id];
        if (
          existing
          && existing.amount === resolved.amount
          && existing.currencyCode === resolved.currencyCode
        ) {
          continue;
        }
        next[product.id] = {
          amount: resolved.amount,
          currencyCode: resolved.currencyCode,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [costsLoading, rows, poCosts, overrides, draft.usdToInrRate]);

  /** Seed new selling price from catalog rate unless the user edited that row. */
  useEffect(() => {
    setNewSellingDrafts(prev => {
      const next = { ...prev };
      let changed = false;
      for (const product of rows) {
        if (dirtyNewSellingRef.current.has(product.id)) continue;
        const rate = Number(product.rate) || 0;
        if (next[product.id] === rate) continue;
        next[product.id] = rate;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const markDirty = useCallback(() => {
    setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev));
    setDirtyEpoch(n => n + 1);
  }, []);

  const patchDraft = useCallback((patch: Partial<SparePricingSettingsDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }));
    markDirty();
  }, [markDirty]);

  const showNewSellLevelTip = useCallback((
    event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
    newSell: number,
  ) => {
    setItemLevelTip(null);
    const pos = tipPositionFromTarget(event.currentTarget);
    setNewSellLevelTip({
      ...pos,
      newSell,
      adjusts: draft.levelPriceAdjusts,
    });
  }, [draft.levelPriceAdjusts]);

  const hideNewSellLevelTip = useCallback(() => {
    setNewSellLevelTip(null);
  }, []);

  const showItemLevelTip = useCallback((
    event: React.MouseEvent<HTMLElement>,
    product: CatalogProduct,
    listRate: number,
  ) => {
    setNewSellLevelTip(null);
    const pos = tipPositionFromTarget(event.currentTarget);
    setItemLevelTip({
      ...pos,
      productName: product.name,
      listRate,
      existingRows: existingSpareLevelPricingForProduct(priceLevels, product.id, listRate),
      draftAdjusts: draft.levelPriceAdjusts,
    });
  }, [priceLevels, draft.levelPriceAdjusts]);

  const hideItemLevelTip = useCallback(() => {
    setItemLevelTip(null);
  }, []);

  useEffect(() => {
    if (!newSellLevelTip && !itemLevelTip) return;
    const hide = () => {
      setNewSellLevelTip(null);
      setItemLevelTip(null);
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [newSellLevelTip, itemLevelTip]);

  const handleFetchRate = useCallback(async () => {
    setFetchingRate(true);
    setError(null);
    try {
      const result = await fetchUsdToInrRate();
      setDraft(prev => ({
        ...prev,
        usdToInrRate: result.rate,
        exchangeRateFetchedAt: result.fetchedAt,
        exchangeRateDate: result.date,
      }));
      markDirty();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch exchange rate.');
    } finally {
      setFetchingRate(false);
    }
  }, [markDirty]);

  const handleCostChange = useCallback((
    productId: string,
    amount: number,
    currencyCode: string,
  ) => {
    dirtyCostIdsRef.current.add(productId);

    const previous = costDrafts[productId] ?? (() => {
      const resolved = resolvePurchaseCost(
        productId,
        overrides.get(productId),
        poCosts.get(productId),
        draft.usdToInrRate,
      );
      return { amount: resolved.amount, currencyCode: resolved.currencyCode };
    })();
    const wasZero = !(Number(previous.amount) > 0);
    const nowPositive = Number(amount) > 0;

    if (wasZero && nowPositive) {
      autoDealerProfitFromZeroRef.current.add(productId);
    }
    if (!nowPositive) {
      autoDealerProfitFromZeroRef.current.delete(productId);
    }

    setCostDrafts(prev => ({
      ...prev,
      [productId]: { amount, currencyCode },
    }));

    if (autoDealerProfitFromZeroRef.current.has(productId) && nowPositive) {
      const landingInr = computeSpareLandingCostInr({ amount, currencyCode }, draft);
      const nextSell = dealerPriceFromLanding(landingInr, draft.dealerProfitPercent);
      dirtyNewSellingRef.current.add(productId);
      setNewSellingDrafts(prev => ({
        ...prev,
        [productId]: nextSell,
      }));
    }

    markDirty();
  }, [markDirty, costDrafts, overrides, poCosts, draft]);

  const handleNewSellingChange = useCallback((productId: string, amount: number) => {
    autoDealerProfitFromZeroRef.current.delete(productId);
    dirtyNewSellingRef.current.add(productId);
    setNewSellingDrafts(prev => ({
      ...prev,
      [productId]: ceilInr(amount),
    }));
    markDirty();
  }, [markDirty]);

  const handleDealerListRatesApplied = useCallback((
    updates: Array<{ productId: string; rate: number }>,
    dealerProfitPercent: number,
  ) => {
    if (!updates.length) return;
    setNewSellingDrafts(prev => {
      const next = { ...prev };
      for (const row of updates) {
        dirtyNewSellingRef.current.add(row.productId);
        next[row.productId] = row.rate;
      }
      return next;
    });
    patchDraft({ dealerProfitPercent });
  }, [patchDraft]);

  const handleLevelsApplied = useCallback((
    adjusts: SpareLevelPriceAdjust[],
    dealerProfitPercent: number,
  ) => {
    const levelPriceAdjusts: SparePricingLevelAdjust[] = adjusts.map(row => ({
      levelId: row.levelId,
      levelName: row.levelName,
      mode: row.mode,
      percent: row.percent,
    }));
    patchDraft({ dealerProfitPercent, levelPriceAdjusts });
  }, [patchDraft]);

  const handleNewProfitChange = useCallback((
    productId: string,
    percent: number,
    landingInr: number,
  ) => {
    autoDealerProfitFromZeroRef.current.delete(productId);
    dirtyNewSellingRef.current.add(productId);
    setNewSellingDrafts(prev => ({
      ...prev,
      [productId]: sellingFromProfitPercent(landingInr, percent),
    }));
    markDirty();
  }, [markDirty]);

  const changedCostIds = useMemo(() => {
    const ids: string[] = [];
    for (const product of rows) {
      const draftCost = costDrafts[product.id];
      if (!draftCost) continue;
      const baseline = resolvePurchaseCost(
        product.id,
        overrides.get(product.id),
        poCosts.get(product.id),
        draft.usdToInrRate,
      );
      if (
        draftCost.amount !== baseline.amount
        || draftCost.currencyCode !== baseline.currencyCode
      ) {
        ids.push(product.id);
      }
    }
    return ids;
    // dirtyEpoch ensures recompute after edits that only touch refs/drafts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, costDrafts, overrides, poCosts, dirtyEpoch, draft.usdToInrRate]);

  const changedRateUpdates = useMemo(() => {
    const updates: Array<{ product: CatalogProduct; rate: number }> = [];
    for (const product of rows) {
      const nextRate = newSellingDrafts[product.id];
      if (nextRate == null) continue;
      if (!ratesEqual(nextRate, Number(product.rate) || 0)) {
        updates.push({ product, rate: ceilInr(nextRate) });
      }
    }
    return updates;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, newSellingDrafts, dirtyEpoch]);

  const settingsDirty = !sparePricingSettingsEqual(draft, saved);
  const levelFormulaDirty = !levelPriceAdjustsEqual(
    draft.levelPriceAdjusts,
    saved.levelPriceAdjusts,
  );
  const hasChanges = settingsDirty
    || changedCostIds.length > 0
    || changedRateUpdates.length > 0;

  const handleCancelChanges = useCallback(() => {
    if (!hasChanges || saveStatus === 'saving') return;
    setDraft(saved);
    dirtyCostIdsRef.current.clear();
    dirtyNewSellingRef.current.clear();
    autoDealerProfitFromZeroRef.current.clear();
    const nextCosts: Record<string, CostDraft> = {};
    const nextSelling: Record<string, number> = {};
    for (const product of rows) {
      const resolved = resolvePurchaseCost(
        product.id,
        overrides.get(product.id),
        poCosts.get(product.id),
        saved.usdToInrRate,
      );
      nextCosts[product.id] = {
        amount: resolved.amount,
        currencyCode: resolved.currencyCode,
      };
      nextSelling[product.id] = Number(product.rate) || 0;
    }
    setCostDrafts(nextCosts);
    setNewSellingDrafts(nextSelling);
    setSaveStatus('idle');
    setError(null);
    setDirtyEpoch(n => n + 1);
  }, [hasChanges, saveStatus, saved, rows, overrides, poCosts]);

  const handleExportExcel = useCallback(() => {
    const header = [
      '#',
      'SKU',
      'Stock',
      'Name',
      'Purchase currency',
      'Purchase',
      'Landing (INR)',
      'Sell (INR)',
      'Profit %',
      'New sell (INR)',
      'New profit %',
      'USD→INR',
      'Markup (INR)',
      'Customs %',
      'Freight %',
    ];
    const lines = [
      header.map(csvEscape).join(','),
      ...filteredRows.map((product, index) => {
        const resolved = resolvePurchaseCost(
          product.id,
          overrides.get(product.id),
          poCosts.get(product.id),
          draft.usdToInrRate,
        );
        const draftCost = costDrafts[product.id] ?? {
          amount: resolved.amount,
          currencyCode: resolved.currencyCode,
        };
        const landingInr = computeSpareLandingCostInr(draftCost, draft);
        const currentSelling = Number(product.rate) || 0;
        const newSelling = newSellingDrafts[product.id] ?? currentSelling;
        const currentProfitPct = computeProfitPercent(currentSelling, landingInr);
        const newProfitPct = computeProfitPercent(newSelling, landingInr);
        return [
          index + 1,
          product.sku?.trim() || '',
          Number.isFinite(product.stock) ? product.stock : 0,
          product.name,
          draftCost.currencyCode.trim().toUpperCase() || 'INR',
          draftCost.amount,
          ceilInr(landingInr),
          ceilInr(currentSelling),
          Math.round(currentProfitPct * 10) / 10,
          ceilInr(newSelling),
          Math.round(newProfitPct * 10) / 10,
          draft.usdToInrRate,
          draft.markupFeeInr,
          draft.cdPercent,
          draft.freightPercent,
        ].map(csvEscape).join(',');
      }),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    // UTF-8 BOM so Excel opens ₹ / Indian locale text correctly.
    downloadTextFile(
      `\uFEFF${lines.join('\r\n')}\r\n`,
      `spare-pricing-${stamp}.csv`,
      'text/csv;charset=utf-8',
    );
  }, [filteredRows, overrides, poCosts, costDrafts, newSellingDrafts, draft]);

  const handleSaveChanges = useCallback(async () => {
    if (!hasChanges || saveStatus === 'saving') return;
    setSaveStatus('saving');
    setError(null);
    try {
      if (settingsDirty) {
        const next = await saveSparePricingSettings(draft, userUid);
        setSaved(next);
        setDraft(prev => ({
          ...prev,
          updatedAt: next.updatedAt,
          updatedByUid: next.updatedByUid,
        }));
      }

      if (changedCostIds.length > 0) {
        const savedOverrides = await Promise.all(
          changedCostIds.map(async productId => {
            const cost = costDrafts[productId];
            if (!cost) return null;
            return saveSparePurchaseCostOverride(
              productId,
              cost.amount,
              cost.currencyCode,
              userUid,
            );
          }),
        );
        setOverrides(prev => {
          const next = new Map(prev);
          for (const row of savedOverrides) {
            if (row) next.set(row.productId, row);
          }
          return next;
        });
        for (const productId of changedCostIds) {
          dirtyCostIdsRef.current.delete(productId);
          autoDealerProfitFromZeroRef.current.delete(productId);
        }
      }

      if (changedRateUpdates.length > 0) {
        const applied: Array<{ productId: string; rate: number }> = [];
        for (const { product, rate } of changedRateUpdates) {
          const result = await updateCatalogProductDetails(product.id, {
            name: product.name,
            sku: product.sku?.trim() || '',
            rate,
          });
          const savedRate = result.rate != null ? result.rate : rate;
          applied.push({ productId: product.id, rate: savedRate });
          dirtyNewSellingRef.current.delete(product.id);
          autoDealerProfitFromZeroRef.current.delete(product.id);
          setNewSellingDrafts(prev => ({ ...prev, [product.id]: savedRate }));
        }
        onProductRatesSaved?.(applied);
      }

      const shouldSyncPriceLevels = levelFormulaDirty || changedRateUpdates.length > 0;
      if (shouldSyncPriceLevels) {
        const targetIds = levelFormulaDirty
          ? null
          : new Set(changedRateUpdates.map(row => row.product.id));
        const bulkRows: SpareLevelBulkRow[] = rows
          .filter(product => targetIds == null || targetIds.has(product.id))
          .map(product => {
            const resolved = resolvePurchaseCost(
              product.id,
              overrides.get(product.id),
              poCosts.get(product.id),
              draft.usdToInrRate,
            );
            const draftCost = costDrafts[product.id] ?? {
              amount: resolved.amount,
              currencyCode: resolved.currencyCode,
            };
            return {
              product,
              listRate: newSellingDrafts[product.id] ?? (Number(product.rate) || 0),
              landingInr: computeSpareLandingCostInr(draftCost, draft),
              purchaseAmount: Number(draftCost.amount) || 0,
            };
          });
        const { eligible } = filterSpareLevelBulkRows(bulkRows);
        if (eligible.length > 0) {
          const docData = await loadPriceLevels();
          const nextLevels = applySpareBulkPricingToLevels(
            docData.levels,
            bulkRows,
            draft.levelPriceAdjusts,
          );
          await savePriceLevels(nextLevels, userUid);
          setPriceLevels(nextLevels);
        }
      }

      setSaveStatus('saved');
      setDirtyEpoch(n => n + 1);
    } catch (err) {
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : 'Could not save spare pricing changes.');
    }
  }, [
    hasChanges,
    saveStatus,
    settingsDirty,
    draft,
    userUid,
    changedCostIds,
    costDrafts,
    changedRateUpdates,
    onProductRatesSaved,
    levelFormulaDirty,
    rows,
    overrides,
    poCosts,
    newSellingDrafts,
  ]);

  const levelBulkRows = useMemo((): SpareLevelBulkRow[] => (
    rows.map(product => {
      const resolved = resolvePurchaseCost(
        product.id,
        overrides.get(product.id),
        poCosts.get(product.id),
        draft.usdToInrRate,
      );
      const draftCost = costDrafts[product.id] ?? {
        amount: resolved.amount,
        currencyCode: resolved.currencyCode,
      };
      const listRate = newSellingDrafts[product.id] ?? (Number(product.rate) || 0);
      return {
        product,
        listRate,
        landingInr: computeSpareLandingCostInr(draftCost, draft),
        purchaseAmount: Number(draftCost.amount) || 0,
      };
    })
  ), [rows, overrides, poCosts, costDrafts, newSellingDrafts, draft]);

  const fetchedMeta = formatFetchedMeta(draft);
  const showingCount = filteredRows.length;
  const totalCount = rows.length;

  /** Keep page padding in sync with the fixed chrome (search + column titles). */
  useEffect(() => {
    const chrome = chromeRef.current;
    const root = chrome?.closest('.spare-pricing') as HTMLElement | null;
    if (!chrome || !root) return undefined;
    const apply = () => {
      root.style.setProperty('--spare-pricing-chrome-height', `${chrome.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [loading, showingCount, totalCount, searchQuery, costsLoading]);

  const itemCountLabel = (searchQuery.trim() || hasActiveTableFilters)
    ? `${showingCount}/${totalCount}`
    : String(totalCount);

  const renderSortHeader = (
    key: SortKey,
    label: React.ReactNode,
    className: string,
    title?: string,
  ) => {
    const active = sortKey === key;
    const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    return (
      <th className={className} scope="col" aria-sort={ariaSort} title={title}>
        <button
          type="button"
          className={`spare-pricing__sort-btn${active ? ' is-active' : ''}`}
          onClick={() => toggleSort(key)}
          aria-label={
            active
              ? `Sort by ${typeof label === 'string' ? label : key}, currently ${sortDir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`
              : `Sort by ${typeof label === 'string' ? label : key}`
          }
        >
          <span className="spare-pricing__sort-label">{label}</span>
          <span className="spare-pricing__sort-icon" aria-hidden>
            {active
              ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
              : <ArrowDown size={11} className="spare-pricing__sort-icon-idle" />}
          </span>
        </button>
      </th>
    );
  };

  const columnHead = (
    <tr>
      {renderSortHeader('sn', '#', 'spare-pricing__sn-col', 'Sort by SKU')}
      {renderSortHeader(
        'item',
        <>
          Item
          {' '}
          <em className="spare-pricing__item-count">
            (
            {itemCountLabel}
            {costsLoading ? '…' : ''}
            )
          </em>
        </>,
        'spare-pricing__item-col',
        'Sort by SKU / name',
      )}
      {renderSortHeader('purchase', 'Purchase', 'spare-pricing__cost-col', 'Sort by purchase cost')}
      {renderSortHeader('landing', 'Landing', 'spare-pricing__cost-col', 'Sort by landing cost')}
      {renderSortHeader('sell', 'Sell', 'spare-pricing__cost-col', 'Sort by current selling price')}
      {renderSortHeader('profit', 'Profit %', 'spare-pricing__cost-col', 'Sort by current profit %')}
      {renderSortHeader('newSell', 'New sell', 'spare-pricing__cost-col', 'Sort by new selling price')}
      {renderSortHeader('newProfit', 'New %', 'spare-pricing__cost-col', 'Sort by new profit %')}
    </tr>
  );

  return (
    <section className="spare-pricing">
      <div ref={chromeRef} className="spare-pricing__chrome">
        <div className="spare-pricing__toolbar">
          <div className="spare-pricing__toolbar-row spare-pricing__toolbar-row--main">
            <label className="spare-pricing__search catalog-search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search SKU or name"
                aria-label="Search spare pricing"
              />
              {searchQuery.trim() ? (
                <button
                  type="button"
                  className="spare-pricing__search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </label>

            {loading ? (
              <div className="spare-pricing__loading">
                <Loader2 className="spin-icon" size={16} aria-hidden />
                <span>Loading…</span>
              </div>
            ) : (
              <>
                <div className="spare-pricing__field">
                  <label htmlFor="spare-pricing-usd-inr">USD→INR</label>
                  <div className="spare-pricing__affix-field spare-pricing__affix-field--rate">
                    <DecimalAmountInput
                      id="spare-pricing-usd-inr"
                      className="spare-pricing__input"
                      value={draft.usdToInrRate}
                      onChange={next => patchDraft({ usdToInrRate: next ?? 0 })}
                      min={0}
                      decimals={4}
                      aria-label="Exchange rate USD to INR"
                    />
                    <button
                      type="button"
                      className="spare-pricing__fetch-icon-btn"
                      onClick={() => void handleFetchRate()}
                      disabled={fetchingRate}
                      title={fetchedMeta || 'Fetch latest USD→INR rate'}
                      aria-label={fetchingRate ? 'Fetching USD to INR rate' : 'Fetch latest USD to INR rate'}
                    >
                      {fetchingRate
                        ? <Loader2 size={14} className="spin-icon" aria-hidden />
                        : <RefreshCw size={14} aria-hidden />}
                    </button>
                  </div>
                </div>

                <div className="spare-pricing__field">
                  <label htmlFor="spare-pricing-markup">Markup (₹)</label>
                  <div className="spare-pricing__affix-field">
                    <span className="spare-pricing__prefix is-inr" aria-hidden>₹</span>
                    <DecimalAmountInput
                      id="spare-pricing-markup"
                      className="spare-pricing__input"
                      value={draft.markupFeeInr}
                      onChange={next => patchDraft({ markupFeeInr: next ?? 0 })}
                      min={0}
                      decimals={2}
                      aria-label="Markup fee in rupees"
                    />
                  </div>
                </div>

                <div className="spare-pricing__field">
                  <label htmlFor="spare-pricing-cd">Customs (%)</label>
                  <div className="spare-pricing__affix-field">
                    <DecimalAmountInput
                      id="spare-pricing-cd"
                      className="spare-pricing__input"
                      value={draft.cdPercent}
                      onChange={next => patchDraft({ cdPercent: next ?? 0 })}
                      min={0}
                      max={1000}
                      decimals={2}
                      aria-label="Customs duty percentage"
                    />
                    <span className="spare-pricing__suffix" aria-hidden>%</span>
                  </div>
                </div>

                <div className="spare-pricing__field">
                  <label htmlFor="spare-pricing-freight">Freight (%)</label>
                  <div className="spare-pricing__affix-field">
                    <DecimalAmountInput
                      id="spare-pricing-freight"
                      className="spare-pricing__input"
                      value={draft.freightPercent}
                      onChange={next => patchDraft({ freightPercent: next ?? 0 })}
                      min={0}
                      max={1000}
                      decimals={2}
                      aria-label="Freight percentage"
                    />
                    <span className="spare-pricing__suffix" aria-hidden>%</span>
                  </div>
                </div>
              </>
            )}

            <button
              type="button"
              className={[
                'catalog-header-filter-btn',
                'spare-pricing__filter-btn',
                filterOpen ? 'catalog-header-filter-btn--open' : '',
                hasActiveTableFilters ? 'catalog-header-filter-btn--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setFilterOpen(open => !open)}
              aria-expanded={filterOpen}
              aria-haspopup="dialog"
              aria-label="Open spare pricing filters"
              title="Filters"
            >
              <SlidersHorizontal size={18} strokeWidth={2.25} aria-hidden />
            </button>
          </div>

          <div className="spare-pricing__toolbar-row spare-pricing__toolbar-row--actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm spare-pricing__action-btn spare-pricing__levels-btn"
              onClick={() => setLevelBulkOpen(true)}
              disabled={loading || totalCount === 0 || costsLoading}
              aria-label="Bulk level pricing"
              title="Set spare profit % per dealer price level"
            >
              <Layers size={14} aria-hidden />
              <span className="spare-pricing__action-label">Level pricing</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm spare-pricing__action-btn spare-pricing__export-btn"
              onClick={handleExportExcel}
              disabled={loading || showingCount === 0}
              aria-label="Export to Excel"
              title={
                searchQuery.trim() || hasActiveTableFilters
                  ? `Export ${showingCount} filtered row(s) to Excel`
                  : `Export ${showingCount} row(s) to Excel`
              }
            >
              <FileSpreadsheet size={14} aria-hidden />
              <span className="spare-pricing__action-label">Export Excel</span>
            </button>

            <div className="spare-pricing__save-actions">
              {saveStatus === 'saved' && !hasChanges ? (
                <span className="spare-pricing__save-status is-saved" role="status">
                  <Check size={14} aria-hidden />
                  Saved
                </span>
              ) : null}
              {saveStatus === 'error' ? (
                <span className="spare-pricing__save-status is-error" role="status">
                  Save failed
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm spare-pricing__action-btn spare-pricing__cancel-btn"
                onClick={handleCancelChanges}
                disabled={!hasChanges || saveStatus === 'saving' || loading}
                aria-label="Cancel changes"
                title="Discard unsaved changes"
              >
                <X size={14} aria-hidden />
                <span className="spare-pricing__action-label">Cancel</span>
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm spare-pricing__action-btn spare-pricing__save-btn"
                onClick={() => void handleSaveChanges()}
                disabled={!hasChanges || saveStatus === 'saving' || loading}
                aria-label={saveStatus === 'saving' ? 'Saving changes' : 'Save changes'}
              >
                {saveStatus === 'saving'
                  ? <Loader2 size={14} className="spin-icon" aria-hidden />
                  : <Save size={14} aria-hidden />}
                <span className="spare-pricing__action-label">
                  {saveStatus === 'saving' ? 'Saving…' : 'Save'}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="spare-pricing__colhead">
          <table className="data-table spare-pricing__table spare-pricing__table--head">
            <thead>{columnHead}</thead>
          </table>
        </div>
      </div>

      {error ? <p className="spare-pricing__error" role="alert">{error}</p> : null}

      <div className="table-scroll-wrap">
        {totalCount === 0 ? (
          <p className="text-muted text-center p-4">No spare parts found.</p>
        ) : showingCount === 0 ? (
          <p className="text-muted text-center p-4">
            {hasActiveTableFilters && !searchQuery.trim()
              ? 'No spares match your filters.'
              : hasActiveTableFilters
                ? 'No spares match your search and filters.'
                : 'No spares match your search.'}
          </p>
        ) : (
          <table className="data-table spare-pricing__table spare-pricing__table--body">
            <thead className="spare-pricing__sr-only">{columnHead}</thead>
            <tbody>
              {filteredRows.map((product, index) => {
                const resolved = resolvePurchaseCost(
                  product.id,
                  overrides.get(product.id),
                  poCosts.get(product.id),
                  draft.usdToInrRate,
                );
                const draftCost = costDrafts[product.id] ?? {
                  amount: resolved.amount,
                  currencyCode: resolved.currencyCode,
                };
                const matchesResolved = draftCost.amount === resolved.amount
                  && draftCost.currencyCode === resolved.currencyCode;
                const showNotLatest = resolved.source === 'purchase_order'
                  && resolved.notFromLatest
                  && matchesResolved
                  && !dirtyCostIdsRef.current.has(product.id);
                const purchaseHint = resolved.source === 'purchase_order'
                  ? (
                    showNotLatest
                      ? `Highest purchase${resolved.purchaseOrderNumber ? ` (PO ${resolved.purchaseOrderNumber})` : ''}`
                        + (
                          resolved.latestAmount != null
                            ? ` — latest PO was ${resolved.latestCurrencyCode === 'USD' ? '$' : '₹'}${resolved.latestAmount}`
                            : ''
                        )
                      : `From purchase order${resolved.purchaseOrderNumber ? ` ${resolved.purchaseOrderNumber}` : ''} (matches latest)`
                  )
                  : resolved.source === 'override'
                    ? 'Manual override'
                    : 'No purchase history';
                const landingInr = computeSpareLandingCostInr(draftCost, draft);
                const currentSelling = Number(product.rate) || 0;
                const newSelling = newSellingDrafts[product.id] ?? currentSelling;
                const currentProfitPct = computeProfitPercent(currentSelling, landingInr);
                const newProfitPct = computeProfitPercent(newSelling, landingInr);
                const landingTitle = draftCost.currencyCode.trim().toUpperCase() === 'USD'
                  ? `($${draftCost.amount} × ${draft.usdToInrRate} + ₹${draft.markupFeeInr}) × (1 + ${(draft.cdPercent + draft.freightPercent)}%)`
                  : 'Same as purchase cost (INR)';
                const sku = product.sku?.trim() || '—';
                const stockQty = Number.isFinite(product.stock) ? product.stock : 0;
                return (
                  <tr key={product.id}>
                    <td className="spare-pricing__sn-col">{index + 1}</td>
                    <td className="spare-pricing__item-col">
                      <button
                        type="button"
                        className="spare-pricing__item spare-pricing__item-btn"
                        aria-label={`View details for ${product.name}`}
                        onClick={() => setPeekProduct(product)}
                        onMouseEnter={event => showItemLevelTip(
                          event,
                          product,
                          newSelling,
                        )}
                        onMouseLeave={hideItemLevelTip}
                      >
                        <span className="spare-pricing__item-sku">
                          {sku}
                          {' '}
                          <em className="spare-pricing__item-stock">
                            (qty:
                            <span className="spare-pricing__item-stock-qty">{stockQty}</span>
                            {' '}
                            pcs)
                          </em>
                        </span>
                        <span className="spare-pricing__item-name">{product.name}</span>
                      </button>
                    </td>
                    <td className="spare-pricing__cost-col">
                      <PurchaseCostCell
                        productId={product.id}
                        productName={product.name}
                        value={draftCost}
                        onChange={handleCostChange}
                        notFromLatest={showNotLatest}
                        hint={purchaseHint}
                      />
                    </td>
                    <td className="spare-pricing__cost-col">
                      <MoneyCell
                        value={landingInr}
                        label={`Landing cost for ${product.name}`}
                        title={landingTitle}
                      />
                    </td>
                    <td className="spare-pricing__cost-col">
                      <MoneyCell
                        value={currentSelling}
                        label={`Current selling price for ${product.name}`}
                      />
                    </td>
                    <td className="spare-pricing__cost-col">
                      <ProfitCell
                        percent={currentProfitPct}
                        label={`Current profit percent for ${product.name}`}
                        title={
                          landingInr > 0
                            ? `((${currentSelling} − ${landingInr}) / ${landingInr}) × 100`
                            : 'Landing is 0 → 100%'
                        }
                      />
                    </td>
                    <td className="spare-pricing__cost-col">
                      <div
                        className="spare-pricing__cost-cell spare-pricing__field-box is-editable spare-pricing__new-sell"
                        onMouseEnter={event => showNewSellLevelTip(event, newSelling)}
                        onMouseLeave={hideNewSellLevelTip}
                        onFocus={event => showNewSellLevelTip(event, newSelling)}
                        onBlur={hideNewSellLevelTip}
                      >
                        <span className="spare-pricing__currency is-inr" aria-hidden>₹</span>
                        <DecimalAmountInput
                          className="spare-pricing__input spare-pricing__cost-input"
                          value={ceilInr(newSelling)}
                          onChange={next => handleNewSellingChange(product.id, next ?? 0)}
                          min={0}
                          decimals={0}
                          aria-label={`New selling price for ${product.name}`}
                        />
                      </div>
                    </td>
                    <td className="spare-pricing__cost-col">
                      <div
                        className="spare-pricing__cost-cell spare-pricing__field-box is-editable"
                        title={
                          landingInr > 0
                            ? `Sets new sell = ${landingInr} × (1 + %/100)`
                            : 'Landing is 0 — profit stays 100% until landing is set'
                        }
                      >
                        <DecimalAmountInput
                          className="spare-pricing__input spare-pricing__cost-input"
                          value={Math.round(newProfitPct * 10) / 10}
                          onChange={next => handleNewProfitChange(
                            product.id,
                            next ?? 0,
                            landingInr,
                          )}
                          decimals={1}
                          aria-label={`New profit percent for ${product.name}`}
                        />
                        <span className="spare-pricing__suffix spare-pricing__pct-suffix" aria-hidden>%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {peekProduct ? (
        <SparePricingProductPeek
          product={peekProduct}
          onClose={() => setPeekProduct(null)}
          onHidden={productId => {
            onProductHidden?.(productId);
            setPeekProduct(null);
          }}
        />
      ) : null}

      <SparePricingFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        selected={tableFilters}
        counts={filterCounts}
        onApply={setTableFilters}
      />

      <SparePricingLevelBulkPanel
        open={levelBulkOpen}
        onClose={() => setLevelBulkOpen(false)}
        rows={levelBulkRows}
        initialDealerProfitPercent={draft.dealerProfitPercent}
        initialAdjusts={draft.levelPriceAdjusts}
        onDealerListRatesApplied={handleDealerListRatesApplied}
        onLevelsApplied={handleLevelsApplied}
      />

      {newSellLevelTip
        ? createPortal(
          <div
            className="spare-pricing__level-tip"
            style={{ left: newSellLevelTip.left, top: newSellLevelTip.top }}
            role="tooltip"
          >
            <div className="spare-pricing__level-tip-head">
              Draft levels on New sell
              {' '}
              <strong>
                ₹
                {formatInrAmount(newSellLevelTip.newSell)}
              </strong>
            </div>
            <ul className="spare-pricing__level-tip-list">
              <li>
                <span className="spare-pricing__level-tip-name">Dealers</span>
                <span className="spare-pricing__level-tip-mode">list</span>
                <span className="spare-pricing__level-tip-price">
                  ₹
                  {formatInrAmount(newSellLevelTip.newSell)}
                </span>
              </li>
              {newSellLevelTip.adjusts.length === 0 ? (
                <li className="spare-pricing__level-tip-empty">
                  No draft discount / hike levels
                </li>
              ) : (
                newSellLevelTip.adjusts.map(adjust => {
                  const charge = applyPriceLevelPercent(
                    newSellLevelTip.newSell,
                    adjust.mode,
                    adjust.percent,
                  );
                  return (
                    <li key={adjust.levelId}>
                      <span className="spare-pricing__level-tip-name">{adjust.levelName}</span>
                      <span
                        className={
                          adjust.mode === 'discount'
                            ? 'spare-pricing__level-tip-mode is-discount'
                            : 'spare-pricing__level-tip-mode is-hike'
                        }
                      >
                        {formatLevelAdjustLabel(adjust)}
                      </span>
                      <span className="spare-pricing__level-tip-price">
                        ₹
                        {formatInrAmount(charge)}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )
        : null}

      {itemLevelTip
        ? createPortal(
          <div
            className="spare-pricing__level-tip spare-pricing__level-tip--item"
            style={{ left: itemLevelTip.left, top: itemLevelTip.top }}
            role="tooltip"
          >
            <div className="spare-pricing__level-tip-head">
              Level pricing on New sell
              {' '}
              <strong>
                ₹
                {formatInrAmount(itemLevelTip.listRate)}
              </strong>
              <span className="spare-pricing__level-tip-sub">
                {itemLevelTip.productName}
              </span>
            </div>

            <div className="spare-pricing__level-tip-section">
              <div className="spare-pricing__level-tip-section-title">Existing</div>
              <ul className="spare-pricing__level-tip-list">
                {itemLevelTip.existingRows.length === 0 ? (
                  <li className="spare-pricing__level-tip-empty">
                    No spare level rules on this item
                  </li>
                ) : (
                  itemLevelTip.existingRows.map(row => (
                    <li key={`existing-${row.levelId}`}>
                      <span className="spare-pricing__level-tip-name">{row.levelName}</span>
                      <span
                        className={
                          row.mode === 'discount'
                            ? 'spare-pricing__level-tip-mode is-discount'
                            : row.mode === 'increment'
                              ? 'spare-pricing__level-tip-mode is-hike'
                              : 'spare-pricing__level-tip-mode'
                        }
                      >
                        {formatExistingSpareLevelMode(row)}
                      </span>
                      <span className="spare-pricing__level-tip-price">
                        ₹
                        {formatInrAmount(row.chargeRate)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="spare-pricing__level-tip-section">
              <div className="spare-pricing__level-tip-section-title">Draft (until Save)</div>
              <ul className="spare-pricing__level-tip-list">
                <li>
                  <span className="spare-pricing__level-tip-name">Dealers</span>
                  <span className="spare-pricing__level-tip-mode">list</span>
                  <span className="spare-pricing__level-tip-price">
                    ₹
                    {formatInrAmount(itemLevelTip.listRate)}
                  </span>
                </li>
                {itemLevelTip.draftAdjusts.length === 0 ? (
                  <li className="spare-pricing__level-tip-empty">
                    No draft discount / hike levels
                  </li>
                ) : (
                  itemLevelTip.draftAdjusts.map(adjust => {
                    const charge = applyPriceLevelPercent(
                      itemLevelTip.listRate,
                      adjust.mode,
                      adjust.percent,
                    );
                    return (
                      <li key={`draft-${adjust.levelId}`}>
                        <span className="spare-pricing__level-tip-name">{adjust.levelName}</span>
                        <span
                          className={
                            adjust.mode === 'discount'
                              ? 'spare-pricing__level-tip-mode is-discount'
                              : 'spare-pricing__level-tip-mode is-hike'
                          }
                        >
                          {formatLevelAdjustLabel(adjust)}
                        </span>
                        <span className="spare-pricing__level-tip-price">
                          ₹
                          {formatInrAmount(charge)}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>,
          document.body,
        )
        : null}
    </section>
  );
};
