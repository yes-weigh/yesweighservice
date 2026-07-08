import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_STAFF_LOGISTICS_SITE,
  LOGISTICS_SETTINGS_DOC_ID,
} from '../constants/logisticsSettings';
import type { FirestoreUserDoc, UserRecord } from '../types';
import { normalizeRole } from '../types';
import {
  isStaffLogisticsSite,
  STAFF_LOGISTICS_SITES,
  type StaffLogisticsSite,
} from '../types/staff-logistics';

const EMPTY_FROM_ADDRESSES = (): Record<StaffLogisticsSite, string> => ({
  cochin: '',
  head_office: '',
});

function parseFromAddresses(data: Record<string, unknown> | undefined): Record<StaffLogisticsSite, string> {
  const base = EMPTY_FROM_ADDRESSES();
  if (!data?.fromAddresses || typeof data.fromAddresses !== 'object') return base;
  const raw = data.fromAddresses as Record<string, unknown>;
  for (const site of STAFF_LOGISTICS_SITES) {
    const value = raw[site];
    if (typeof value === 'string') base[site] = value;
  }
  return base;
}

export interface LogisticsSettings {
  defaultStaffLogisticsSite: StaffLogisticsSite;
  /** Free-text ship-from address per logistics site. */
  fromAddresses: Record<StaffLogisticsSite, string>;
  updatedAt: string;
  updatedBy?: string | null;
}

export async function loadLogisticsSettings(): Promise<LogisticsSettings> {
  try {
    const snap = await getDoc(doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID));
    if (!snap.exists()) {
      return {
        defaultStaffLogisticsSite: DEFAULT_STAFF_LOGISTICS_SITE,
        fromAddresses: EMPTY_FROM_ADDRESSES(),
        updatedAt: '',
      };
    }
    const data = snap.data();
    const site = data.defaultStaffLogisticsSite;
    return {
      defaultStaffLogisticsSite: isStaffLogisticsSite(site)
        ? site
        : DEFAULT_STAFF_LOGISTICS_SITE,
      fromAddresses: parseFromAddresses(data as Record<string, unknown>),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return {
      defaultStaffLogisticsSite: DEFAULT_STAFF_LOGISTICS_SITE,
      fromAddresses: EMPTY_FROM_ADDRESSES(),
      updatedAt: '',
    };
  }
}

export async function loadDefaultStaffLogisticsSite(): Promise<StaffLogisticsSite> {
  const settings = await loadLogisticsSettings();
  return settings.defaultStaffLogisticsSite;
}

export async function saveDefaultStaffLogisticsSite(
  site: StaffLogisticsSite,
  updatedBy?: string | null,
): Promise<StaffLogisticsSite> {
  if (!isStaffLogisticsSite(site)) {
    throw new Error('Select a valid logistics location.');
  }

  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      defaultStaffLogisticsSite: site,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );

  return site;
}

export async function saveLogisticsFromAddresses(
  fromAddresses: Record<StaffLogisticsSite, string>,
  updatedBy?: string | null,
): Promise<Record<StaffLogisticsSite, string>> {
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      fromAddresses,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return fromAddresses;
}

export async function listHrStaffUsers(): Promise<UserRecord[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs
    .map(docSnap => {
      const data = docSnap.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (role !== 'staff') return null;
      return { uid: docSnap.id, ...data, role } as UserRecord;
    })
    .filter((record): record is UserRecord => record !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
