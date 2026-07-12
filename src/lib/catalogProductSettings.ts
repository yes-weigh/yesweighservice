import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  CATALOG_PRODUCT_SETTINGS_DOC_ID,
  DEFAULT_MASTER_CARTON_QUANTITIES,
  DEFAULT_MRP_RULES,
  MRP_FORMULA_OPTIONS,
  type CatalogMrpFormulaId,
  type CatalogMrpGroupRule,
  type CatalogMrpRules,
} from '../constants/catalogProductSettings';

export type { CatalogMrpFormulaId, CatalogMrpGroupRule, CatalogMrpRules };

export interface CatalogProductSettings {
  masterCartonQuantities: number[];
  mrpRules: CatalogMrpRules;
  updatedAt: string;
  updatedBy?: string | null;
}

const FORMULA_IDS = new Set<CatalogMrpFormulaId>(MRP_FORMULA_OPTIONS.map(o => o.id));

function normalizeQuantities(values: unknown): number[] {
  if (!Array.isArray(values)) return [...DEFAULT_MASTER_CARTON_QUANTITIES];
  const next = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && Number.isInteger(value) && value > 0);
  return [...new Set(next)].sort((a, b) => a - b);
}

export function normalizeMrpMultiplier(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 1000) / 1000;
}

export function normalizeMrpFormulaId(
  value: unknown,
  fallback: CatalogMrpFormulaId,
): CatalogMrpFormulaId {
  if (typeof value === 'string' && FORMULA_IDS.has(value as CatalogMrpFormulaId)) {
    return value as CatalogMrpFormulaId;
  }
  return fallback;
}

function normalizeGroupRule(
  raw: unknown,
  fallback: CatalogMrpGroupRule,
): CatalogMrpGroupRule {
  if (!raw || typeof raw !== 'object') {
    return { formula: fallback.formula, multiplier: fallback.multiplier };
  }
  const data = raw as Record<string, unknown>;
  return {
    formula: normalizeMrpFormulaId(data.formula, fallback.formula),
    multiplier: normalizeMrpMultiplier(data.multiplier, fallback.multiplier),
  };
}

/** Supports new `{ categorized, genericAndUncategorized }` and legacy flat multipliers. */
export function normalizeMrpRules(raw: unknown): CatalogMrpRules {
  if (!raw || typeof raw !== 'object') {
    return {
      categorized: { ...DEFAULT_MRP_RULES.categorized },
      genericAndUncategorized: { ...DEFAULT_MRP_RULES.genericAndUncategorized },
    };
  }
  const data = raw as Record<string, unknown>;

  // Legacy: { categorizedMultiplier, genericAndUncategorizedMultiplier }
  if (
    'categorizedMultiplier' in data
    || 'genericAndUncategorizedMultiplier' in data
  ) {
    return {
      categorized: {
        formula: 'gstThenMultiply',
        multiplier: normalizeMrpMultiplier(
          data.categorizedMultiplier,
          DEFAULT_MRP_RULES.categorized.multiplier,
        ),
      },
      genericAndUncategorized: {
        formula: 'gstThenMultiply',
        multiplier: normalizeMrpMultiplier(
          data.genericAndUncategorizedMultiplier,
          DEFAULT_MRP_RULES.genericAndUncategorized.multiplier,
        ),
      },
    };
  }

  return {
    categorized: normalizeGroupRule(data.categorized, DEFAULT_MRP_RULES.categorized),
    genericAndUncategorized: normalizeGroupRule(
      data.genericAndUncategorized,
      DEFAULT_MRP_RULES.genericAndUncategorized,
    ),
  };
}

export async function loadCatalogProductSettings(): Promise<CatalogProductSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID));
    if (!snap.exists()) {
      return {
        masterCartonQuantities: [...DEFAULT_MASTER_CARTON_QUANTITIES],
        mrpRules: {
          categorized: { ...DEFAULT_MRP_RULES.categorized },
          genericAndUncategorized: { ...DEFAULT_MRP_RULES.genericAndUncategorized },
        },
        updatedAt: '',
      };
    }
    const data = snap.data();
    const quantities = normalizeQuantities(data.masterCartonQuantities);
    return {
      masterCartonQuantities: quantities.length
        ? quantities
        : [...DEFAULT_MASTER_CARTON_QUANTITIES],
      mrpRules: normalizeMrpRules(data.mrpRules),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return {
      masterCartonQuantities: [...DEFAULT_MASTER_CARTON_QUANTITIES],
      mrpRules: {
        categorized: { ...DEFAULT_MRP_RULES.categorized },
        genericAndUncategorized: { ...DEFAULT_MRP_RULES.genericAndUncategorized },
      },
      updatedAt: '',
    };
  }
}

export async function loadMasterCartonQuantities(): Promise<number[]> {
  const settings = await loadCatalogProductSettings();
  return settings.masterCartonQuantities;
}

export async function loadMrpRules(): Promise<CatalogMrpRules> {
  const settings = await loadCatalogProductSettings();
  return settings.mrpRules;
}

export async function saveMasterCartonQuantities(
  quantities: number[],
  updatedBy?: string | null,
): Promise<number[]> {
  const masterCartonQuantities = normalizeQuantities(quantities);
  if (!masterCartonQuantities.length) {
    throw new Error('Add at least one master carton quantity.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID),
    {
      masterCartonQuantities,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return masterCartonQuantities;
}

export async function saveMrpRules(
  rules: CatalogMrpRules,
  updatedBy?: string | null,
): Promise<CatalogMrpRules> {
  const mrpRules = normalizeMrpRules(rules);
  if (
    mrpRules.categorized.multiplier <= 0
    || mrpRules.genericAndUncategorized.multiplier <= 0
  ) {
    throw new Error('MRP multipliers must be greater than zero.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID),
    {
      mrpRules,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return mrpRules;
}
