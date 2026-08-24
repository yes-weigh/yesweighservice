/**
 * Resolve Zoho salesperson from a dealer's assigned portal staff,
 * or from the creating staff member for staff-placed orders.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { loadHiddenZohoSalespersonIds } from './zoho-salespersons.js';

/** Known Zoho id for Cloud Charges (fallback if name lookup fails). */
export const CLOUD_CHARGES_SALESPERSON_ID = '99381000004019936';
export const CLOUD_CHARGES_SALESPERSON_NAME = 'Cloud Charges';

/** Known Zoho id for Shibin (spare order-type SOs). */
export const SHIBIN_SALESPERSON_ID = '99381000031557442';
export const SHIBIN_SALESPERSON_NAME = 'Shibin';

const SPARE_INCHARGE_SETTINGS_DOC = 'appSettings/spareIncharge';

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

/** Prefer primary, else first linked — skipping portal-hidden Zoho salespersons. */
async function pickUsableSalespersonId(user) {
  const linkedIds = normalizeStaffZohoSalespersonIds(user);
  if (!linkedIds.length) return null;
  const hidden = await loadHiddenZohoSalespersonIds();
  const usable = linkedIds.filter(id => !hidden.has(id));
  if (!usable.length) return null;
  const primary = String(user.zohoSalespersonId ?? '').trim();
  if (primary && usable.includes(primary)) return primary;
  return usable[0];
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

  const salespersonId = await pickUsableSalespersonId(user);
  if (!salespersonId) return null;
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

  const salespersonId = await pickUsableSalespersonId(user);
  if (!salespersonId) return null;
  const salespersonName = await resolveSalespersonName(user, salespersonId);

  return {
    id: salespersonId,
    name: salespersonName,
    staffUid,
    staffName: String(user.displayName ?? 'Staff').trim() || 'Staff',
  };
}

/**
 * Spare Incharge portal user's primary Zoho salesperson.
 * @throws {Error} when missing incharge or Zoho link
 */
export async function resolveSpareInchargeSalesperson() {
  const db = getFirestore();
  const settingsSnap = await db.doc(SPARE_INCHARGE_SETTINGS_DOC).get();
  const members = Array.isArray(settingsSnap.data()?.members)
    ? settingsSnap.data().members
    : [];
  const memberUid = String(members[0]?.uid ?? '').trim();
  if (!memberUid) {
    throw new Error(
      'Spare Incharge is not configured. Assign one in HR → Spare Incharge before ordering spare parts.',
    );
  }

  const resolved = await resolveSalespersonForStaff(memberUid);
  if (!resolved) {
    throw new Error(
      'Spare Incharge has no Zoho salesperson linked. Link one in HR → Spare Incharge before ordering spare parts.',
    );
  }
  return resolved;
}

/**
 * Zoho salesperson "Cloud Charges" for software-segment SOs.
 * @throws {Error} when not found
 */
export async function resolveCloudChargesSalesperson() {
  const db = getFirestore();
  const byName = await db.collection('zohoSalespersons')
    .where('name', '==', CLOUD_CHARGES_SALESPERSON_NAME)
    .limit(5)
    .get();

  let match = null;
  for (const docSnap of byName.docs) {
    const data = docSnap.data() || {};
    if (data.active === false) continue;
    match = { id: docSnap.id, name: String(data.name ?? CLOUD_CHARGES_SALESPERSON_NAME).trim() };
    break;
  }

  if (!match) {
    const fallback = await db.collection('zohoSalespersons').doc(CLOUD_CHARGES_SALESPERSON_ID).get();
    if (fallback.exists) {
      const data = fallback.data() || {};
      if (data.active !== false) {
        match = {
          id: fallback.id,
          name: String(data.name ?? CLOUD_CHARGES_SALESPERSON_NAME).trim()
            || CLOUD_CHARGES_SALESPERSON_NAME,
        };
      }
    }
  }

  if (!match) {
    // Case-insensitive scan if exact name query missed
    const all = await db.collection('zohoSalespersons').select('name', 'active').get();
    for (const docSnap of all.docs) {
      const data = docSnap.data() || {};
      if (data.active === false) continue;
      if (String(data.name ?? '').trim().toLowerCase() === CLOUD_CHARGES_SALESPERSON_NAME.toLowerCase()) {
        match = {
          id: docSnap.id,
          name: String(data.name ?? CLOUD_CHARGES_SALESPERSON_NAME).trim(),
        };
        break;
      }
    }
  }

  if (!match) {
    throw new Error(
      'Zoho salesperson “Cloud Charges” was not found. Sync salespersons or contact support before ordering software items.',
    );
  }

  return {
    id: match.id,
    name: match.name || CLOUD_CHARGES_SALESPERSON_NAME,
    staffUid: '',
    staffName: CLOUD_CHARGES_SALESPERSON_NAME,
  };
}

/**
 * Zoho salesperson "Shibin" for spare-segment SOs.
 * @throws {Error} when not found
 */
export async function resolveShibinSalesperson() {
  const db = getFirestore();
  const byName = await db.collection('zohoSalespersons')
    .where('name', '==', SHIBIN_SALESPERSON_NAME)
    .limit(5)
    .get();

  let match = null;
  for (const docSnap of byName.docs) {
    const data = docSnap.data() || {};
    if (data.active === false) continue;
    if (String(data.name ?? '').trim().toLowerCase() !== SHIBIN_SALESPERSON_NAME.toLowerCase()) continue;
    match = { id: docSnap.id, name: String(data.name ?? SHIBIN_SALESPERSON_NAME).trim() };
    break;
  }

  if (!match) {
    const fallback = await db.collection('zohoSalespersons').doc(SHIBIN_SALESPERSON_ID).get();
    if (fallback.exists) {
      const data = fallback.data() || {};
      if (data.active !== false) {
        match = {
          id: fallback.id,
          name: String(data.name ?? SHIBIN_SALESPERSON_NAME).trim() || SHIBIN_SALESPERSON_NAME,
        };
      }
    }
  }

  if (!match) {
    throw new Error(
      'Zoho salesperson “Shibin” was not found. Sync salespersons or contact support before ordering spare parts.',
    );
  }

  return {
    id: match.id,
    name: match.name || SHIBIN_SALESPERSON_NAME,
    staffUid: '',
    staffName: SHIBIN_SALESPERSON_NAME,
  };
}
