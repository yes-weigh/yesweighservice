import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

/** Canonical dealer RC roster — same documents as Firestore `yesgatcRcOffices`. */
export const YESGATC_RC_OFFICES = 'yesgatcRcOffices';

export type YesGatcRcOfficeKind = 'dealer' | 'company';

export type YesGatcRcOffice = {
  id: string;
  code: string;
  name: string;
  place: string | null;
  kind: YesGatcRcOfficeKind;
  active: boolean;
  sortOrder: number;
  sourceRcId: string | null;
  dealerId: string | null;
  dealerName: string | null;
};

/** Official dealer RCs from Settings → RC OV (IWP is company, not listed). */
export const YESGATC_DEALER_RC_OFFICES: ReadonlyArray<Omit<YesGatcRcOffice, 'id' | 'sourceRcId' | 'dealerId' | 'dealerName'>> = [
  { code: 'ATL', name: 'ACCURATE TRADE LINKS', place: 'Dehradun', kind: 'dealer', active: true, sortOrder: 1 },
  { code: 'MZN', name: 'Meezan electronic scales pvt ltd', place: 'Malappuram', kind: 'dealer', active: true, sortOrder: 2 },
  { code: 'DYI', name: 'Dynamic Enterprise', place: 'Thrissur', kind: 'dealer', active: true, sortOrder: 3 },
  { code: 'ACE', name: 'ACE ELECTRONICS', place: 'Kozhikode', kind: 'dealer', active: true, sortOrder: 4 },
  { code: 'KNR', name: 'ROYAL SCALES', place: 'Kannur', kind: 'dealer', active: true, sortOrder: 5 },
  { code: 'KTM', name: 'VICTORY SCALES', place: 'Kottayam', kind: 'dealer', active: true, sortOrder: 6 },
  { code: 'KSR', name: 'Kraus Instruments', place: 'Thrissur', kind: 'dealer', active: true, sortOrder: 7 },
  { code: 'KLM', name: 'TAKYON SYSTEMS', place: 'Kollam', kind: 'dealer', active: true, sortOrder: 8 },
];

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function nullable(value: unknown): string | null {
  const text = str(value);
  return text || null;
}

export function normalizeYesGatcRcCode(value: unknown): string {
  return str(value).toUpperCase();
}

export function isYesGatcDealerRcCode(code: unknown): boolean {
  const wanted = normalizeYesGatcRcCode(code);
  return Boolean(wanted) && YESGATC_DEALER_RC_OFFICES.some(row => row.code === wanted);
}

export function yesGatcDealerRcOfficeFallback(code: unknown): YesGatcRcOffice | null {
  const wanted = normalizeYesGatcRcCode(code);
  const row = YESGATC_DEALER_RC_OFFICES.find(item => item.code === wanted);
  if (!row) return null;
  return {
    id: row.code,
    ...row,
    sourceRcId: null,
    dealerId: null,
    dealerName: null,
  };
}

function mapOffice(id: string, data: DocumentData): YesGatcRcOffice {
  const code = normalizeYesGatcRcCode(data.code) || normalizeYesGatcRcCode(id);
  const fallback = yesGatcDealerRcOfficeFallback(code);
  return {
    id,
    code,
    name: str(data.name) || fallback?.name || code,
    place: nullable(data.place) ?? fallback?.place ?? null,
    kind: data.kind === 'company' ? 'company' : 'dealer',
    active: data.active !== false,
    sortOrder: Number(data.sortOrder) || fallback?.sortOrder || 99,
    sourceRcId: nullable(data.sourceRcId),
    dealerId: nullable(data.dealerId),
    dealerName: nullable(data.dealerName),
  };
}

export async function listYesGatcRcOffices(): Promise<YesGatcRcOffice[]> {
  try {
    const snap = await getDocs(query(
      collection(db, YESGATC_RC_OFFICES),
      where('kind', '==', 'dealer'),
    ));
    if (!snap.empty) {
      return snap.docs
        .map(row => mapOffice(row.id, row.data()))
        .filter(row => row.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }
  } catch {
    // Rules or empty — use the built-in roster.
  }
  return YESGATC_DEALER_RC_OFFICES.map(row => ({
    id: row.code,
    ...row,
    sourceRcId: null,
    dealerId: null,
    dealerName: null,
  }));
}

export async function getYesGatcRcOffice(code: string): Promise<YesGatcRcOffice | null> {
  const wanted = normalizeYesGatcRcCode(code);
  if (!wanted) return null;
  try {
    const snap = await getDoc(doc(db, YESGATC_RC_OFFICES, wanted));
    if (snap.exists()) {
      const row = mapOffice(snap.id, snap.data() as DocumentData);
      if (row.kind === 'dealer' && row.active) return row;
    }
  } catch {
    // Fall through to the built-in roster.
  }
  return yesGatcDealerRcOfficeFallback(wanted);
}

export async function getYesGatcRcOfficeBySourceRcId(rcId: string): Promise<YesGatcRcOffice | null> {
  const sid = str(rcId);
  if (!sid) return null;
  try {
    const snap = await getDocs(query(
      collection(db, YESGATC_RC_OFFICES),
      where('sourceRcId', '==', sid),
    ));
    const row = snap.docs[0];
    if (!row) return null;
    const office = mapOffice(row.id, row.data());
    if (office.kind === 'dealer' && office.active) return office;
  } catch {
    return null;
  }
  return null;
}
