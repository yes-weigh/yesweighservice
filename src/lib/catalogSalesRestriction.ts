import {
  canonicalIndiaState,
  INDIA_STATE_NAMES,
  UNSPECIFIED_STATE,
} from './indiaStates';
import type { CatalogProduct } from '../types/catalog';

const ALLOWED_STATES = new Set(INDIA_STATE_NAMES);

export function sanitizeRestrictedSalesStates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = canonicalIndiaState(String(item ?? ''));
    if (name === UNSPECIFIED_STATE || !ALLOWED_STATES.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function isCatalogProductSalesRestricted(
  product: Pick<CatalogProduct, 'restrictedSalesStates'> | null | undefined,
  billingState: string | null | undefined,
): boolean {
  const blocked = sanitizeRestrictedSalesStates(product?.restrictedSalesStates);
  if (!blocked.length) return false;
  const state = canonicalIndiaState(billingState);
  if (state === UNSPECIFIED_STATE) return false;
  return blocked.includes(state);
}
