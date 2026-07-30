/**
 * Resolve Zoho salesperson from a dealer's assigned portal staff,
 * or from the creating staff member for staff-placed orders.
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

async function resolveSalespersonName(user, salespersonId) {
  let salespersonName = String(user.zohoSalespersonName ?? '').trim();
  if (!salespersonName && Array.isArray(user.zohoSalespersonLinks)) {
    const link = user.zohoSalespersonLinks.find(
      row => String(row?.id ?? '').trim() === salespersonId,
    );
    salespersonName = String(link?.name ?? '').trim();
  }
  if (!salespersonName) {
    const spSnap = await getFirestore().collection('zohoSalespersons').doc(salespersonId).get();
    if (spSnap.exists) {
      salespersonName = String(spSnap.data()?.name ?? '').trim();
    }
  }
  if (!salespersonName) {
    salespersonName = String(user.displayName ?? 'Salesperson').trim() || 'Salesperson';
  }
  return salespersonName;
}

/**
 * Creating staff's top Zoho salesperson (primary id, else first linked).
 * @returns {{ id: string, name: string, staffUid: string, staffName: string } | null}
 */
export async function resolveSalespersonForStaff(staffUid) {
  const uid = String(staffUid ?? '').trim();
  if (!uid) return null;

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  if (!userSnap.exists) return null;
  const user = userSnap.data() || {};
  if (user.active === false) return null;

  const linkedIds = normalizeStaffZohoSalespersonIds(user);
  if (!linkedIds.length) return null;

  const primary = String(user.zohoSalespersonId ?? '').trim();
  const salespersonId = primary && linkedIds.includes(primary) ? primary : linkedIds[0];
  const salespersonName = await resolveSalespersonName(user, salespersonId);

  return {
    id: salespersonId,
    name: salespersonName,
    staffUid: uid,
    staffName: String(user.displayName ?? 'Staff').trim() || 'Staff',
  };
}

/**
 * Explicit Zoho salesperson id (e.g. super admin picking on create).
 * @returns {{ id: string, name: string, staffUid: string, staffName: string } | null}
 */
export async function resolveSalespersonById(salespersonId, actor = {}) {
  const id = String(salespersonId ?? '').trim();
  if (!id) return null;
  const staffUid = String(actor.staffUid ?? '').trim();
  const staffName = String(actor.staffName ?? 'Staff').trim() || 'Staff';
  const name = await resolveSalespersonName({}, id);
  return {
    id,
    name,
    staffUid,
    staffName,
  };
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
  const salespersonName = await resolveSalespersonName(user, salespersonId);

  return {
    id: salespersonId,
    name: salespersonName,
    staffUid,
    staffName: String(user.displayName ?? 'Staff').trim() || 'Staff',
  };
}
