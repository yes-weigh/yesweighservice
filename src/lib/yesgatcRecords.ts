import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';

export const YESGATC_CERTIFICATES = 'yesgatcCertificates';
export const YESGATC_RC_DETAILS = 'yesgatcRcDetails';
export const YESGATC_WEBHOOK_SETTINGS_ID = 'yesgatcWebhook';

export const YESGATC_WEBHOOK_URL = 'https://yesweigh-service.web.app/webhooks/yesgatc';
export const YESGATC_WEBHOOK_FUNCTION_URL =
  'https://asia-south1-yesweigh-service.cloudfunctions.net/yesgatcPushWebhook';

export const YESONE_RC_CODE = 'IWP';
export const YESONE_RC_NAME = 'INTERWEIGHING PVT LTD';

const functions = getFunctions(app, 'asia-south1');

export type YesGatcCertificate = {
  id: string;
  certificateNumber: string;
  serialNumber: string;
  dealerName: string;
  dealerId: string | null;
  productName: string;
  sku: string | null;
  rcCode: string | null;
  rcName: string | null;
  status: string | null;
  issuedAt: string | null;
  pdfUrl: string | null;
  receivedAt: string | null;
  yesoneVisible?: boolean;
  max: string;
  min: string;
  e: string;
  raw: unknown;
};

export type YesGatcRcDetail = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  receivedAt: string | null;
  raw: unknown;
};

export type YesGatcWebhookSettings = {
  secret: string;
  destinationUrl: string;
  pasteUrl: string;
};

function isoFromUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function nullable(value: unknown): string | null {
  const text = str(value);
  return text || null;
}

export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function webhookPasteUrl(secret: string): string {
  const key = secret.trim();
  if (!key) return YESGATC_WEBHOOK_URL;
  return `${YESGATC_WEBHOOK_URL}?key=${encodeURIComponent(key)}`;
}

export async function loadYesGatcWebhookSettings(): Promise<YesGatcWebhookSettings | null> {
  const snap = await getDoc(doc(db, 'appSettings', YESGATC_WEBHOOK_SETTINGS_ID));
  const secret = str(snap.data()?.secret);
  if (!secret) return null;
  return {
    secret,
    destinationUrl: YESGATC_WEBHOOK_URL,
    pasteUrl: webhookPasteUrl(secret),
  };
}

export async function saveYesGatcWebhookSecret(
  secret: string,
  actorName: string,
): Promise<YesGatcWebhookSettings> {
  const value = secret.trim();
  if (!value) throw new Error('Webhook secret is empty.');
  await setDoc(doc(db, 'appSettings', YESGATC_WEBHOOK_SETTINGS_ID), {
    secret: value,
    destinationUrl: YESGATC_WEBHOOK_URL,
    updatedAt: serverTimestamp(),
    updatedBy: actorName,
  }, { merge: true });
  return {
    secret: value,
    destinationUrl: YESGATC_WEBHOOK_URL,
    pasteUrl: webhookPasteUrl(value),
  };
}

export async function ensureYesGatcWebhookSettings(
  actorName: string,
): Promise<YesGatcWebhookSettings> {
  try {
    const fn = httpsCallable<{ actorName: string }, YesGatcWebhookSettings>(
      functions,
      'ensureYesGatcWebhookFn',
    );
    return (await fn({ actorName })).data;
  } catch {
    const existing = await loadYesGatcWebhookSettings();
    if (existing) return existing;
    return saveYesGatcWebhookSecret(generateWebhookSecret(), actorName);
  }
}

export async function rotateYesGatcWebhookSecret(
  actorName: string,
): Promise<YesGatcWebhookSettings> {
  try {
    const fn = httpsCallable<{ actorName: string }, YesGatcWebhookSettings>(
      functions,
      'rotateYesGatcWebhookFn',
    );
    return (await fn({ actorName })).data;
  } catch {
    return saveYesGatcWebhookSecret(generateWebhookSecret(), actorName);
  }
}

const MAX_SPEC_KEYS = new Set([
  'max', 'maxcapacity', 'maximum', 'maxload', 'maximumcapacity', 'maxcap', 'capmax',
  'maxkg', 'maxinkg', 'capacitykg', 'wmax',
]);
const MIN_SPEC_KEYS = new Set([
  'min', 'mincapacity', 'minimum', 'minload', 'minimumcapacity', 'mincap', 'capmin',
  'minkg', 'ming', 'mining', 'miningrams', 'minloadg', 'minvalue',
]);
const E_SPEC_KEYS = new Set([
  'e', 'evalue', 'verificationinterval', 'scaleinterval', 'intervale', 'einterval',
  'verificationscale', 'eidivision', 'eg', 'eing', 'eingrams', 'egram', 'egrams',
]);

function normSpecKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function specLeafText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  const amount = record.value ?? record.val ?? record.amount ?? record.qty ?? record.reading;
  const unit = record.unit ?? record.uom ?? record.units ?? record.unitName;
  const amountText = amount == null ? '' : String(amount).trim();
  const unitText = unit == null ? '' : String(unit).trim();
  if (amountText && unitText) return `${amountText} ${unitText}`;
  return amountText;
}

function walkSpecValue(value: unknown, keys: Set<string>, depth = 0): string {
  if (value == null || depth > 6) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkSpecValue(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const named = str(record.name || record.label || record.key || record.field);
  if (named && keys.has(normSpecKey(named))) {
    const fromName = specLeafText(record.value ?? record.val ?? record.reading) || specLeafText(record);
    if (fromName) return fromName;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (!keys.has(normSpecKey(key))) continue;
    const text = specLeafText(nested);
    if (text) return text;
  }
  for (const nested of Object.values(record)) {
    const found = walkSpecValue(nested, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

function specsFromFreeText(text: string): { max: string; min: string; e: string } {
  const blob = text.replace(/\s+/g, ' ');
  const max = blob.match(/\bmax(?:imum)?(?:\s*capacity)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  const min = blob.match(/\bmin(?:imum)?(?:\s*capacity)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  const e = blob.match(/\be\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  return {
    max: max ? `${max[1]}${max[2] ? ` ${max[2].toLowerCase()}` : ''}` : '',
    min: min ? `${min[1]}${min[2] ? ` ${min[2].toLowerCase()}` : ''}` : '',
    e: e ? `${e[1]}${e[2] ? ` ${e[2].toLowerCase()}` : ''}` : '',
  };
}

function withSpecUnit(value: string, unit: 'kg' | 'g'): string {
  const text = value.trim();
  if (!text) return '';
  if (/\b(kgs?|gms?|grams?)\b/i.test(text)) {
    return text
      .replace(/\bkgs\b/i, 'kg')
      .replace(/\b(gms?|grams?)\b/i, 'g');
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  return `${text} ${unit}`;
}

export function yesGatcInstrumentSpecs(row: {
  max?: string | null;
  min?: string | null;
  e?: string | null;
  raw?: unknown;
  productName?: string | null;
} & Record<string, unknown>): { max: string; min: string; e: string } {
  const fromFields = {
    max: str(row.max) || str(row.maxCapacity) || str(row.Max),
    min: str(row.min) || str(row.minCapacity) || str(row.Min),
    e: str(row.e) || str(row.eValue) || str(row.E),
  };
  let max = fromFields.max || walkSpecValue(row, MAX_SPEC_KEYS) || walkSpecValue(row.raw, MAX_SPEC_KEYS);
  let min = fromFields.min || walkSpecValue(row, MIN_SPEC_KEYS) || walkSpecValue(row.raw, MIN_SPEC_KEYS);
  let e = fromFields.e || walkSpecValue(row, E_SPEC_KEYS) || walkSpecValue(row.raw, E_SPEC_KEYS);
  if (!max || !min || !e) {
    const fromText = specsFromFreeText([
      str(row.productName),
      typeof row.raw === 'string' ? row.raw : JSON.stringify(row.raw ?? ''),
    ].join(' '));
    max = max || fromText.max;
    min = min || fromText.min;
    e = e || fromText.e;
  }
  return {
    max: withSpecUnit(max, 'kg'),
    min: withSpecUnit(min, 'g'),
    e: withSpecUnit(e, 'g'),
  };
}

function withCertificateSpecs(row: YesGatcCertificate): YesGatcCertificate {
  const specs = yesGatcInstrumentSpecs(row);
  return { ...row, ...specs };
}

function certificateNumberParts(value: string): number[] {
  return String(value).split(/[^0-9]+/).filter(Boolean).map(part => Number(part));
}

export function compareYesGatcCertificateLatestFirst(a: YesGatcCertificate, b: YesGatcCertificate): number {
  const left = certificateNumberParts(a.certificateNumber);
  const right = certificateNumberParts(b.certificateNumber);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const av = left[index] ?? -1;
    const bv = right[index] ?? -1;
    if (av !== bv) return bv - av;
  }
  return String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? ''));
}

function mapCertificate(id: string, data: Record<string, unknown>): YesGatcCertificate {
  const specs = yesGatcInstrumentSpecs(data);
  return {
    id,
    certificateNumber: str(data.certificateNumber),
    serialNumber: str(data.serialNumber),
    dealerName: str(data.dealerName),
    dealerId: nullable(data.dealerId),
    productName: str(data.productName),
    sku: nullable(data.sku),
    rcCode: nullable(data.rcCode),
    rcName: nullable(data.rcName),
    status: nullable(data.status)
      || (data.signed === true || data.isSigned === true ? 'signed' : null),
    issuedAt: nullable(data.issuedAt),
    pdfUrl: nullable(data.pdfUrl),
    receivedAt: isoFromUnknown(data.receivedAt),
    yesoneVisible: data.yesoneVisible === true,
    max: specs.max,
    min: specs.min,
    e: specs.e,
    raw: data.raw ?? null,
  };
}

function mapRc(id: string, data: Record<string, unknown>): YesGatcRcDetail {
  return {
    id,
    code: str(data.code),
    name: str(data.name),
    address: nullable(data.address),
    city: nullable(data.city),
    state: nullable(data.state),
    pincode: nullable(data.pincode),
    phone: nullable(data.phone),
    email: nullable(data.email),
    status: nullable(data.status),
    receivedAt: isoFromUnknown(data.receivedAt),
    raw: data.raw ?? null,
  };
}

function looksLikeIwpRc(code: string | null | undefined, name: string | null | undefined, raw: unknown): boolean {
  const compactCode = String(code ?? '').trim().toUpperCase();
  if (
    compactCode === YESONE_RC_CODE
    || compactCode.startsWith(`${YESONE_RC_CODE}/`)
    || compactCode.startsWith(`${YESONE_RC_CODE}-`)
  ) return true;
  const compactName = String(name ?? '').replace(/[\s\-_]+/g, '').trim().toUpperCase();
  if (compactName === 'INTERWEIGHINGPVTLTD' || compactName.includes('INTERWEIGHING')) return true;
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  const nested = [record.rc, record.rcOffice, record.regionalCenter, record.rcDetail]
    .find(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const codeBits = [
    nested?.code, nested?.rcCode, record.rcCode, record.rc_code, record.officeCode,
    typeof record.rc === 'string' ? record.rc : null,
  ];
  if (codeBits.some((value) => {
    const next = String(value ?? '').trim().toUpperCase();
    return next === YESONE_RC_CODE || next.startsWith(`${YESONE_RC_CODE}/`) || next.startsWith(`${YESONE_RC_CODE}-`);
  })) return true;
  const nameBits = [
    nested?.name, nested?.rcName, record.rcName, record.rc_name, record.officeName,
    record.issuedBy, record.issued_by, record.office,
  ];
  return nameBits.some((value) => {
    const named = String(value ?? '').replace(/[\s\-_]+/g, '').trim().toUpperCase();
    return named === 'INTERWEIGHINGPVTLTD' || named.includes('INTERWEIGHING');
  });
}

export function isYesoneIwpCertificate(row: YesGatcCertificate): boolean {
  if (row.yesoneVisible === true) return true;
  return looksLikeIwpRc(row.rcCode, row.rcName, row.raw);
}

export function isYesoneIwpRcDetail(row: YesGatcRcDetail): boolean {
  return looksLikeIwpRc(row.code, row.name, row.raw);
}

async function loadCertificatesWhere(
  field: 'yesoneVisible' | 'rcCode',
  value: string | boolean,
): Promise<YesGatcCertificate[]> {
  const col = collection(db, YESGATC_CERTIFICATES);
  const pageSize = 400;
  const rows: YesGatcCertificate[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  for (;;) {
    const snap: QuerySnapshot<DocumentData> = await getDocs(
      cursor
        ? query(col, where(field, '==', value), startAfter(cursor), limit(pageSize))
        : query(col, where(field, '==', value), limit(pageSize)),
    );
    rows.push(...snap.docs.map(docSnap => (
      mapCertificate(docSnap.id, docSnap.data() as Record<string, unknown>)
    )));
    if (snap.size < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return rows;
}

export async function countYesGatcIwpCertificates(): Promise<number> {
  const col = collection(db, YESGATC_CERTIFICATES);
  const counts = await Promise.allSettled([
    getCountFromServer(query(col, where('yesoneVisible', '==', true))),
    getCountFromServer(query(col, where('rcCode', '==', YESONE_RC_CODE))),
  ]);
  let best = 0;
  for (const result of counts) {
    if (result.status === 'fulfilled') {
      best = Math.max(best, result.value.data().count);
    }
  }
  return best;
}

export async function listYesGatcCertificates(max = 10000): Promise<YesGatcCertificate[]> {
  const merge = new Map<string, YesGatcCertificate>();
  const take = (rows: YesGatcCertificate[]) => {
    for (const row of rows) {
      if (merge.size >= max || merge.has(row.id) || !isYesoneIwpCertificate(row)) continue;
      merge.set(row.id, withCertificateSpecs(row));
    }
  };

  try {
    take(await loadCertificatesWhere('yesoneVisible', true));
  } catch {
    // Rules or index missing — rcCode query still runs.
  }
  try {
    take(await loadCertificatesWhere('rcCode', YESONE_RC_CODE));
  } catch {
    // Rules or index missing.
  }

  if (merge.size === 0) {
    try {
      const fn = httpsCallable<{ max?: number }, { rows: YesGatcCertificate[] }>(
        functions,
        'listYesGatcCertificatesFn',
      );
      take((await fn({ max })).data.rows ?? []);
    } catch {
      // Callable unavailable.
    }
  }

  return [...merge.values()].sort(compareYesGatcCertificateLatestFirst);
}

export async function listYesGatcRcDetails(max = 400): Promise<YesGatcRcDetail[]> {
  try {
    const fn = httpsCallable<{ max?: number }, { rows: YesGatcRcDetail[] }>(
      functions,
      'listYesGatcRcDetailsFn',
    );
    return ((await fn({ max })).data.rows ?? []).filter(isYesoneIwpRcDetail);
  } catch {
    const col = collection(db, YESGATC_RC_DETAILS);
    try {
      const snap = await getDocs(query(col, where('yesoneVisible', '==', true), limit(max)));
      return snap.docs
        .map(row => mapRc(row.id, row.data() as Record<string, unknown>))
        .filter(isYesoneIwpRcDetail)
        .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')));
    } catch {
      const snap = await getDocs(query(col, where('code', '==', YESONE_RC_CODE), limit(max)));
      return snap.docs
        .map(row => mapRc(row.id, row.data() as Record<string, unknown>))
        .filter(isYesoneIwpRcDetail)
        .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')));
    }
  }
}

export function formatYesGatcWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function firstDateText(value: unknown): string {
  const iso = isoFromUnknown(value);
  if (iso) return iso;
  const text = str(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function yesGatcCertifiedAt(row: YesGatcCertificate): string {
  const fromFields = firstDateText(row.issuedAt);
  if (fromFields) return formatYesGatcWhen(fromFields);
  if (row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)) {
    const record = row.raw as Record<string, unknown>;
    const nested = firstDateText(
      record.issuedAt
      ?? record.issueDate
      ?? record.issued_on
      ?? record.certifiedAt
      ?? record.certificationDate
      ?? record.certifiedOn
      ?? record.dateOfCertification,
    );
    if (nested) return formatYesGatcWhen(nested);
  }
  return formatYesGatcWhen(row.receivedAt);
}

function signedFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  if (/\b(un|not[-_ ]?)signed\b/.test(text)) return false;
  return text === 'true' || text === 'yes' || text === '1' || /\bsigned\b/.test(text);
}

export function isYesGatcCertificateSigned(row: YesGatcCertificate): boolean {
  if (signedFlag(row.status)) return true;
  if (row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)) {
    const record = row.raw as Record<string, unknown>;
    if (
      signedFlag(record.signed)
      || signedFlag(record.isSigned)
      || signedFlag(record.digitallySigned)
      || signedFlag(record.status)
      || signedFlag(record.state)
      || signedFlag(record.certificateStatus)
      || signedFlag(record.signStatus)
      || signedFlag(record.tag)
    ) return true;
    const message = String(record.message ?? record.tag ?? '').toLowerCase();
    if (/\bsigned\b/.test(message)) return true;
  }
  return false;
}
