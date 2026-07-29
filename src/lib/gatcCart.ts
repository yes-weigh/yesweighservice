import type { CatalogGatcStampingPriceEntry } from '../constants/catalogProductSettings';
import type { CatalogProduct } from '../types/catalog';

export function normalizeGatcIdList(ids: string[] | null | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))];
}

export function productHasLinkedGatc(
  product: Pick<CatalogProduct, 'gatcStampingPriceIds'>,
): boolean {
  return normalizeGatcIdList(product.gatcStampingPriceIds).length > 0;
}

/** Intersect product-linked GATC ids with settings entries (preserve settings order). */
export function resolveGatcOptionsForProduct(
  product: Pick<CatalogProduct, 'gatcStampingPriceIds'>,
  allEntries: CatalogGatcStampingPriceEntry[],
): CatalogGatcStampingPriceEntry[] {
  const allowed = new Set(normalizeGatcIdList(product.gatcStampingPriceIds));
  if (!allowed.size) return [];
  return allEntries.filter(entry => allowed.has(entry.id));
}

export function gatcFeeForId(
  gatcStampingPriceId: string | null | undefined,
  options: CatalogGatcStampingPriceEntry[],
): number {
  const id = String(gatcStampingPriceId ?? '').trim();
  if (!id) return 0;
  const entry = options.find(opt => opt.id === id);
  if (!entry) return 0;
  return Math.round(Number(entry.price) * 100) / 100;
}

export function combinedCartRate(baseRate: number, gatcFeePerUnit: number): number {
  const base = Number.isFinite(baseRate) ? baseRate : 0;
  const fee = Number.isFinite(gatcFeePerUnit) ? gatcFeePerUnit : 0;
  return Math.round((base + fee) * 100) / 100;
}

export function formatGatcOptionLabel(entry: CatalogGatcStampingPriceEntry): string {
  const price = entry.price.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${entry.stampingRange} · ₹${price}`;
}

export function newCartLineId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
