import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  CATALOG_PRODUCT_SETTINGS_DOC_ID,
  DEFAULT_APPROVAL_NUMBERS,
  DEFAULT_MASTER_CARTON_QUANTITIES,
  DEFAULT_MODEL_NUMBERS,
  DEFAULT_MRP_RULES,
  MRP_FORMULA_OPTIONS,
  type CatalogApprovalNumberOption,
  type CatalogMrpFormulaId,
  type CatalogMrpGroupRule,
  type CatalogMrpRules,
} from '../constants/catalogProductSettings';

export type {
  CatalogApprovalNumberOption,
  CatalogMrpFormulaId,
  CatalogMrpGroupRule,
  CatalogMrpRules,
};

export interface CatalogProductSettings {
  masterCartonQuantities: number[];
  mrpRules: CatalogMrpRules;
  modelNumbers: string[];
  approvalNumbers: CatalogApprovalNumberOption[];
  updatedAt: string;
  updatedBy?: string | null;
}

const FORMULA_IDS = new Set<CatalogMrpFormulaId>(MRP_FORMULA_OPTIONS.map(o => o.id));
const MAX_APPROVAL_PDF_BYTES = 15 * 1024 * 1024;

function normalizeQuantities(values: unknown): number[] {
  if (!Array.isArray(values)) return [...DEFAULT_MASTER_CARTON_QUANTITIES];
  const next = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && Number.isInteger(value) && value > 0);
  return [...new Set(next)].sort((a, b) => a - b);
}

export function normalizeOptionStrings(
  values: unknown,
  fallback: string[] = [],
): string[] {
  if (!Array.isArray(values)) return [...fallback];
  const next = values
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(next)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Accepts legacy string[] or `{ value, pdf… }[]`. */
export function normalizeApprovalNumbers(
  values: unknown,
  fallback: string[] = DEFAULT_APPROVAL_NUMBERS,
): CatalogApprovalNumberOption[] {
  if (!Array.isArray(values)) {
    return fallback.map(value => ({ value }));
  }

  const byValue = new Map<string, CatalogApprovalNumberOption>();
  for (const raw of values) {
    if (typeof raw === 'string') {
      const value = raw.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!byValue.has(key)) byValue.set(key, { value });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const data = raw as Record<string, unknown>;
    const value = String(data.value ?? data.label ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const pdfUrl = typeof data.pdfUrl === 'string' && data.pdfUrl.trim()
      ? data.pdfUrl.trim()
      : null;
    const pdfStoragePath = typeof data.pdfStoragePath === 'string' && data.pdfStoragePath.trim()
      ? data.pdfStoragePath.trim()
      : null;
    const pdfFileName = typeof data.pdfFileName === 'string' && data.pdfFileName.trim()
      ? data.pdfFileName.trim()
      : null;
    byValue.set(key, {
      value,
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(pdfStoragePath ? { pdfStoragePath } : {}),
      ...(pdfFileName ? { pdfFileName } : {}),
    });
  }

  return [...byValue.values()].sort((a, b) =>
    a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }),
  );
}

export function approvalNumberValues(options: CatalogApprovalNumberOption[]): string[] {
  return options.map(option => option.value);
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

function emptySettings(): CatalogProductSettings {
  return {
    masterCartonQuantities: [...DEFAULT_MASTER_CARTON_QUANTITIES],
    mrpRules: {
      categorized: { ...DEFAULT_MRP_RULES.categorized },
      genericAndUncategorized: { ...DEFAULT_MRP_RULES.genericAndUncategorized },
    },
    modelNumbers: [...DEFAULT_MODEL_NUMBERS],
    approvalNumbers: normalizeApprovalNumbers(DEFAULT_APPROVAL_NUMBERS),
    updatedAt: '',
  };
}

export async function loadCatalogProductSettings(): Promise<CatalogProductSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID));
    if (!snap.exists()) return emptySettings();
    const data = snap.data();
    const quantities = normalizeQuantities(data.masterCartonQuantities);
    return {
      masterCartonQuantities: quantities.length
        ? quantities
        : [...DEFAULT_MASTER_CARTON_QUANTITIES],
      mrpRules: normalizeMrpRules(data.mrpRules),
      modelNumbers: normalizeOptionStrings(data.modelNumbers, DEFAULT_MODEL_NUMBERS),
      approvalNumbers: normalizeApprovalNumbers(data.approvalNumbers, DEFAULT_APPROVAL_NUMBERS),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return emptySettings();
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

export async function loadModelNumbers(): Promise<string[]> {
  const settings = await loadCatalogProductSettings();
  return settings.modelNumbers;
}

export async function loadApprovalNumberOptions(): Promise<CatalogApprovalNumberOption[]> {
  const settings = await loadCatalogProductSettings();
  return settings.approvalNumbers;
}

/** Values only — for product select dropdowns. */
export async function loadApprovalNumbers(): Promise<string[]> {
  const options = await loadApprovalNumberOptions();
  return approvalNumberValues(options);
}

async function touchSettings(
  payload: Record<string, unknown>,
  updatedBy?: string | null,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', CATALOG_PRODUCT_SETTINGS_DOC_ID),
    {
      ...payload,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
}

export async function saveMasterCartonQuantities(
  quantities: number[],
  updatedBy?: string | null,
): Promise<number[]> {
  const masterCartonQuantities = normalizeQuantities(quantities);
  if (!masterCartonQuantities.length) {
    throw new Error('Add at least one master carton quantity.');
  }
  await touchSettings({ masterCartonQuantities }, updatedBy);
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
  await touchSettings({ mrpRules }, updatedBy);
  return mrpRules;
}

export async function saveModelNumbers(
  values: string[],
  updatedBy?: string | null,
): Promise<string[]> {
  const modelNumbers = normalizeOptionStrings(values);
  await touchSettings({ modelNumbers }, updatedBy);
  return modelNumbers;
}

export async function saveApprovalNumbers(
  values: CatalogApprovalNumberOption[] | string[],
  updatedBy?: string | null,
): Promise<CatalogApprovalNumberOption[]> {
  const approvalNumbers = normalizeApprovalNumbers(values);
  await touchSettings({ approvalNumbers }, updatedBy);
  return approvalNumbers;
}

function sanitizeApprovalPathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'approval';
}

function assertApprovalPdfFile(file: File): void {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  if (type && type !== 'application/pdf' && !name.endsWith('.pdf')) {
    throw new Error('Only PDF files are allowed for approval documents.');
  }
  if (!type && !name.endsWith('.pdf')) {
    throw new Error('Only PDF files are allowed for approval documents.');
  }
  if (file.size <= 0) {
    throw new Error('The selected PDF is empty.');
  }
  if (file.size > MAX_APPROVAL_PDF_BYTES) {
    throw new Error('PDF must be 15 MB or smaller.');
  }
}

/** Upload optional PDF for an approval number and persist settings. */
export async function attachApprovalNumberPdf(
  approvalValue: string,
  file: File,
  updatedBy?: string | null,
): Promise<CatalogApprovalNumberOption[]> {
  const value = approvalValue.trim();
  if (!value) throw new Error('Approval number is required.');
  assertApprovalPdfFile(file);

  const settings = await loadCatalogProductSettings();
  const existing = settings.approvalNumbers.find(
    option => option.value.toLowerCase() === value.toLowerCase(),
  );
  if (!existing) {
    throw new Error(`Approval number "${value}" was not found.`);
  }

  if (existing.pdfStoragePath) {
    await deleteObject(ref(storage, existing.pdfStoragePath)).catch(() => undefined);
  }

  const stamp = Date.now();
  const storagePath = `productSettings/approvalPdfs/${sanitizeApprovalPathSegment(value)}-${stamp}.pdf`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: 'application/pdf',
    customMetadata: {
      approvalNumber: value,
      originalName: file.name.slice(0, 180),
    },
  });
  const pdfUrl = await getDownloadURL(storageRef);

  const next = settings.approvalNumbers.map(option => (
    option.value.toLowerCase() === value.toLowerCase()
      ? {
          value: option.value,
          pdfUrl,
          pdfStoragePath: storagePath,
          pdfFileName: file.name,
        }
      : option
  ));

  return saveApprovalNumbers(next, updatedBy);
}

/** Remove PDF from an approval number (keeps the number). */
export async function removeApprovalNumberPdf(
  approvalValue: string,
  updatedBy?: string | null,
): Promise<CatalogApprovalNumberOption[]> {
  const value = approvalValue.trim();
  if (!value) throw new Error('Approval number is required.');

  const settings = await loadCatalogProductSettings();
  const existing = settings.approvalNumbers.find(
    option => option.value.toLowerCase() === value.toLowerCase(),
  );
  if (!existing) {
    throw new Error(`Approval number "${value}" was not found.`);
  }

  if (existing.pdfStoragePath) {
    await deleteObject(ref(storage, existing.pdfStoragePath)).catch(() => undefined);
  }

  const next = settings.approvalNumbers.map(option => (
    option.value.toLowerCase() === value.toLowerCase()
      ? { value: option.value }
      : option
  ));

  return saveApprovalNumbers(next, updatedBy);
}

/** Remove approval number and delete its PDF if present. */
export async function removeApprovalNumber(
  approvalValue: string,
  updatedBy?: string | null,
): Promise<CatalogApprovalNumberOption[]> {
  const value = approvalValue.trim();
  const settings = await loadCatalogProductSettings();
  const existing = settings.approvalNumbers.find(
    option => option.value.toLowerCase() === value.toLowerCase(),
  );
  if (existing?.pdfStoragePath) {
    await deleteObject(ref(storage, existing.pdfStoragePath)).catch(() => undefined);
  }
  const next = settings.approvalNumbers.filter(
    option => option.value.toLowerCase() !== value.toLowerCase(),
  );
  return saveApprovalNumbers(next, updatedBy);
}
