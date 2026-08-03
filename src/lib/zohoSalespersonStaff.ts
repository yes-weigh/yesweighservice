import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { normalizePhone, isValidPhone } from './loginAuth';
import { listZohoSalespersonsFromFirestore } from './zohoSalespersons';

export type ZohoSalespersonLink = {
  id: string;
  name: string | null;
};

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
  zohoSalespersonIds: string[];
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

/** Normalize legacy single-id fields + arrays into a unique link list. */
export function normalizeZohoSalespersonLinks(input: {
  zohoSalespersonLinks?: ZohoSalespersonLink[] | null;
  zohoSalespersonIds?: string[] | null;
  zohoSalespersonId?: string | null;
  zohoSalespersonName?: string | null;
}): ZohoSalespersonLink[] {
  const byId = new Map<string, string | null>();

  const push = (idRaw: unknown, nameRaw?: unknown) => {
    const id = String(idRaw ?? '').trim();
    if (!id || byId.has(id)) {
      if (id && nameRaw != null && String(nameRaw).trim() && !byId.get(id)) {
        byId.set(id, String(nameRaw).trim());
      }
      return;
    }
    const name = nameRaw != null && String(nameRaw).trim() ? String(nameRaw).trim() : null;
    byId.set(id, name);
  };

  if (Array.isArray(input.zohoSalespersonLinks)) {
    for (const link of input.zohoSalespersonLinks) {
      if (!link) continue;
      push(link.id, link.name);
    }
  }
  if (Array.isArray(input.zohoSalespersonIds)) {
    for (const id of input.zohoSalespersonIds) push(id);
  }
  if (input.zohoSalespersonId) {
    push(input.zohoSalespersonId, input.zohoSalespersonName);
  }

  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

/** Firestore write shape — keeps legacy single fields as the first link. */
export function zohoLinksToFirestoreFields(links: ZohoSalespersonLink[]): {
  zohoSalespersonIds: string[];
  zohoSalespersonLinks: ZohoSalespersonLink[];
  zohoSalespersonId: string | null;
  zohoSalespersonName: string | null;
} {
  const normalized = normalizeZohoSalespersonLinks({ zohoSalespersonLinks: links });
  const first = normalized[0] ?? null;
  return {
    zohoSalespersonIds: normalized.map(link => link.id),
    zohoSalespersonLinks: normalized,
    zohoSalespersonId: first?.id ?? null,
    zohoSalespersonName: first?.name ?? null,
  };
}

/** Staff and super admins can link Zoho salespersons for dealer assignment + SOs. */
export function roleSupportsZohoSalespersonLinks(role: string): boolean {
  return role === 'staff' || role === 'super_admin';
}

export function staffHasZohoSalespersonLink(input: {
  zohoSalespersonLinks?: ZohoSalespersonLink[] | null;
  zohoSalespersonIds?: string[] | null;
  zohoSalespersonId?: string | null;
}): boolean {
  return normalizeZohoSalespersonLinks(input).length > 0;
}

/** Returns another staff uid already linked to this Zoho salesperson id, if any. */
export async function findStaffUidByZohoSalespersonId(
  zohoSalespersonId: string,
  excludeUid?: string | null,
): Promise<string | null> {
  const id = zohoSalespersonId.trim();
  if (!id) return null;

  const roleOk = (role: string) => role === 'staff' || role === 'super_admin';

  const arraySnap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonIds', 'array-contains', id),
      limit(5),
    ),
  );
  for (const docSnap of arraySnap.docs) {
    if (excludeUid && docSnap.id === excludeUid) continue;
    if (roleOk(String(docSnap.data()?.role ?? ''))) return docSnap.id;
  }

  const legacySnap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonId', '==', id),
      limit(5),
    ),
  );
  for (const docSnap of legacySnap.docs) {
    if (excludeUid && docSnap.id === excludeUid) continue;
    if (roleOk(String(docSnap.data()?.role ?? ''))) return docSnap.id;
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

export async function assertZohoSalespersonIdsAvailable(
  zohoSalespersonIds: Array<string | null | undefined> | null | undefined,
  excludeUid?: string | null,
): Promise<void> {
  const ids = [...new Set(
    (zohoSalespersonIds ?? [])
      .map(id => String(id ?? '').trim())
      .filter(Boolean),
  )];
  for (const id of ids) {
    await assertZohoSalespersonIdAvailable(id, excludeUid);
  }
}

/**
 * Map of Zoho salesperson id → staff already claiming it (for HR picker ordering).
 * Excludes `excludeUid` so the staff being edited can keep their own links.
 */
export async function listClaimedZohoSalespersonIds(
  excludeUid?: string | null,
): Promise<Map<string, { uid: string; displayName: string }>> {
  const snap = await getDocs(collection(db, 'users'));
  const claimed = new Map<string, { uid: string; displayName: string }>();
  for (const docSnap of snap.docs) {
    if (excludeUid && docSnap.id === excludeUid) continue;
    const data = docSnap.data() as Record<string, unknown>;
    const role = String(data.role ?? '');
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (data.active === false) continue;
    const links = normalizeZohoSalespersonLinks({
      zohoSalespersonLinks: data.zohoSalespersonLinks as ZohoSalespersonLink[] | null | undefined,
      zohoSalespersonIds: data.zohoSalespersonIds as string[] | null | undefined,
      zohoSalespersonId: data.zohoSalespersonId as string | null | undefined,
      zohoSalespersonName: data.zohoSalespersonName as string | null | undefined,
    });
    const displayName = String(data.displayName ?? 'Staff').trim() || 'Staff';
    for (const link of links) {
      if (!claimed.has(link.id)) {
        claimed.set(link.id, { uid: docSnap.id, displayName });
      }
    }
  }
  return claimed;
}

async function queryStaffByZohoSalespersonId(
  zohoSalespersonId: string,
): Promise<ZohoSalespersonStaff | null> {
  const id = zohoSalespersonId.trim();
  if (!id) return null;

  const trySnap = async (snap: Awaited<ReturnType<typeof getDocs>>) => {
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (data.active === false) continue;
      const role = String(data.role ?? '');
      if (role !== 'staff' && role !== 'super_admin') continue;
      const links = normalizeZohoSalespersonLinks({
        zohoSalespersonLinks: data.zohoSalespersonLinks as ZohoSalespersonLink[] | null | undefined,
        zohoSalespersonIds: data.zohoSalespersonIds as string[] | null | undefined,
        zohoSalespersonId: data.zohoSalespersonId as string | null | undefined,
        zohoSalespersonName: data.zohoSalespersonName as string | null | undefined,
      });
      const match = links.find(link => link.id === id);
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
        zohoSalespersonName: match?.name
          ?? (data.zohoSalespersonName ? String(data.zohoSalespersonName) : null),
        zohoSalespersonIds: links.map(link => link.id),
      } satisfies ZohoSalespersonStaff;
    }
    return null;
  };

  const arraySnap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonIds', 'array-contains', id),
      limit(5),
    ),
  );
  const fromArray = await trySnap(arraySnap);
  if (fromArray) return fromArray;

  const legacySnap = await getDocs(
    query(
      collection(db, 'users'),
      where('zohoSalespersonId', '==', id),
      limit(5),
    ),
  );
  return trySnap(legacySnap);
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

function normalizeSalespersonName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[-_/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveSalespersonIdFromName(
  salespersonName: string,
): Promise<string | null> {
  const target = normalizeSalespersonName(salespersonName);
  if (!target) return null;

  try {
    const rows = await listZohoSalespersonsFromFirestore();
    const exact = rows.find(row => normalizeSalespersonName(row.name) === target);
    if (exact?.id) return exact.id;
  } catch {
    // fall through to staff-link scan
  }

  // Fallback: match against names saved on staff Zoho links.
  const staffSnap = await getDocs(
    query(collection(db, 'users'), where('role', 'in', ['staff', 'super_admin']), limit(100)),
  );
  for (const docSnap of staffSnap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    if (data.active === false) continue;
    const links = normalizeZohoSalespersonLinks({
      zohoSalespersonLinks: data.zohoSalespersonLinks as ZohoSalespersonLink[] | null | undefined,
      zohoSalespersonIds: data.zohoSalespersonIds as string[] | null | undefined,
      zohoSalespersonId: data.zohoSalespersonId as string | null | undefined,
      zohoSalespersonName: data.zohoSalespersonName as string | null | undefined,
    });
    const match = links.find(link => normalizeSalespersonName(link.name) === target);
    if (match?.id) return match.id;
  }
  return null;
}

/**
 * Resolve linked staff from Zoho salesperson id and/or name.
 * CSV-imported invoices/SOs often have name only — name falls back through the
 * zohoSalespersons cache and staff link names.
 */
export async function resolveStaffForZohoSalesperson(
  zohoSalespersonId?: string | null,
  zohoSalespersonName?: string | null,
): Promise<ZohoSalespersonStaff | null> {
  const id = String(zohoSalespersonId ?? '').trim();
  if (id) {
    const byId = await resolveStaffForZohoSalespersonId(id);
    if (byId) return byId;
  }

  const name = String(zohoSalespersonName ?? '').trim();
  if (!name) return null;

  const nameKey = `name:${normalizeSalespersonName(name)}`;
  const cached = resolveCache.get(nameKey);
  if (cached) return cached;

  const pending = (async () => {
    const resolvedId = await resolveSalespersonIdFromName(name);
    if (!resolvedId) return null;
    return resolveStaffForZohoSalespersonId(resolvedId);
  })().catch(err => {
    resolveCache.delete(nameKey);
    throw err;
  });

  resolveCache.set(nameKey, pending);
  return pending;
}

export function clearZohoSalespersonStaffCache(): void {
  resolveCache.clear();
}
