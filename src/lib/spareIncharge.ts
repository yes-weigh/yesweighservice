import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { SPARE_INCHARGE_SETTINGS_DOC_ID } from '../constants/spareIncharge';
import { db } from '../firebase';
import type { FirestoreUserDoc, Role, UserRecord } from '../types';
import { normalizeRole, ROLE_LABELS } from '../types';
import { whatsappPhoneDigits } from './whatsappShareCard';
import {
  assertZohoSalespersonIdsAvailable,
  normalizeZohoSalespersonLinks,
  zohoLinksToFirestoreFields,
  type ZohoSalespersonLink,
} from './zohoSalespersonStaff';

export type SpareInchargeMember = {
  uid: string;
  displayName: string;
  role: 'staff' | 'super_admin';
  loginId: string;
};

export type SpareInchargeSettings = {
  members: SpareInchargeMember[];
  /** Display form as entered (e.g. +91 95679 33252). Normalized at share time. */
  whatsappNumber: string;
  updatedAt: string;
  updatedByUid?: string | null;
};

function normalizeWhatsappNumber(raw: unknown): string {
  return String(raw ?? '').trim();
}

/** Validate / normalize for save. Empty clears. Accepts +, spaces, country codes. */
export function normalizeSpareInchargeWhatsappInput(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const digits = whatsappPhoneDigits(trimmed);
  if (!digits) {
    throw new Error('Enter a valid WhatsApp number (10+ digits, with or without +91).');
  }
  return trimmed;
}

const ELIGIBLE_ROLES = new Set<Role>(['staff', 'super_admin']);

function asMemberRole(role: Role | null): 'staff' | 'super_admin' | null {
  if (role === 'staff' || role === 'super_admin') return role;
  return null;
}

function normalizeMember(raw: unknown): SpareInchargeMember | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const uid = String(row.uid ?? '').trim();
  if (!uid) return null;
  const roleRaw = normalizeRole(String(row.role ?? ''));
  const role = asMemberRole(roleRaw);
  if (!role) return null;
  return {
    uid,
    displayName: String(row.displayName ?? '').trim() || 'User',
    role,
    loginId: String(row.loginId ?? '').trim(),
  };
}

export function spareInchargeRoleLabel(role: SpareInchargeMember['role']): string {
  return ROLE_LABELS[role];
}

/** Primary (top) Zoho salesperson for a spare-incharge user, if any. */
export function primaryZohoSalespersonForUser(user: Pick<
  UserRecord,
  'zohoSalespersonLinks' | 'zohoSalespersonIds' | 'zohoSalespersonId' | 'zohoSalespersonName'
> | null | undefined): ZohoSalespersonLink | null {
  if (!user) return null;
  return normalizeZohoSalespersonLinks(user)[0] ?? null;
}

export async function loadSpareInchargeSettings(): Promise<SpareInchargeSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID));
    if (!snap.exists()) {
      return { members: [], whatsappNumber: '', updatedAt: '' };
    }
    const data = snap.data() as Record<string, unknown>;
    const members = Array.isArray(data.members)
      ? data.members.map(normalizeMember).filter((m): m is SpareInchargeMember => m !== null)
      : [];
    // Only one spare incharge is allowed — keep the first if older data had many.
    const normalized: SpareInchargeSettings = {
      members: members.slice(0, 1),
      whatsappNumber: normalizeWhatsappNumber(data.whatsappNumber),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
    };

    if (members.length > 1) {
      const extras = members.slice(1);
      await setDoc(
        doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
        {
          members: normalized.members,
          memberUids: normalized.members.map(m => m.uid),
          whatsappNumber: normalized.whatsappNumber,
          updatedAt: new Date().toISOString(),
          updatedByUid: normalized.updatedByUid ?? null,
        },
        { merge: true },
      );
      await Promise.all(extras.map(m => trySetUserSpareInchargeFlag(m.uid, false)));
    }

    return normalized;
  } catch {
    return { members: [], whatsappNumber: '', updatedAt: '' };
  }
}

/** Save / clear the WhatsApp number used by “Share to spare incharge”. */
export async function saveSpareInchargeWhatsappNumber(
  whatsappNumber: string,
  updatedByUid?: string | null,
): Promise<SpareInchargeSettings> {
  const current = await loadSpareInchargeSettings();
  const normalized = normalizeSpareInchargeWhatsappInput(whatsappNumber);
  const next: SpareInchargeSettings = {
    ...current,
    whatsappNumber: normalized,
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid ?? null,
  };

  await setDoc(
    doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
    {
      whatsappNumber: next.whatsappNumber,
      updatedAt: next.updatedAt,
      updatedByUid: next.updatedByUid,
    },
    { merge: true },
  );

  return next;
}

export async function listSpareInchargeEligibleUsers(): Promise<UserRecord[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs
    .map(docSnap => {
      const data = docSnap.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (!role || !ELIGIBLE_ROLES.has(role)) return null;
      return { uid: docSnap.id, ...data, role } as UserRecord;
    })
    .filter((row): row is UserRecord => row !== null)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

async function trySetUserSpareInchargeFlag(uid: string, value: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      spareIncharge: value,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Roster in appSettings is source of truth; user flag is best-effort
    // (e.g. staff HR may not be allowed to update a super_admin doc).
  }
}

export async function addSpareInchargeMember(
  user: UserRecord,
  updatedByUid?: string | null,
): Promise<SpareInchargeSettings> {
  const role = asMemberRole(user.role);
  if (!role) {
    throw new Error('Only staff and super admins can be spare incharge.');
  }

  const current = await loadSpareInchargeSettings();
  if (current.members.length === 1 && current.members[0].uid === user.uid) {
    return current;
  }

  const member: SpareInchargeMember = {
    uid: user.uid,
    displayName: user.displayName?.trim() || 'User',
    role,
    loginId: String(user.loginId ?? '').trim(),
  };

  const previousUids = current.members.map(m => m.uid).filter(uid => uid !== user.uid);

  const next: SpareInchargeSettings = {
    members: [member],
    whatsappNumber: current.whatsappNumber,
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid ?? null,
  };

  await setDoc(
    doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
    {
      members: next.members,
      memberUids: next.members.map(m => m.uid),
      whatsappNumber: next.whatsappNumber,
      updatedAt: next.updatedAt,
      updatedByUid: next.updatedByUid,
    },
    { merge: true },
  );

  await Promise.all([
    trySetUserSpareInchargeFlag(user.uid, true),
    ...previousUids.map(uid => trySetUserSpareInchargeFlag(uid, false)),
  ]);
  return next;
}

export async function removeSpareInchargeMember(
  uid: string,
  updatedByUid?: string | null,
): Promise<SpareInchargeSettings> {
  const current = await loadSpareInchargeSettings();
  const nextMembers = current.members.filter(m => m.uid !== uid);
  if (nextMembers.length === current.members.length) {
    return current;
  }

  const next: SpareInchargeSettings = {
    members: nextMembers,
    whatsappNumber: current.whatsappNumber,
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid ?? null,
  };

  await setDoc(
    doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
    {
      members: next.members,
      memberUids: next.members.map(m => m.uid),
      whatsappNumber: next.whatsappNumber,
      updatedAt: next.updatedAt,
      updatedByUid: next.updatedByUid,
    },
    { merge: true },
  );

  await trySetUserSpareInchargeFlag(uid, false);
  return next;
}

/**
 * Set / replace the primary Zoho salesperson for a spare-incharge user.
 * The previous primary is removed; any other secondary links are kept.
 */
export async function setSpareInchargeZohoSalesperson(
  user: UserRecord,
  link: ZohoSalespersonLink,
): Promise<UserRecord> {
  const id = String(link.id ?? '').trim();
  if (!id) throw new Error('Choose a Zoho salesperson.');

  await assertZohoSalespersonIdsAvailable([id], user.uid);

  const existing = normalizeZohoSalespersonLinks(user);
  const secondary = existing.slice(1).filter(row => row.id !== id);
  const fields = zohoLinksToFirestoreFields([
    { id, name: link.name ?? null },
    ...secondary,
  ]);
  await updateDoc(doc(db, 'users', user.uid), {
    ...fields,
    updatedAt: new Date().toISOString(),
  });

  return {
    ...user,
    ...fields,
  };
}

/** @deprecated Prefer setSpareInchargeZohoSalesperson */
export async function associateZohoSalespersonToSpareIncharge(
  user: UserRecord,
  link: ZohoSalespersonLink,
): Promise<UserRecord> {
  return setSpareInchargeZohoSalesperson(user, link);
}

export function isSpareInchargeMember(
  settings: Pick<SpareInchargeSettings, 'members'>,
  uid: string | null | undefined,
): boolean {
  if (!uid) return false;
  return settings.members.some(m => m.uid === uid);
}
