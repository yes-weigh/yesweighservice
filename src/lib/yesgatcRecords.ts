import {
  collection,
  deleteDoc,
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
export const YESGATC_RC_DEALER_LINKS = 'yesgatcRcDealerLinks';
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
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceCustomerId: string | null;
  verificationType?: string | null;
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
  dealerId: string | null;
  dealerName: string | null;
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
    invoiceId: nullable(data.invoiceId),
    invoiceNumber: nullable(data.invoiceNumber),
    invoiceDate: nullable(data.invoiceDate),
    invoiceCustomerId: nullable(data.invoiceCustomerId),
    verificationType: nullable(data.verificationType)
      || (data.raw && typeof data.raw === 'object' && !Array.isArray(data.raw)
        ? nullable((data.raw as Record<string, unknown>).verificationType)
        : null),
    raw: data.raw ?? null,
  };
}

function isCodeLikeName(value: string, code: string): boolean {
  const compact = value.replace(/[\s.\-_]/g, '').toUpperCase();
  const codeCompact = code.replace(/[\s.\-_]/g, '').toUpperCase();
  if (!compact) return true;
  if (codeCompact && compact === codeCompact) return true;
  return compact.length <= 4 && /^[A-Z0-9]+$/.test(compact);
}

const RC_NAME_KEYS = [
  'name', 'rcName', 'rc_name', 'officeName', 'office_name', 'title',
  'company', 'companyName', 'company_name', 'firm', 'firmName', 'firm_name',
  'organisation', 'organization', 'orgName', 'legalName', 'displayName',
  'rcOfficeName', 'regionalCenterName', 'centreName', 'centerName',
];

function nameFromRecord(record: Record<string, unknown> | null | undefined, code: string): string {
  if (!record) return '';
  for (const key of RC_NAME_KEYS) {
    const text = str(record[key]);
    if (text && !isCodeLikeName(text, code)) return text;
  }
  return '';
}

function nameFromAddress(address: string, code: string): string {
  const text = address.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const first = text.split(',')[0]?.trim() ?? '';
  const company = first.split(/\s+(?:Room|No\.?|Nagar|Road|Rd\.?)\b/i)[0]?.trim() ?? '';
  if (
    company
    && company.length >= 4
    && !isCodeLikeName(company, code)
    && !/^\d/.test(company)
    && !/^(TC|PMC|DOOR|PLOT)\b/i.test(company)
  ) {
    return company;
  }
  return '';
}

function resolveRcFullName(
  code: string,
  data: Record<string, unknown>,
  raw: Record<string, unknown> | null,
  address: string | null,
): string {
  if (looksLikeIwpRc(code, str(data.name), raw)) return YESONE_RC_NAME;
  const nested = raw
    ? [raw.rc, raw.rcOffice, raw.regionalCenter, raw.rcDetail, raw.office]
      .find(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined
    : undefined;
  return nameFromRecord(data, code)
    || nameFromRecord(raw, code)
    || nameFromRecord(nested, code)
    || nameFromAddress(address || str(raw?.address) || str(data.address), code);
}

function mapRc(id: string, data: Record<string, unknown>): YesGatcRcDetail {
  const raw = data.raw && typeof data.raw === 'object' && !Array.isArray(data.raw)
    ? data.raw as Record<string, unknown>
    : null;
  const code = str(data.code) || str(raw?.code) || str(raw?.rcCode) || str(raw?.rc_code);
  const address = nullable(data.address) ?? nullable(raw?.address);
  return {
    id,
    code,
    name: resolveRcFullName(code, data, raw, address),
    address,
    city: nullable(data.city) ?? nullable(raw?.city),
    state: nullable(data.state) ?? nullable(raw?.state),
    pincode: nullable(data.pincode) ?? nullable(raw?.pincode),
    phone: nullable(data.phone) ?? nullable(raw?.phone) ?? nullable(raw?.mobile),
    email: nullable(data.email) ?? nullable(raw?.email),
    status: nullable(data.status) ?? nullable(raw?.status),
    receivedAt: isoFromUnknown(data.receivedAt),
    dealerId: nullable(data.dealerId),
    dealerName: nullable(data.dealerName),
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

export function isYesoneIwpRcDetail(row: Pick<YesGatcRcDetail, 'code' | 'name' | 'raw'>): boolean {
  return looksLikeIwpRc(row.code, row.name, row.raw);
}

export function yesGatcRcKey(row: Pick<YesGatcRcDetail, 'id' | 'code'>): string {
  return str(row.code).toUpperCase() || row.id;
}

export function yesGatcRcOfficeName(row: YesGatcRcDetail): string {
  const named = str(row.name);
  if (named && !isCodeLikeName(named, row.code)) return named;
  if (isYesoneIwpRcDetail(row) || str(row.code).toUpperCase() === YESONE_RC_CODE) {
    return YESONE_RC_NAME;
  }
  return named || row.code || row.id;
}

export function yesGatcRcLabel(row: YesGatcRcDetail): string {
  return str(row.dealerName) || yesGatcRcOfficeName(row);
}

export function yesGatcCertificateRcDisplayName(
  row: YesGatcCertificate,
  rcs: ReadonlyArray<YesGatcRcDetail> = [],
): string {
  const match = rcs.find(rc => certificateMatchesRc(row, rc));
  if (match) return yesGatcRcOfficeName(match) || yesGatcRcLabel(match);
  return str(row.rcName);
}

export async function loadYesGatcInvoicePartyNames(
  rows: ReadonlyArray<Pick<YesGatcCertificate, 'id' | 'invoiceCustomerId' | 'invoiceId'>>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const customerCache = new Map<string, string>();
  await Promise.all(rows.map(async row => {
    const customerId = str(row.invoiceCustomerId);
    const invoiceId = str(row.invoiceId);
    if (!customerId) return;
    if (invoiceId) {
      const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
      const fromInvoice = str(snap.data()?.customerName);
      if (fromInvoice) {
        names.set(row.id, fromInvoice);
        return;
      }
    }
    if (!customerCache.has(customerId)) {
      const snap = await getDoc(doc(db, 'zohoCustomers', customerId));
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      customerCache.set(
        customerId,
        str(data.companyName) || str(data.customerName) || str(data.contactName) || str(data.displayName),
      );
    }
    const name = customerCache.get(customerId) || '';
    if (name) names.set(row.id, name);
  }));
  return names;
}

export function withDefaultIwpRc(rows: YesGatcRcDetail[]): YesGatcRcDetail[] {
  const list = rows.map(row => (
    isYesoneIwpRcDetail(row) && !row.name
      ? { ...row, name: YESONE_RC_NAME }
      : row
  ));
  if (!list.some(isYesoneIwpRcDetail)) {
    list.unshift({
      id: YESONE_RC_CODE,
      code: YESONE_RC_CODE,
      name: YESONE_RC_NAME,
      address: null,
      city: null,
      state: null,
      pincode: null,
      phone: null,
      email: null,
      status: null,
      receivedAt: null,
      dealerId: null,
      dealerName: null,
      raw: null,
    });
  }
  return list.sort((a, b) => {
    const aIwp = isYesoneIwpRcDetail(a) ? 0 : 1;
    const bIwp = isYesoneIwpRcDetail(b) ? 0 : 1;
    if (aIwp !== bIwp) return aIwp - bIwp;
    return yesGatcRcLabel(a).localeCompare(yesGatcRcLabel(b), 'en', { sensitivity: 'base' });
  });
}

export function yesGatcCertificateRcKeys(
  row: Pick<YesGatcCertificate, 'rcCode' | 'rcName' | 'yesoneVisible' | 'raw'>,
): string[] {
  return certificateRcIndexKeys({
    rcCode: row.rcCode,
    rcName: row.rcName,
    yesoneVisible: row.yesoneVisible === true,
    raw: row.raw,
  });
}

export function isYesGatcOvCertificate(row: YesGatcCertificate): boolean {
  return yesGatcVerificationKind(row) === 'OV';
}

export function certificateMatchesRc(
  row: YesGatcCertificate,
  rc: string | Pick<YesGatcRcDetail, 'id' | 'code' | 'name' | 'raw'>,
): boolean {
  if (typeof rc === 'string') {
    const wanted = str(rc).toUpperCase() || YESONE_RC_CODE;
    if (wanted === YESONE_RC_CODE) return isYesoneIwpCertificate(row);
    return yesGatcCertificateRcKeys(row).includes(wanted);
  }
  if (isYesoneIwpRcDetail(rc) || str(rc.code).toUpperCase() === YESONE_RC_CODE) {
    return isYesoneIwpCertificate(row);
  }
  const wanted = new Set(
    [str(rc.id).toUpperCase(), str(rc.code).toUpperCase()].filter(Boolean),
  );
  return yesGatcCertificateRcKeys(row).some(key => wanted.has(key));
}

export type YesGatcVerificationKind = 'OV' | 'RV';
export type YesGatcOvRvTotals = { ov: number; rv: number; linked: number };

export function emptyYesGatcOvRvTotals(): YesGatcOvRvTotals {
  return { ov: 0, rv: 0, linked: 0 };
}

export function yesGatcVerificationKind(source: unknown): YesGatcVerificationKind | null {
  if (source == null) return null;
  let text = '';
  if (typeof source === 'string') text = source;
  else if (typeof source === 'object' && !Array.isArray(source)) {
    const record = source as Record<string, unknown>;
    const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
      ? record.raw as Record<string, unknown>
      : null;
    text = str(record.verificationType)
      || str(raw?.verificationType)
      || str(raw?.verification_type)
      || str(record.verification_type);
  }
  const upper = text.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'OV' || upper.startsWith('ORIGINAL')) return 'OV';
  if (upper === 'RV' || upper.startsWith('RE')) return 'RV';
  return null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function certificateRcIndexKeys(data: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const text = str(value).toUpperCase();
    if (text) keys.add(text);
  };
  const raw = recordFromUnknown(data.raw);
  const nestedRc = recordFromUnknown(raw?.rc)
    || recordFromUnknown(raw?.rcOffice)
    || recordFromUnknown(raw?.regionalCenter);
  add(data.rcCode);
  add(data.rcId);
  add(raw?.rcId);
  add(raw?.rcCode);
  add(nestedRc?.id);
  add(nestedRc?.code);
  add(nestedRc?.rcCode);
  if (data.yesoneVisible === true || looksLikeIwpRc(str(data.rcCode), str(data.rcName), raw)) {
    keys.add(YESONE_RC_CODE);
  }
  return [...keys];
}

function isInvoiceLinkedCertificate(data: Record<string, unknown>): boolean {
  return Boolean(str(data.invoiceNumber) || str(data.invoiceId));
}

function isVoidedCertificate(data: Record<string, unknown>): boolean {
  if (data.voided === true) return true;
  const raw = recordFromUnknown(data.raw);
  return raw?.voided === true;
}

export function yesGatcOvRvForRc(
  totals: Map<string, YesGatcOvRvTotals>,
  rc: Pick<YesGatcRcDetail, 'id' | 'code' | 'name' | 'raw'>,
): YesGatcOvRvTotals {
  return totals.get(rc.id) ?? emptyYesGatcOvRvTotals();
}

export async function countYesGatcLifetimeOvRv(
  rcs: ReadonlyArray<YesGatcRcDetail>,
): Promise<Map<string, YesGatcOvRvTotals>> {
  const totals = new Map<string, YesGatcOvRvTotals>();
  for (const rc of rcs) totals.set(rc.id, emptyYesGatcOvRvTotals());
  if (rcs.length === 0) return totals;

  const keyToRcIds = new Map<string, string[]>();
  for (const rc of rcs) {
    const keys = [rc.id, str(rc.code).toUpperCase()].filter(Boolean);
    if (isYesoneIwpRcDetail(rc)) keys.push(YESONE_RC_CODE);
    for (const key of keys) {
      const list = keyToRcIds.get(key) ?? [];
      if (!list.includes(rc.id)) list.push(rc.id);
      keyToRcIds.set(key, list);
    }
  }

  const col = collection(db, YESGATC_CERTIFICATES);
  const pageSize = 400;
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  for (;;) {
    const snap: QuerySnapshot<DocumentData> = await getDocs(
      cursor
        ? query(col, startAfter(cursor), limit(pageSize))
        : query(col, limit(pageSize)),
    );
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (isVoidedCertificate(data)) continue;
      const kind = yesGatcVerificationKind(data);
      if (kind !== 'OV') continue;
      const hit = new Set<string>();
      for (const key of certificateRcIndexKeys(data)) {
        for (const rcId of keyToRcIds.get(key) ?? []) hit.add(rcId);
      }
      for (const rcId of hit) {
        const slot = totals.get(rcId) ?? emptyYesGatcOvRvTotals();
        slot.ov += 1;
        if (isInvoiceLinkedCertificate(data)) slot.linked += 1;
        totals.set(rcId, slot);
      }
    }
    if (snap.size < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return totals;
}

async function loadCertificatesWhere(
  field: 'yesoneVisible' | 'rcCode' | null,
  value: string | boolean | null,
): Promise<YesGatcCertificate[]> {
  const col = collection(db, YESGATC_CERTIFICATES);
  const pageSize = 400;
  const rows: YesGatcCertificate[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  for (;;) {
    const snap: QuerySnapshot<DocumentData> = await getDocs(
      cursor
        ? (field
          ? query(col, where(field, '==', value), startAfter(cursor), limit(pageSize))
          : query(col, startAfter(cursor), limit(pageSize)))
        : (field
          ? query(col, where(field, '==', value), limit(pageSize))
          : query(col, limit(pageSize))),
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

export async function countYesGatcIwpCertificates(rcCode = YESONE_RC_CODE): Promise<number> {
  const col = collection(db, YESGATC_CERTIFICATES);
  const wanted = str(rcCode).toUpperCase() || YESONE_RC_CODE;
  const queries = wanted === YESONE_RC_CODE
    ? [
      getCountFromServer(query(col, where('yesoneVisible', '==', true))),
      getCountFromServer(query(col, where('rcCode', '==', YESONE_RC_CODE))),
    ]
    : [getCountFromServer(query(col, where('rcCode', '==', wanted)))];
  const counts = await Promise.allSettled(queries);
  let best = 0;
  for (const result of counts) {
    if (result.status === 'fulfilled') {
      best = Math.max(best, result.value.data().count);
    }
  }
  return best;
}

export async function listYesGatcCertificates(
  max = 10000,
  filter: { rcCode?: string; rcId?: string; ovOnly?: boolean } = {},
): Promise<YesGatcCertificate[]> {
  const rcId = str(filter.rcId);
  const rcCode = str(filter.rcCode).toUpperCase();
  const ovOnly = filter.ovOnly !== false;
  const iwp = (!rcId && !rcCode)
    || rcCode === YESONE_RC_CODE
    || rcId.toUpperCase() === YESONE_RC_CODE;
  const merge = new Map<string, YesGatcCertificate>();
  const take = (rows: YesGatcCertificate[]) => {
    for (const row of rows) {
      const next = withCertificateSpecs({
        ...row,
        invoiceId: row.invoiceId ?? null,
        invoiceNumber: row.invoiceNumber ?? null,
        invoiceDate: row.invoiceDate ?? null,
        invoiceCustomerId: row.invoiceCustomerId ?? null,
      });
      const prev = merge.get(row.id);
      if (!prev) {
        if (merge.size >= max) continue;
        merge.set(row.id, next);
        continue;
      }
      if (!prev.invoiceNumber && next.invoiceNumber) {
        merge.set(row.id, {
          ...prev,
          invoiceId: next.invoiceId,
          invoiceNumber: next.invoiceNumber,
          invoiceDate: next.invoiceDate,
          invoiceCustomerId: next.invoiceCustomerId,
        });
      }
    }
  };

  const matchesFilter = (row: YesGatcCertificate) => {
    if (ovOnly && !isYesGatcOvCertificate(row)) return false;
    if (iwp) return isYesoneIwpCertificate(row);
    return certificateMatchesRc(row, { id: rcId, code: rcCode, name: '', raw: null });
  };

  if (iwp) {
    try {
      take(await loadCertificatesWhere('yesoneVisible', true));
    } catch {
      // ignore
    }
    try {
      take(await loadCertificatesWhere('rcCode', YESONE_RC_CODE));
    } catch {
      // ignore
    }
  } else {
    if (rcId) {
      try {
        take(await loadCertificatesWhere('rcCode', rcId));
      } catch {
        // ignore
      }
    }
    if (rcCode && rcCode !== rcId.toUpperCase()) {
      try {
        take(await loadCertificatesWhere('rcCode', rcCode));
      } catch {
        // ignore
      }
    }
  }

  let matched = [...merge.values()].filter(matchesFilter);

  if (matched.length === 0) {
    try {
      take(await loadCertificatesWhere(null, null));
    } catch {
      // Rules missing — callable fallback below.
    }
    matched = [...merge.values()].filter(matchesFilter);
  }

  if (matched.length === 0) {
    try {
      const fn = httpsCallable<
        { max?: number; rcCode?: string; rcId?: string; ovOnly?: boolean },
        { rows: YesGatcCertificate[] }
      >(
        functions,
        'listYesGatcCertificatesFn',
      );
      take((await fn({ max, rcCode, rcId, ovOnly })).data.rows ?? []);
      matched = [...merge.values()].filter(matchesFilter);
    } catch {
      // Callable unavailable.
    }
  }

  return matched.sort(compareYesGatcCertificateLatestFirst);
}

export async function listYesGatcRcDetails(max = 400): Promise<YesGatcRcDetail[]> {
  const merge = new Map<string, YesGatcRcDetail>();
  const take = (rows: YesGatcRcDetail[]) => {
    for (const row of rows) {
      if (merge.size >= max || merge.has(row.id)) continue;
      merge.set(row.id, mapRc(row.id, row as unknown as Record<string, unknown>));
    }
  };

  try {
    const fn = httpsCallable<{ max?: number }, { rows: YesGatcRcDetail[] }>(
      functions,
      'listYesGatcRcDetailsFn',
    );
    take((await fn({ max })).data.rows ?? []);
  } catch {
    // Callable unavailable — Firestore reads still run.
  }

  const col = collection(db, YESGATC_RC_DETAILS);
  for (const next of [
    () => getDocs(query(col, limit(max))),
    () => getDocs(query(col, where('yesoneVisible', '==', true), limit(max))),
    () => getDocs(query(col, where('code', '==', YESONE_RC_CODE), limit(max))),
  ]) {
    try {
      const snap = await next();
      take(snap.docs.map(row => mapRc(row.id, row.data() as Record<string, unknown>)));
      if (merge.size > 1) break;
    } catch {
      // Rules or index missing — try the next query.
    }
  }

  const links = await listYesGatcRcDealerLinks().catch(
    () => new Map<string, { dealerId: string; dealerName: string }>(),
  );

  return [...merge.values()]
    .map(row => applyRcDealerLink(row, links))
    .sort((a, b) => yesGatcRcLabel(a).localeCompare(yesGatcRcLabel(b), 'en', { sensitivity: 'base' }));
}

function applyRcDealerLink(
  row: YesGatcRcDetail,
  links: Map<string, { dealerId: string; dealerName: string }>,
): YesGatcRcDetail {
  const link = links.get(row.id) ?? links.get(yesGatcRcKey(row));
  if (!link) return row;
  return {
    ...row,
    dealerId: link.dealerId,
    dealerName: link.dealerName,
  };
}

export async function listYesGatcRcDealerLinks(): Promise<Map<string, { dealerId: string; dealerName: string }>> {
  const snap = await getDocs(collection(db, YESGATC_RC_DEALER_LINKS));
  const links = new Map<string, { dealerId: string; dealerName: string }>();
  for (const row of snap.docs) {
    const data = row.data() as Record<string, unknown>;
    const dealerId = str(data.dealerId);
    const dealerName = str(data.dealerName);
    if (!dealerId || !dealerName) continue;
    links.set(row.id, { dealerId, dealerName });
    const code = str(data.rcCode).toUpperCase();
    if (code) links.set(code, { dealerId, dealerName });
  }
  return links;
}

export async function saveYesGatcRcDealerLink(
  rcId: string,
  rcCode: string,
  dealerId: string,
  dealerName: string,
): Promise<void> {
  const snap = await getDocs(collection(db, YESGATC_RC_DEALER_LINKS));
  for (const row of snap.docs) {
    if (row.id === rcId) continue;
    const data = row.data() as Record<string, unknown>;
    if (str(data.dealerId) === dealerId) {
      throw new Error('This dealer is already linked to another RC. One dealer can be used only once.');
    }
  }
  await setDoc(doc(db, YESGATC_RC_DEALER_LINKS, rcId), {
    rcCode,
    dealerId,
    dealerName,
    linkedAt: serverTimestamp(),
  });
}

export async function clearYesGatcRcDealerLink(rcId: string): Promise<void> {
  await deleteDoc(doc(db, YESGATC_RC_DEALER_LINKS, rcId));
}

export function formatYesGatcWhen(iso: string | null | undefined, compact = false): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', compact
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function firstDateText(value: unknown): string {
  const iso = isoFromUnknown(value);
  if (iso) return iso;
  const text = str(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function yesGatcCertifiedIso(row: YesGatcCertificate): string | null {
  const fromFields = firstDateText(row.issuedAt);
  if (fromFields) return fromFields;
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
    if (nested) return nested;
  }
  return firstDateText(row.receivedAt) || null;
}

export function yesGatcCertifiedTimeMs(row: YesGatcCertificate): number | null {
  const iso = yesGatcCertifiedIso(row);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function yesGatcCertifiedAt(row: YesGatcCertificate, compact = false): string {
  return formatYesGatcWhen(yesGatcCertifiedIso(row), compact);
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

export async function runYesGatcInvoiceLink(minDate?: string): Promise<{
  matched?: number;
  written?: number;
}> {
  const fn = httpsCallable<
    { minDate?: string },
    { matched?: number; written?: number }
  >(functions, 'linkYesGatcInvoicesFn', { timeout: 540_000 });
  return (await fn(minDate ? { minDate } : {})).data ?? {};
}

export async function runYesGatcOvInvoiceQtyLink(minDate?: string): Promise<{
  assigned?: number;
  written?: number;
  unlinkedOv?: number;
}> {
  const fn = httpsCallable<
    { minDate?: string },
    { assigned?: number; written?: number; unlinkedOv?: number }
  >(functions, 'linkYesGatcOvByInvoiceQtyFn', { timeout: 540_000 });
  return (await fn(minDate ? { minDate } : {})).data ?? {};
}

export async function saveYesGatcCertificateInvoice(input: {
  certificateId: string;
  serialNumber?: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate?: string | null;
  invoiceCustomerId?: string | null;
}): Promise<{
  invoiceId: string | null;
  invoiceNumber: string;
  invoiceDate: string | null;
  invoiceCustomerId: string | null;
}> {
  const fn = httpsCallable<typeof input, {
    invoiceId?: string | null;
    invoiceNumber?: string;
    invoiceDate?: string | null;
    invoiceCustomerId?: string | null;
  }>(functions, 'linkYesGatcCertificateInvoiceFn');
  const data = (await fn(input)).data ?? {};
  return {
    invoiceId: data.invoiceId ?? input.invoiceId,
    invoiceNumber: data.invoiceNumber ?? input.invoiceNumber,
    invoiceDate: data.invoiceDate ?? input.invoiceDate ?? null,
    invoiceCustomerId: data.invoiceCustomerId ?? input.invoiceCustomerId ?? null,
  };
}
