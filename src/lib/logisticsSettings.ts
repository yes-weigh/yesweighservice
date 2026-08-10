import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_STAFF_LOGISTICS_SITE,
  LOGISTICS_SETTINGS_DOC_ID,
} from '../constants/logisticsSettings';
import { DEFAULT_LOGISTICS_DELIVERY_RULES } from '../constants/logisticsDeliveryRules';
import {
  defaultLogisticsPartnerStatuses,
  normalizeLogisticsPartnerStatuses,
} from '../constants/logisticsPartnerStatus';
import {
  defaultDeliveryPartnerGstins,
  normalizeDeliveryPartnerGstins,
  type DeliveryPartnerGstins,
} from '../constants/deliveryPartnerTabs';
import { normalizeLogisticsDeliveryRules } from './logisticsDeliveryRules';
import type { LogisticsDeliveryRulesMatrix } from '../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../types/logistics-partner-status';
import type { DelhiveryB2bPublicConfig } from '../types/delhivery-b2b';
import { emptyDelhiveryB2bPublicConfig } from '../types/delhivery-b2b';
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

export type LogisticsSiteContact = {
  phone: string;
  gstin: string;
};

const EMPTY_FROM_SITE_CONTACTS = (): Record<StaffLogisticsSite, LogisticsSiteContact> => ({
  cochin: { phone: '', gstin: '' },
  head_office: { phone: '', gstin: '' },
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

function parseFromSiteContacts(
  data: Record<string, unknown> | undefined,
): Record<StaffLogisticsSite, LogisticsSiteContact> {
  const base = EMPTY_FROM_SITE_CONTACTS();
  if (!data?.fromSiteContacts || typeof data.fromSiteContacts !== 'object') return base;
  const raw = data.fromSiteContacts as Record<string, unknown>;
  for (const site of STAFF_LOGISTICS_SITES) {
    const value = raw[site];
    if (!value || typeof value !== 'object') continue;
    const obj = value as Record<string, unknown>;
    base[site] = {
      phone: typeof obj.phone === 'string' ? obj.phone : '',
      gstin: typeof obj.gstin === 'string' ? obj.gstin : '',
    };
  }
  return base;
}

function parseDelhiveryB2b(data: Record<string, unknown> | undefined): DelhiveryB2bPublicConfig {
  const base = emptyDelhiveryB2bPublicConfig();
  const raw = data?.delhiveryB2b;
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  base.env = String(obj.env ?? '').trim().toLowerCase() === 'production' ? 'production' : 'staging';
  if (typeof obj.username === 'string') base.username = obj.username;
  base.passwordSet = Boolean(obj.passwordSet);
  if (typeof obj.lastTestAt === 'string') base.lastTestAt = obj.lastTestAt;
  base.lastTestOk = Boolean(obj.lastTestOk);
  if (typeof obj.lastTestMessage === 'string') base.lastTestMessage = obj.lastTestMessage;
  if (typeof obj.clientName === 'string') base.clientName = obj.clientName;
  const pickup = obj.pickupLocationBySite;
  if (pickup && typeof pickup === 'object') {
    const map = pickup as Record<string, unknown>;
    for (const site of STAFF_LOGISTICS_SITES) {
      if (typeof map[site] === 'string') base.pickupLocationBySite[site] = map[site];
    }
  }
  return base;
}

export interface LogisticsSettings {
  defaultStaffLogisticsSite: StaffLogisticsSite;
  /** Free-text ship-from address per logistics site. */
  fromAddresses: Record<StaffLogisticsSite, string>;
  /** Named ship-from phone / GSTIN per site (used on Delhivery return + billing). */
  fromSiteContacts: Record<StaffLogisticsSite, LogisticsSiteContact>;
  /** Destination region × ship-from site → ordered delivery partners. */
  deliveryRules: LogisticsDeliveryRulesMatrix;
  /** Per-partner Active / Inactive / Manual.
   * Rules may list any partner; SO freight only offers Active or Manual.
   */
  partnerStatuses: LogisticsPartnerStatuses;
  /** GSTIN per delivery partner tab (Blue Dart, Trackon, Delhivery, etc.). */
  partnerGstins: DeliveryPartnerGstins;
  /** Public Delhivery B2B API connection metadata (password never returned). */
  delhiveryB2b: DelhiveryB2bPublicConfig;
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
        fromSiteContacts: EMPTY_FROM_SITE_CONTACTS(),
        deliveryRules: structuredClone(DEFAULT_LOGISTICS_DELIVERY_RULES),
        partnerStatuses: defaultLogisticsPartnerStatuses(),
        partnerGstins: defaultDeliveryPartnerGstins(),
        delhiveryB2b: emptyDelhiveryB2bPublicConfig(),
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
      fromSiteContacts: parseFromSiteContacts(data as Record<string, unknown>),
      deliveryRules: normalizeLogisticsDeliveryRules(data.deliveryRules),
      partnerStatuses: normalizeLogisticsPartnerStatuses(data.partnerStatuses),
      partnerGstins: normalizeDeliveryPartnerGstins(
        (data as Record<string, unknown>).partnerGstins,
      ),
      delhiveryB2b: parseDelhiveryB2b(data as Record<string, unknown>),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return {
      defaultStaffLogisticsSite: DEFAULT_STAFF_LOGISTICS_SITE,
      fromAddresses: EMPTY_FROM_ADDRESSES(),
      fromSiteContacts: EMPTY_FROM_SITE_CONTACTS(),
      deliveryRules: structuredClone(DEFAULT_LOGISTICS_DELIVERY_RULES),
      partnerStatuses: defaultLogisticsPartnerStatuses(),
      partnerGstins: defaultDeliveryPartnerGstins(),
      delhiveryB2b: emptyDelhiveryB2bPublicConfig(),
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

export async function saveLogisticsFromSiteContacts(
  fromSiteContacts: Record<StaffLogisticsSite, LogisticsSiteContact>,
  updatedBy?: string | null,
): Promise<Record<StaffLogisticsSite, LogisticsSiteContact>> {
  const normalized = EMPTY_FROM_SITE_CONTACTS();
  for (const site of STAFF_LOGISTICS_SITES) {
    const raw = fromSiteContacts[site] ?? { phone: '', gstin: '' };
    normalized[site] = {
      phone: String(raw.phone ?? '').trim(),
      gstin: String(raw.gstin ?? '').trim().toUpperCase(),
    };
  }
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      fromSiteContacts: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return normalized;
}

export async function saveLogisticsDeliveryRules(
  deliveryRules: LogisticsDeliveryRulesMatrix,
  updatedBy?: string | null,
): Promise<LogisticsDeliveryRulesMatrix> {
  const normalized = normalizeLogisticsDeliveryRules(deliveryRules);
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      deliveryRules: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return normalized;
}

export async function saveLogisticsPartnerStatuses(
  partnerStatuses: LogisticsPartnerStatuses,
  updatedBy?: string | null,
): Promise<LogisticsPartnerStatuses> {
  const normalized = normalizeLogisticsPartnerStatuses(partnerStatuses);
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      partnerStatuses: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return normalized;
}

export async function saveLogisticsPartnerGstins(
  partnerGstins: DeliveryPartnerGstins,
  updatedBy?: string | null,
): Promise<DeliveryPartnerGstins> {
  const normalized = normalizeDeliveryPartnerGstins(partnerGstins);
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      partnerGstins: normalized,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return normalized;
}

/** Save delivery-rule matrix and partner Active/Inactive/Manual together. */
export async function saveLogisticsDeliveryRulesAndPartnerStatuses(
  deliveryRules: LogisticsDeliveryRulesMatrix,
  partnerStatuses: LogisticsPartnerStatuses,
  updatedBy?: string | null,
): Promise<{
  deliveryRules: LogisticsDeliveryRulesMatrix;
  partnerStatuses: LogisticsPartnerStatuses;
}> {
  const nextRules = normalizeLogisticsDeliveryRules(deliveryRules);
  const nextStatuses = normalizeLogisticsPartnerStatuses(partnerStatuses);
  const updatedAt = new Date().toISOString();
  await setDoc(
    doc(db, 'appSettings', LOGISTICS_SETTINGS_DOC_ID),
    {
      deliveryRules: nextRules,
      partnerStatuses: nextStatuses,
      updatedAt,
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true },
  );
  return { deliveryRules: nextRules, partnerStatuses: nextStatuses };
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
