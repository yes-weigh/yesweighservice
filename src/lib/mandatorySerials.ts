/**
 * Weighing-scale (and Indicators & CCM) lines need a serial per unit
 * before warehouse can book courier / mark delivered.
 * Add SKUs or catalog product ids here when the user shares exemptions.
 */
export const MANDATORY_SERIAL_CATEGORY_NAMES = new Set([
  'WEIGHING SCALE IMPORT',
  'BILL PRINTING SCALES',
  'WEIGHING SCALES INDIA',
  'ANALYTICAL SCALES',
  'INDUSTRIAL WEIGHING SCALE',
  'INDICATORS & CCM',
]);

export const MANDATORY_SERIAL_EXEMPT_SKUS = new Set<string>([
  // User will share exempt SKUs.
]);

export const MANDATORY_SERIAL_EXEMPT_PRODUCT_IDS = new Set<string>([
  // User will share exempt catalog product ids.
]);

function compactSku(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function isMandatorySerialExemptLine(line: {
  sku?: string | null;
  itemId?: string | null;
}): boolean {
  const sku = compactSku(line.sku);
  if (sku && MANDATORY_SERIAL_EXEMPT_SKUS.has(sku)) return true;
  const itemId = String(line.itemId ?? '').trim();
  return Boolean(itemId && MANDATORY_SERIAL_EXEMPT_PRODUCT_IDS.has(itemId));
}

export function lineIsMandatorySerialCategory(line: {
  categoryName?: string | null;
  isWeighingScale?: boolean | null;
}): boolean {
  if (line.isWeighingScale === true) return true;
  const name = String(line.categoryName ?? '').trim().toUpperCase();
  return Boolean(name) && MANDATORY_SERIAL_CATEGORY_NAMES.has(name);
}
