/** Default master carton quantity options for package info dropdowns. */
export const DEFAULT_MASTER_CARTON_QUANTITIES = [1, 2, 4, 5] as const;

export const CATALOG_PRODUCT_SETTINGS_DOC_ID = 'productSettings';

/** Default MRP multipliers when a formula uses × multiplier. */
export const DEFAULT_MRP_CATEGORIZED_MULTIPLIER = 2.5;
export const DEFAULT_MRP_GENERIC_AND_UNCATEGORIZED_MULTIPLIER = 2.5;

/**
 * How MRP is built from dealer rate, tax%, and multiplier.
 * Note: `a + tax%` always means `a + a×tax/100` (same as `a × (1 + tax/100)`).
 */
export type CatalogMrpFormulaId =
  /** (rate + rate×tax%/100) × multiplier */
  | 'gstThenMultiply'
  /** (rate×multiplier) + (rate×multiplier)×tax%/100 — same numeric result as gstThenMultiply */
  | 'multiplyThenGst'
  /** (rate×multiplier) + (rate×tax%/100) — GST% only on original rate */
  | 'multiplyPlusGstOnRate'
  /** rate × multiplier (ignore tax%) */
  | 'multiplyOnly'
  /** rate + rate×tax%/100 (ignore multiplier) */
  | 'gstOnly';

export interface CatalogMrpGroupRule {
  formula: CatalogMrpFormulaId;
  multiplier: number;
}

export interface CatalogMrpRules {
  categorized: CatalogMrpGroupRule;
  genericAndUncategorized: CatalogMrpGroupRule;
}

export interface CatalogMrpFormulaOption {
  id: CatalogMrpFormulaId;
  label: string;
  expression: string;
  hint: string;
}

export const MRP_FORMULA_OPTIONS: CatalogMrpFormulaOption[] = [
  {
    id: 'gstThenMultiply',
    label: 'GST% → × mult',
    expression: '(rate + rate×tax%/100) × mult',
    hint: '',
  },
  {
    id: 'multiplyThenGst',
    label: '× mult → GST%',
    expression: '(rate×mult) + (rate×mult)×tax%/100',
    hint: '',
  },
  {
    id: 'multiplyPlusGstOnRate',
    label: '× mult + GST% on rate',
    expression: '(rate×mult) + (rate×tax%/100)',
    hint: '',
  },
  {
    id: 'multiplyOnly',
    label: '× mult only',
    expression: 'rate × mult',
    hint: '',
  },
  {
    id: 'gstOnly',
    label: 'GST% only',
    expression: 'rate + rate×tax%/100',
    hint: '',
  },
];

export const DEFAULT_MRP_RULES: CatalogMrpRules = {
  categorized: {
    formula: 'gstThenMultiply',
    multiplier: DEFAULT_MRP_CATEGORIZED_MULTIPLIER,
  },
  genericAndUncategorized: {
    formula: 'gstThenMultiply',
    multiplier: DEFAULT_MRP_GENERIC_AND_UNCATEGORIZED_MULTIPLIER,
  },
};
