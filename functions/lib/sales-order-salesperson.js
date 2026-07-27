/**
 * Resolve Zoho salesperson from a dealer's assigned portal staff.
 */
import { getFirestore } from 'firebase-admin/firestore';

export function normalizeStaffZohoSalespersonIds(data = {}) {
  const ids = new Set();
  if (Array.isArray(data.zohoSalespersonIds)) {
    for (const id of data.zohoSalespersonIds) {
      const trimmed = String(id ?? '').trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  if (data.zohoSalespersonId) {
    const trimmed = String(data.zohoSalespersonId).trim();
    if (trimmed) ids.add(trimmed);
  }
  if (Array.isArray(data.zohoSalespersonLinks)) {
    for (const link of data.zohoSalespersonLinks) {
      const trimmed = String(link?.id ?? '').trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return [...ids];
}

/**
 * @returns {{ id: string, name: string, staffUid: string, staffName: string } | null}
 */
export async function resolveSalespersonForCustomer(customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return null;

  const db = getFirestore();
  const dealerSnap = await db.collection('zohoCustomers').doc(id).get();
  if (!dealerSnap.exists) return null;
  const dealer = dealerSnap.data() || {};
  const staffUid = dealer.assignedStaffUid ? String(dealer.assignedStaffUid).trim() : '';
  if (!staffUid) return null;

  const userSnap = await db.doc(`users/${staffUid}`).get();
  if (!userSnap.exists) return null;
  const user = userSnap.data() || {};
  if (user.active === false) return null;

  const linkedIds = normalizeStaffZohoSalespersonIds(user);
  if (!linkedIds.length) return null;

  const primary = String(user.zohoSalespersonId ?? '').trim();
  const salespersonId = primary && linkedIds.includes(primary) ? primary : linkedIds[0];

  let salespersonName = String(user.zohoSalespersonName ?? '').trim();
  if (!salespersonName && Array.isArray(user.zohoSalespersonLinks)) {
    const link = user.zohoSalespersonLinks.find(
      row => String(row?.id ?? '').trim() === salespersonId,
    );
    salespersonName = String(link?.name ?? '').trim();
  }
  if (!salespersonName) {
    const spSnap = await db.collection('zohoSalespersons').doc(salespersonId).get();
    if (spSnap.exists) {
      salespersonName = String(spSnap.data()?.name ?? '').trim();
    }
  }
  if (!salespersonName) {
    salespersonName = String(user.displayName ?? 'Salesperson').trim() || 'Salesperson';
  }

  return {
    id: salespersonId,
    name: salespersonName,
    staffUid,
    staffName: String(user.displayName ?? 'Staff').trim() || 'Staff',
  };
}
