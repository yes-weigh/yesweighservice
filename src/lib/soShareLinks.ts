import { doc, getDoc, setDoc } from 'firebase/firestore';
import { PUBLIC_APP_ORIGIN } from '../constants/brand';
import { auth, db } from '../firebase';
import { uploadWhatsAppShareCard } from './whatsappShareCard';

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

export type SoShareLinkRecord = {
  code: string;
  imageUrl: string;
  salesOrderId: string;
  salesOrderNumber: string;
  dateLabel: string;
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

export async function loadSoShareLink(code: string): Promise<SoShareLinkRecord | null> {
  if (!isSoShareCode(code)) return null;
  const snap = await getDoc(doc(db, COLLECTION, code));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  const imageUrl = String(data.imageUrl ?? '').trim();
  if (!imageUrl) return null;
  return {
    code,
    imageUrl,
    salesOrderId: String(data.salesOrderId ?? '').trim(),
    salesOrderNumber: String(data.salesOrderNumber ?? '').trim(),
    dateLabel: String(data.dateLabel ?? '').trim(),
    createdAt: String(data.createdAt ?? '').trim(),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
  };
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

/** Upload SO screenshot and create a public 6-letter share link. */
export async function createSoShareLink(options: {
  imageBlob: Blob;
  fileName: string;
  salesOrderId: string;
  salesOrderNumber: string;
  dateLabel: string;
}): Promise<{ code: string; url: string; imageUrl: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to share a sales order.');

  const imageUrl = await uploadWhatsAppShareCard(options.imageBlob, options.fileName);
  const code = await allocateShareCode();
  const createdAt = new Date().toISOString();

  await setDoc(doc(db, COLLECTION, code), {
    imageUrl,
    salesOrderId: options.salesOrderId,
    salesOrderNumber: options.salesOrderNumber,
    dateLabel: options.dateLabel,
    createdAt,
    createdByUid: uid,
  });

  return {
    code,
    url: soSharePublicUrl(code),
    imageUrl,
  };
}
