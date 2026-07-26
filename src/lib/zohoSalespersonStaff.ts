import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { normalizePhone, isValidPhone } from './loginAuth';

export type ZohoSalespersonStaff = {
  uid: string;
  displayName: string;
  hrPhotoUrl: string | null;
  hrPhotoStoragePath: string | null;
  phone: string | null;
  telHref: string | null;
  whatsappHref: string | null;
  zohoSalespersonId: string;
  zohoSalespersonName: string | null;
};

const resolveCache = new Map<string, Promise<ZohoSalespersonStaff | null>>();

function phoneHrefs(phoneRaw: string | null | undefined): {
  phone: string | null;
  telHref: string | null;
  whatsappHref: string | null;
} {
  const digits = normalizePhone(String(phoneRaw ?? ''));
  if (!isValidPhone(digits)) {
    return { phone: phoneRaw?.trim() || null, telHref: null, whatsappHref: null };
  }
  return {
    phone: digits,
    telHref: `tel:+91${digits}`,
    whatsappHref: `https://wa.me/91${digits}`,
  };
}

/** Returns another staff uid already linked to this Zoho salesperson id, if any. */
export async function findStaffUidByZohoSalespersonId(
  zohoSalespersonId: string,
  excludeUid?: string | null,
): Promise<string | null> {
  const id = zohoSalespersonId.trim();
  if (!id) return null;
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonId', '==', id),
      limit(5),
    ),
  );
  for (const docSnap of snap.docs) {
    if (excludeUid && docSnap.id === excludeUid) continue;
    const role = String(docSnap.data()?.role ?? '');
    if (role === 'staff' || role === 'super_admin') return docSnap.id;
  }
  return null;
}

export async function assertZohoSalespersonIdAvailable(
  zohoSalespersonId: string | null | undefined,
  excludeUid?: string | null,
): Promise<void> {
  const id = zohoSalespersonId?.trim();
  if (!id) return;
  const other = await findStaffUidByZohoSalespersonId(id, excludeUid);
  if (other) {
    throw new Error('This Zoho Salesperson ID is already linked to another staff member.');
  }
}

async function queryStaffByZohoSalespersonId(
  zohoSalespersonId: string,
): Promise<ZohoSalespersonStaff | null> {
  const id = zohoSalespersonId.trim();
  if (!id) return null;
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonId', '==', id),
      limit(5),
    ),
  );
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.active === false) continue;
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    const phoneInfo = phoneHrefs(data.phone != null ? String(data.phone) : null);
    return {
      uid: docSnap.id,
      displayName: String(data.displayName ?? 'Staff').trim() || 'Staff',
      hrPhotoUrl: data.hrPhotoUrl ? String(data.hrPhotoUrl) : null,
      hrPhotoStoragePath: data.hrPhotoStoragePath ? String(data.hrPhotoStoragePath) : null,
      phone: phoneInfo.phone,
      telHref: phoneInfo.telHref,
      whatsappHref: phoneInfo.whatsappHref,
      zohoSalespersonId: id,
      zohoSalespersonName: data.zohoSalespersonName
        ? String(data.zohoSalespersonName)
        : null,
    };
  }
  return null;
}

/** Resolve Zoho salesperson id → linked staff (cached per page session). */
export function resolveStaffForZohoSalespersonId(
  zohoSalespersonId: string | null | undefined,
): Promise<ZohoSalespersonStaff | null> {
  const id = String(zohoSalespersonId ?? '').trim();
  if (!id) return Promise.resolve(null);
  const existing = resolveCache.get(id);
  if (existing) return existing;
  const pending = queryStaffByZohoSalespersonId(id).catch(err => {
    resolveCache.delete(id);
    throw err;
  });
  resolveCache.set(id, pending);
  return pending;
}

export function clearZohoSalespersonStaffCache(): void {
  resolveCache.clear();
}
