import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  canonicalIndiaState,
  sanitizeRestrictedSalesStates,
  UNSPECIFIED_STATE,
} from './india-states.js';

export function isCatalogProductSalesRestricted(product, billingState) {
  const blocked = sanitizeRestrictedSalesStates(product?.restrictedSalesStates);
  if (!blocked.length) return false;
  const state = canonicalIndiaState(billingState);
  if (state === UNSPECIFIED_STATE) return false;
  return blocked.includes(state);
}

/**
 * Reject dealer-placed lines that are blocked for the dealer's billing state.
 * Unknown / unspecified state does not block.
 */
export async function assertLinesNotRestrictedForBillingState(lines, billingState) {
  const state = canonicalIndiaState(billingState);
  if (state === UNSPECIFIED_STATE) return;
  const db = getFirestore();
  const list = Array.isArray(lines) ? lines : [];
  for (const line of list) {
    const id = String(line?.productId ?? '').trim();
    if (!id) continue;
    const snap = await db.doc(`catalogProducts/${id}`).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (!isCatalogProductSalesRestricted(data, billingState)) continue;
    const name = String(data.name ?? 'This product').trim() || 'This product';
    throw new HttpsError(
      'failed-precondition',
      `${name} is restricted in your state and cannot be ordered.`,
    );
  }
}
