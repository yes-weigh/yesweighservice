import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { SPARE_INCHARGE_SETTINGS_DOC_ID } from '../constants/spareIncharge';
import { db } from '../firebase';
import type { FirestoreUserDoc, Role, UserRecord } from '../types';
import { normalizeRole, ROLE_LABELS } from '../types';

export type SpareInchargeMember = {
  uid: string;
  displayName: string;
  role: 'staff' | 'super_admin';
  loginId: string;
};

export type SpareInchargeSettings = {
  members: SpareInchargeMember[];
  updatedAt: string;
  updatedByUid?: string | null;
};

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

export async function loadSpareInchargeSettings(): Promise<SpareInchargeSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID));
    if (!snap.exists()) {
      return { members: [], updatedAt: '' };
    }
    const data = snap.data() as Record<string, unknown>;
    const members = Array.isArray(data.members)
      ? data.members.map(normalizeMember).filter((m): m is SpareInchargeMember => m !== null)
      : [];
    return {
      members,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
    };
  } catch {
    return { members: [], updatedAt: '' };
  }
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
  if (current.members.some(m => m.uid === user.uid)) {
    return current;
  }

  const member: SpareInchargeMember = {
    uid: user.uid,
    displayName: user.displayName?.trim() || 'User',
    role,
    loginId: String(user.loginId ?? '').trim(),
  };

  const next: SpareInchargeSettings = {
    members: [...current.members, member].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid ?? null,
  };

  await setDoc(
    doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
    {
      members: next.members,
      memberUids: next.members.map(m => m.uid),
      updatedAt: next.updatedAt,
      updatedByUid: next.updatedByUid,
    },
    { merge: true },
  );

  await trySetUserSpareInchargeFlag(user.uid, true);
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
    updatedAt: new Date().toISOString(),
    updatedByUid: updatedByUid ?? null,
  };

  await setDoc(
    doc(db, 'appSettings', SPARE_INCHARGE_SETTINGS_DOC_ID),
    {
      members: next.members,
      memberUids: next.members.map(m => m.uid),
      updatedAt: next.updatedAt,
      updatedByUid: next.updatedByUid,
    },
    { merge: true },
  );

  await trySetUserSpareInchargeFlag(uid, false);
  return next;
}

export function isSpareInchargeMember(
  settings: Pick<SpareInchargeSettings, 'members'>,
  uid: string | null | undefined,
): boolean {
  if (!uid) return false;
  return settings.members.some(m => m.uid === uid);
}
