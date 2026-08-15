import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';
import { invoiceErrorMessage } from './invoices';

const functions = getFunctions(app, 'asia-south1');

export type ZohoVendorOption = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  gstNo: string | null;
  currencyCode: string;
  status: string;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  address: string | null;
  placeOfContact: string | null;
};

export type ZohoVendorSyncMeta = {
  lastSyncedAt: string | null;
  count: number;
  activeCount: number;
};

function clean(value: unknown): string | null {
  const text = value != null ? String(value).trim() : '';
  return text || null;
}

export function mapZohoVendorDoc(id: string, data: DocumentData): ZohoVendorOption {
  return {
    id: String(data.id ?? id),
    name: String(data.name ?? '').trim(),
    companyName: clean(data.companyName),
    email: clean(data.email),
    phone: clean(data.phone),
    gstNo: clean(data.gstNo),
    currencyCode: String(data.currencyCode ?? 'INR').toUpperCase(),
    status: String(data.status ?? 'active').toLowerCase(),
    city: clean(data.city),
    state: clean(data.state),
    country: clean(data.country),
    zip: clean(data.zip),
    address: clean(data.address),
    placeOfContact: clean(data.placeOfContact),
  };
}

export function vendorPlaceLabel(
  vendor?: Pick<ZohoVendorOption, 'state' | 'country' | 'city'> | null,
): string | null {
  if (!vendor) return null;
  const parts = [vendor.state || vendor.city, vendor.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function loadZohoVendors(): Promise<ZohoVendorOption[]> {
  const snap = await getDocs(collection(db, 'zohoVendors'));
  return snap.docs
    .map(row => mapZohoVendorDoc(row.id, row.data()))
    .filter(row => row.id && row.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function loadZohoVendorDirectory(): Promise<Map<string, ZohoVendorOption>> {
  const rows = await loadZohoVendors();
  return new Map(rows.map(row => [row.id, row]));
}

export function subscribeZohoVendorMeta(
  onData: (meta: ZohoVendorSyncMeta | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'zohoVendorMeta', 'sync'), snap => {
    if (!snap.exists()) {
      onData(null);
      return;
    }
    const data = snap.data();
    const at = data.lastSyncedAt?.toDate?.() ?? null;
    onData({
      lastSyncedAt: at ? at.toISOString() : null,
      count: Number(data.count ?? 0),
      activeCount: Number(data.activeCount ?? 0),
    });
  });
}

export async function loadZohoVendorSyncMeta(): Promise<ZohoVendorSyncMeta | null> {
  const snap = await getDoc(doc(db, 'zohoVendorMeta', 'sync'));
  if (!snap.exists()) return null;
  const data = snap.data();
  const at = data.lastSyncedAt?.toDate?.() ?? null;
  return {
    lastSyncedAt: at ? at.toISOString() : null,
    count: Number(data.count ?? 0),
    activeCount: Number(data.activeCount ?? 0),
  };
}

export async function syncZohoVendorsFromZoho(): Promise<{
  count: number;
  activeCount: number;
  detailsFilled: number;
  purchaseOrdersUpdated: number;
}> {
  const callable = httpsCallable<
    Record<string, never>,
    {
      count?: number;
      activeCount?: number;
      detailsFilled?: number;
      purchaseOrdersUpdated?: number;
    }
  >(functions, 'syncZohoVendors', { timeout: 180_000 });
  try {
    const result = await callable({});
    return {
      count: Number(result.data?.count ?? 0),
      activeCount: Number(result.data?.activeCount ?? 0),
      detailsFilled: Number(result.data?.detailsFilled ?? 0),
      purchaseOrdersUpdated: Number(result.data?.purchaseOrdersUpdated ?? 0),
    };
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function searchZohoVendors(queryText = '', page = 1): Promise<ZohoVendorOption[]> {
  const callable = httpsCallable<
    { query?: string; page?: number; perPage?: number; all?: boolean },
    { vendors?: ZohoVendorOption[] }
  >(functions, 'searchZohoVendors', { timeout: 60_000 });
  try {
    const result = await callable({
      query: queryText.trim(),
      page,
      perPage: 50,
      all: false,
    });
    return Array.isArray(result.data?.vendors) ? result.data.vendors : [];
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

/** One server-side Zoho list (already deployed) — used when Firestore is empty or blocked. */
export async function fetchZohoVendorsLive(): Promise<ZohoVendorOption[]> {
  const callable = httpsCallable<
    { query?: string; all?: boolean; perPage?: number },
    { vendors?: ZohoVendorOption[] }
  >(functions, 'searchZohoVendors', { timeout: 60_000 });
  try {
    const result = await callable({ query: '', all: true, perPage: 200 });
    return Array.isArray(result.data?.vendors) ? result.data.vendors : [];
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
