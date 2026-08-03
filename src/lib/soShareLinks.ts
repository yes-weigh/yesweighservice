import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { PUBLIC_APP_ORIGIN } from '../constants/brand';
import { auth, db } from '../firebase';
import type { DealerInvoiceLineItem } from '../types/invoices';

const COLLECTION = 'soShareLinks';
const CODE_LENGTH = 6;
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Root paths that are exactly 6 letters — never use as share codes. */
const RESERVED_CODES = new Set([
  'dealer',
  'media',
  'Dealer',
  'Media',
  'DEALER',
  'MEDIA',
]);

/** Snapshot stored on the short link — rendered as HTML (no screenshot). */
export type SoShareDocument = {
  salesOrderId: string;
  salesOrderNumber: string;
  dateLabel: string;
  customerName: string;
  shippingAddress: string;
  currencyCode: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes: string;
  lineItems: DealerInvoiceLineItem[];
};

export type SoShareLinkRecord = {
  code: string;
  document: SoShareDocument;
  createdAt: string;
  createdByUid: string | null;
};

export function isSoShareCode(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[a-zA-Z]{6}$/.test(value);
}

export function soSharePublicPath(code: string): string {
  return `/${code}`;
}

export function soSharePublicUrl(code: string): string {
  return `${PUBLIC_APP_ORIGIN.replace(/\/$/, '')}${soSharePublicPath(code)}`;
}

function randomShareCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

async function allocateShareCode(): Promise<string> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const code = randomShareCode();
    if (RESERVED_CODES.has(code)) continue;
    const snap = await getDoc(doc(db, COLLECTION, code));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not create a unique share link. Try again.');
}

function mapLineItem(raw: unknown): DealerInvoiceLineItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    itemId: row.itemId != null && String(row.itemId).trim() ? String(row.itemId) : null,
    name: String(row.name ?? 'Item'),
    description: row.description != null ? String(row.description) : null,
    sku: row.sku != null ? String(row.sku) : null,
    quantity: Number(row.quantity) || 0,
    rate: Number(row.rate) || 0,
    total: Number(row.total) || 0,
    imageUrl: row.imageUrl != null && String(row.imageUrl).trim()
      ? String(row.imageUrl)
      : null,
    hsn: row.hsn != null ? String(row.hsn) : null,
  };
}

function mapDocument(data: Record<string, unknown>): SoShareDocument | null {
  // New HTML shares store `document`; older image shares are ignored.
  const rawDoc = data.document;
  const source = rawDoc && typeof rawDoc === 'object' && !Array.isArray(rawDoc)
    ? rawDoc as Record<string, unknown>
    : null;
  if (!source) return null;

  const lineItems = Array.isArray(source.lineItems)
    ? source.lineItems.map(mapLineItem).filter((row): row is DealerInvoiceLineItem => row !== null)
    : [];

  return {
    salesOrderId: String(source.salesOrderId ?? '').trim(),
    salesOrderNumber: String(source.salesOrderNumber ?? '').trim(),
    dateLabel: String(source.dateLabel ?? '').trim(),
    customerName: String(source.customerName ?? '').trim(),
    shippingAddress: String(source.shippingAddress ?? '').trim(),
    currencyCode: String(source.currencyCode ?? 'INR').trim() || 'INR',
    subtotal: Number(source.subtotal) || 0,
    taxTotal: Number(source.taxTotal) || 0,
    total: Number(source.total) || 0,
    notes: String(source.notes ?? '').trim(),
    lineItems,
  };
}

function mapShareDoc(code: string, data: Record<string, unknown>): SoShareLinkRecord | null {
  const document = mapDocument(data);
  if (!document) return null;
  return {
    code,
    document,
    createdAt: String(data.createdAt ?? '').trim(),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
  };
}

export async function loadSoShareLink(code: string): Promise<SoShareLinkRecord | null> {
  if (!isSoShareCode(code)) return null;
  const snap = await getDoc(doc(db, COLLECTION, code));
  if (!snap.exists()) return null;
  return mapShareDoc(code, snap.data() as Record<string, unknown>);
}

export function subscribeSoShareLink(
  code: string,
  onNext: (share: SoShareLinkRecord | null) => void,
): () => void {
  if (!isSoShareCode(code)) {
    onNext(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, COLLECTION, code),
    snap => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }
      onNext(mapShareDoc(code, snap.data() as Record<string, unknown>));
    },
    () => onNext(null),
  );
}

export function buildSpareInchargeSoShareMessage(options: {
  salesOrderNumber: string;
  dateLabel: string;
  shareUrl: string;
}): string {
  const so = options.salesOrderNumber.trim() || 'Sales order';
  const lines = [
    'Dear Service Manager,',
    '',
    'A new sales order has been placed.',
    '',
    `SO: ${so}`,
  ];
  if (options.dateLabel.trim()) {
    lines.push(`Date: ${options.dateLabel.trim()}`);
  }
  lines.push(
    '',
    '📄 Order Details:',
    options.shareUrl,
    'Regards,',
    'Meezan Electronic Scales Pvt. Ltd.',
  );
  return lines.join('\n');
}

/** Firestore rejects `undefined` — convert to null / omit recursively. */
function forFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(item => forFirestore(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    out[key] = forFirestore(entry);
  }
  return out;
}

export function buildSoShareDocument(input: {
  salesOrderId: string;
  salesOrderNumber: string;
  dateLabel: string;
  customerName?: string | null;
  shippingAddress?: string | null;
  currencyCode?: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes?: string | null;
  lineItems: DealerInvoiceLineItem[];
}): SoShareDocument {
  return {
    salesOrderId: input.salesOrderId,
    salesOrderNumber: input.salesOrderNumber.trim() || 'Sales order',
    dateLabel: input.dateLabel.trim(),
    customerName: String(input.customerName ?? '').trim(),
    shippingAddress: String(input.shippingAddress ?? '').trim(),
    currencyCode: String(input.currencyCode ?? 'INR').trim() || 'INR',
    subtotal: Number(input.subtotal) || 0,
    taxTotal: Number(input.taxTotal) || 0,
    total: Number(input.total) || 0,
    notes: String(input.notes ?? '').trim(),
    lineItems: input.lineItems.map(item => ({
      id: String(item.id ?? ''),
      itemId: item.itemId ?? null,
      name: String(item.name ?? 'Item'),
      description: item.description ?? null,
      sku: item.sku ?? null,
      quantity: Number(item.quantity) || 0,
      rate: Number(item.rate) || 0,
      total: Number(item.total) || 0,
      imageUrl: item.imageUrl ?? null,
      hsn: item.hsn ?? null,
      ...(Array.isArray(item.serialNumbers) ? { serialNumbers: item.serialNumbers } : {}),
    })),
  };
}

/** Create a public HTML share link from in-memory SO data (no screenshot). */
export async function createSoShareLink(document: SoShareDocument): Promise<{
  code: string;
  url: string;
}> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to share a sales order.');

  const code = await allocateShareCode();
  const createdAt = new Date().toISOString();

  await setDoc(doc(db, COLLECTION, code), forFirestore({
    document,
    status: 'ready',
    createdAt,
    createdByUid: uid,
  }) as Record<string, unknown>);

  return {
    code,
    url: soSharePublicUrl(code),
  };
}
