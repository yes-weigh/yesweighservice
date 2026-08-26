import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

export const YESGATC_CERTIFICATES = 'yesgatcCertificates';
export const YESGATC_RC_DETAILS = 'yesgatcRcDetails';
export const YESGATC_WEBHOOK_SETTINGS_ID = 'yesgatcWebhook';

export const YESGATC_WEBHOOK_URL = 'https://yesweigh-service.web.app/webhooks/yesgatc';
export const YESGATC_WEBHOOK_FUNCTION_URL =
  'https://asia-south1-yesweigh-service.cloudfunctions.net/yesgatcPushWebhook';

export type YesGatcCertificate = {
  id: string;
  certificateNumber: string;
  serialNumber: string;
  dealerName: string;
  dealerId: string | null;
  productName: string;
  sku: string | null;
  rcCode: string | null;
  status: string | null;
  issuedAt: string | null;
  pdfUrl: string | null;
  receivedAt: string | null;
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
  const existing = await loadYesGatcWebhookSettings();
  if (existing) return existing;
  return saveYesGatcWebhookSecret(generateWebhookSecret(), actorName);
}

export async function rotateYesGatcWebhookSecret(
  actorName: string,
): Promise<YesGatcWebhookSettings> {
  return saveYesGatcWebhookSecret(generateWebhookSecret(), actorName);
}

function mapCertificate(id: string, data: Record<string, unknown>): YesGatcCertificate {
  return {
    id,
    certificateNumber: str(data.certificateNumber),
    serialNumber: str(data.serialNumber),
    dealerName: str(data.dealerName),
    dealerId: nullable(data.dealerId),
    productName: str(data.productName),
    sku: nullable(data.sku),
    rcCode: nullable(data.rcCode),
    status: nullable(data.status),
    issuedAt: nullable(data.issuedAt),
    pdfUrl: nullable(data.pdfUrl),
    receivedAt: isoFromUnknown(data.receivedAt),
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

export async function listYesGatcCertificates(max = 400): Promise<YesGatcCertificate[]> {
  const col = collection(db, YESGATC_CERTIFICATES);
  try {
    const snap = await getDocs(query(col, orderBy('receivedAt', 'desc'), limit(max)));
    return snap.docs.map(row => mapCertificate(row.id, row.data() as Record<string, unknown>));
  } catch {
    const snap = await getDocs(query(col, limit(max)));
    return snap.docs
      .map(row => mapCertificate(row.id, row.data() as Record<string, unknown>))
      .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')));
  }
}

export async function listYesGatcRcDetails(max = 400): Promise<YesGatcRcDetail[]> {
  const col = collection(db, YESGATC_RC_DETAILS);
  try {
    const snap = await getDocs(query(col, orderBy('receivedAt', 'desc'), limit(max)));
    return snap.docs.map(row => mapRc(row.id, row.data() as Record<string, unknown>));
  } catch {
    const snap = await getDocs(query(col, limit(max)));
    return snap.docs
      .map(row => mapRc(row.id, row.data() as Record<string, unknown>))
      .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')));
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
