import type {
  CatalogMrpFormulaId,
  CatalogMrpGroupRule,
  CatalogMrpRules,
} from '../constants/catalogProductSettings';
import { DEFAULT_MRP_RULES, MRP_FORMULA_OPTIONS } from '../constants/catalogProductSettings';
import { isCatalogSparePartProduct } from './catalog';
import type { CatalogCategory, CatalogProduct } from '../types/catalog';

export type MrpProductRef = Pick<
  CatalogProduct,
  'categoryId' | 'categoryName' | 'rate' | 'taxPercentage'
>;

export interface ProductMrpBreakdown {
  /** MRP including GST (primary display / label value). */
  mrpInclGst: number;
  /** Implied taxable value before GST inside MRP (for share subtitle). */
  mrpExclGst: number;
  /** GST portion of MRP (for share subtitle). */
  mrpGst: number;
  taxPercentage: number;
  multiplier: number;
  formula: CatalogMrpFormulaId;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addPercent(amount: number, taxPercentage: number): number {
  const pct = Number.isFinite(taxPercentage) && taxPercentage > 0 ? taxPercentage : 0;
  // a + tax%  ⇒  a + a×tax/100
  return amount + amount * (pct / 100);
}

/** Pick the settings rule for this product’s category group. */
export function resolveMrpGroupRule(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  rules: CatalogMrpRules = DEFAULT_MRP_RULES,
  categories: CatalogCategory[] = [],
): CatalogMrpGroupRule {
  const safe = rules ?? DEFAULT_MRP_RULES;
  if (isCatalogSparePartProduct(product, categories)) {
    return { ...safe.genericAndUncategorized };
  }
  return { ...safe.categorized };
}

/** @deprecated Use resolveMrpGroupRule — kept for older call sites. */
export function resolveMrpMultiplier(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  rules: CatalogMrpRules = DEFAULT_MRP_RULES,
  categories: CatalogCategory[] = [],
): number {
  return resolveMrpGroupRule(product, rules, categories).multiplier;
}

export function getMrpFormulaOption(id: CatalogMrpFormulaId) {
  return MRP_FORMULA_OPTIONS.find(o => o.id === id) ?? MRP_FORMULA_OPTIONS[0];
}

/**
 * Apply a configured MRP formula.
 * `tax%` always means percent-of-base: a + tax% ⇒ a + a×tax/100.
 */
export function calculateProductMrpInclGst(
  rate: number,
  taxPercentage: number,
  rule: CatalogMrpGroupRule | number,
  formula: CatalogMrpFormulaId = 'gstThenMultiply',
): number {
  const price = Number.isFinite(rate) ? rate : 0;
  const pct = Number.isFinite(taxPercentage) ? taxPercentage : 0;

  let formulaId: CatalogMrpFormulaId;
  let multiplier: number;
  if (typeof rule === 'number') {
    // Legacy: (rate, tax, multiplier) — GST then multiply
    formulaId = formula;
    multiplier = rule;
  } else {
    formulaId = rule.formula;
    multiplier = rule.multiplier;
  }

  const mult = Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : DEFAULT_MRP_RULES.categorized.multiplier;

  switch (formulaId) {
    case 'multiplyThenGst': {
      const base = price * mult;
      return round2(addPercent(base, pct));
    }
    case 'multiplyPlusGstOnRate':
      return round2(price * mult + price * (pct / 100));
    case 'multiplyOnly':
      return round2(price * mult);
    case 'gstOnly':
      return round2(addPercent(price, pct));
    case 'gstThenMultiply':
    default:
      return round2(addPercent(price, pct) * mult);
  }
}

export function calculateProductMrpBreakdown(
  rate: number,
  taxPercentage: number,
  rule: CatalogMrpGroupRule | number,
  formula: CatalogMrpFormulaId = 'gstThenMultiply',
): ProductMrpBreakdown {
  const tax = Number.isFinite(taxPercentage) && taxPercentage > 0 ? taxPercentage : 0;
  const groupRule: CatalogMrpGroupRule = typeof rule === 'number'
    ? { formula, multiplier: rule }
    : rule;

  const mrpPrecise = calculateProductMrpInclGst(rate, tax, groupRule);
  // Share cards display whole-rupee MRP (historical behavior).
  const mrpInclRounded = Math.round(mrpPrecise);

  let mrpExclGst: number;
  let mrpGst: number;
  if (groupRule.formula === 'multiplyOnly') {
    mrpExclGst = mrpInclRounded;
    mrpGst = 0;
  } else if (tax > 0 && (
    groupRule.formula === 'gstThenMultiply'
    || groupRule.formula === 'multiplyThenGst'
    || groupRule.formula === 'gstOnly'
  )) {
    mrpExclGst = round2(mrpInclRounded / (1 + tax / 100));
    mrpGst = round2(mrpInclRounded - mrpExclGst);
  } else if (groupRule.formula === 'multiplyPlusGstOnRate' && tax > 0) {
    const price = Number.isFinite(rate) ? rate : 0;
    const gstPart = round2(price * (tax / 100));
    mrpGst = Math.min(gstPart, mrpInclRounded);
    mrpExclGst = round2(mrpInclRounded - mrpGst);
  } else {
    mrpExclGst = mrpInclRounded;
    mrpGst = 0;
  }

  return {
    mrpInclGst: mrpInclRounded,
    mrpExclGst,
    mrpGst,
    taxPercentage: tax,
    multiplier: groupRule.multiplier,
    formula: groupRule.formula,
  };
}

export function calculateProductMrpForCatalogItem(
  product: MrpProductRef,
  rules: CatalogMrpRules = DEFAULT_MRP_RULES,
  categories: CatalogCategory[] = [],
): ProductMrpBreakdown {
  const groupRule = resolveMrpGroupRule(product, rules, categories);
  return calculateProductMrpBreakdown(product.rate, product.taxPercentage, groupRule);
}

export function formatProductMrpInclGst(mrpInclGst: number): string {
  return `₹ ${mrpInclGst.toFixed(2)}`;
}
