/** Spare pricing table filters (column concepts). Within a group: OR. Across groups: AND. */

export type SparePricingFilterKey =
  | 'purchaseGt0'
  | 'purchaseZero'
  | 'currencyUsd'
  | 'currencyInr'
  | 'landingGt0'
  | 'landingZero'
  | 'sellGt0'
  | 'sellZero'
  | 'profitPositive'
  | 'profitHundred'
  | 'profitLoss'
  | 'newSellChanged'
  | 'newSellSame'
  | 'inStock'
  | 'outOfStock';

export type SparePricingFilterGroupId =
  | 'purchase'
  | 'currency'
  | 'landing'
  | 'sell'
  | 'profit'
  | 'newSell'
  | 'stock';

export type SparePricingFilterOption = {
  key: SparePricingFilterKey;
  label: string;
};

export type SparePricingFilterGroup = {
  id: SparePricingFilterGroupId;
  label: string;
  options: readonly SparePricingFilterOption[];
};

export const SPARE_PRICING_FILTER_GROUPS: readonly SparePricingFilterGroup[] = [
  {
    id: 'purchase',
    label: 'Purchase',
    options: [
      { key: 'purchaseGt0', label: 'Purchase > 0' },
      { key: 'purchaseZero', label: 'Purchase = 0' },
    ],
  },
  {
    id: 'currency',
    label: 'Currency',
    options: [
      { key: 'currencyUsd', label: 'USD ($)' },
      { key: 'currencyInr', label: 'INR (₹)' },
    ],
  },
  {
    id: 'landing',
    label: 'Landing',
    options: [
      { key: 'landingGt0', label: 'Landing > 0' },
      { key: 'landingZero', label: 'Landing = 0' },
    ],
  },
  {
    id: 'sell',
    label: 'Sell',
    options: [
      { key: 'sellGt0', label: 'Sell > 0' },
      { key: 'sellZero', label: 'Sell = 0' },
    ],
  },
  {
    id: 'profit',
    label: 'Profit %',
    options: [
      { key: 'profitPositive', label: 'Profit > 0%' },
      { key: 'profitHundred', label: '100% (no landing)' },
      { key: 'profitLoss', label: 'Loss (< 0%)' },
    ],
  },
  {
    id: 'newSell',
    label: 'New sell',
    options: [
      { key: 'newSellChanged', label: 'Changed from sell' },
      { key: 'newSellSame', label: 'Same as sell' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    options: [
      { key: 'inStock', label: 'In stock' },
      { key: 'outOfStock', label: 'Out of stock' },
    ],
  },
] as const;

export type SparePricingRowMetrics = {
  purchaseAmount: number;
  currencyCode: string;
  landingInr: number;
  sell: number;
  profitPercent: number;
  newSell: number;
  stock: number;
};

function matchesKey(metrics: SparePricingRowMetrics, key: SparePricingFilterKey): boolean {
  const purchase = Number(metrics.purchaseAmount) || 0;
  const landing = Number(metrics.landingInr) || 0;
  const sell = Number(metrics.sell) || 0;
  const newSell = Number(metrics.newSell) || 0;
  const profit = Number(metrics.profitPercent) || 0;
  const stock = Number(metrics.stock) || 0;
  const currency = String(metrics.currencyCode ?? '').trim().toUpperCase();

  switch (key) {
    case 'purchaseGt0':
      return purchase > 0;
    case 'purchaseZero':
      return !(purchase > 0);
    case 'currencyUsd':
      return currency === 'USD';
    case 'currencyInr':
      return currency !== 'USD';
    case 'landingGt0':
      return landing > 0;
    case 'landingZero':
      return !(landing > 0);
    case 'sellGt0':
      return sell > 0;
    case 'sellZero':
      return !(sell > 0);
    case 'profitPositive':
      return landing > 0 && profit > 0;
    case 'profitHundred':
      return !(landing > 0);
    case 'profitLoss':
      return landing > 0 && profit < 0;
    case 'newSellChanged':
      return Math.round(newSell) !== Math.round(sell);
    case 'newSellSame':
      return Math.round(newSell) === Math.round(sell);
    case 'inStock':
      return stock > 0;
    case 'outOfStock':
      return !(stock > 0);
    default:
      return true;
  }
}

export function emptySparePricingFilterCounts(): Record<SparePricingFilterKey, number> {
  const counts = {} as Record<SparePricingFilterKey, number>;
  for (const group of SPARE_PRICING_FILTER_GROUPS) {
    for (const option of group.options) {
      counts[option.key] = 0;
    }
  }
  return counts;
}

export function countSparePricingFilters(
  rows: readonly SparePricingRowMetrics[],
): Record<SparePricingFilterKey, number> {
  const counts = emptySparePricingFilterCounts();
  for (const row of rows) {
    for (const group of SPARE_PRICING_FILTER_GROUPS) {
      for (const option of group.options) {
        if (matchesKey(row, option.key)) counts[option.key] += 1;
      }
    }
  }
  return counts;
}

export function matchesSparePricingFilters(
  metrics: SparePricingRowMetrics,
  selected: ReadonlySet<SparePricingFilterKey>,
): boolean {
  if (selected.size === 0) return true;
  for (const group of SPARE_PRICING_FILTER_GROUPS) {
    const active = group.options.filter(option => selected.has(option.key));
    if (active.length === 0) continue;
    if (!active.some(option => matchesKey(metrics, option.key))) return false;
  }
  return true;
}
