import { collectionGroup, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';
import { serialNumbersFromLineItem } from './invoices';
import type {
  SerialNumberAllotment,
  SerialNumberAllotmentDoc,
  SerialSeriesId,
} from '../types/serial-number-allotment';
import { DEFAULT_SERIAL_SERIES, SERIAL_SERIES } from '../types/serial-number-allotment';

const SERIES_IDS = new Set<string>(SERIAL_SERIES.map(row => row.id));

export function normalizeSerialSeries(
  raw: unknown,
  fallback: SerialSeriesId = 'non_gatc',
): SerialSeriesId {
  const value = String(raw ?? '').trim();
  return SERIES_IDS.has(value) ? value as SerialSeriesId : fallback;
}

export const SERIAL_NUMBER_ALLOTMENT_DOC_ID = 'serialNumberAllotment';

const functions = getFunctions(app, 'asia-south1');

type ParsedSerial = {
  prefix: string;
  n: number;
  width: number;
};

export type SerialRangePreview = {
  from: string;
  to: string;
  missing: string[];
  rangeSize: number;
  missingCount: number;
  count: number;
  ignoredMissing: string[];
  error: string | null;
};

function padNumeric(n: number, width: number): string {
  const raw = String(n);
  return width > raw.length ? raw.padStart(width, '0') : raw;
}

export function parseSerialToken(raw: string): ParsedSerial | null {
  const token = String(raw ?? '').trim();
  if (!token) return null;
  const match = /^(.*?)(\d+)$/.exec(token);
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return {
    prefix: match[1],
    n,
    width: match[2].length,
  };
}

function formatSerial(parsed: ParsedSerial, n: number): string {
  return `${parsed.prefix}${padNumeric(n, parsed.width)}`;
}

function splitMissingTokens(raw: string): string[] {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function expandMissingToken(token: string): string[] {
  const dash = token.indexOf('-', 1);
  if (dash <= 0) return [token];
  const left = parseSerialToken(token.slice(0, dash));
  const right = parseSerialToken(token.slice(dash + 1));
  if (!left || !right) return [token];
  if (left.prefix !== right.prefix) return [token];
  const start = Math.min(left.n, right.n);
  const end = Math.max(left.n, right.n);
  const size = end - start + 1;
  if (size > 500) return [token];
  const width = Math.max(left.width, right.width);
  const out: string[] = [];
  for (let n = start; n <= end; n += 1) {
    out.push(`${left.prefix}${padNumeric(n, width)}`);
  }
  return out;
}

export function previewSerialRange(input: {
  from: string;
  to: string;
  missingText: string;
}): SerialRangePreview {
  const fromRaw = String(input.from ?? '').trim();
  const toRaw = String(input.to ?? '').trim();
  const empty: SerialRangePreview = {
    from: fromRaw,
    to: toRaw,
    missing: [],
    rangeSize: 0,
    missingCount: 0,
    count: 0,
    ignoredMissing: [],
    error: null,
  };

  if (!fromRaw && !toRaw && !String(input.missingText ?? '').trim()) {
    return empty;
  }
  if (!fromRaw || !toRaw) {
    return { ...empty, error: 'Enter both From and To.' };
  }

  const from = parseSerialToken(fromRaw);
  const to = parseSerialToken(toRaw);
  if (!from || !to) {
    return { ...empty, error: 'From and To must end in a number (e.g. 2408001 or YW2408001).' };
  }
  if (from.prefix !== to.prefix) {
    return { ...empty, error: 'From and To must share the same prefix.' };
  }
  if (from.n > to.n) {
    return { ...empty, error: 'From must be less than or equal to To.' };
  }

  const rangeSize = to.n - from.n + 1;
  if (rangeSize > 1_000_000) {
    return { ...empty, error: 'Range is too large. Split it into smaller allotments.' };
  }

  const width = Math.max(from.width, to.width);
  const canonical = { ...from, width };
  const inRange = new Set<string>();
  const ignoredMissing: string[] = [];

  for (const token of splitMissingTokens(input.missingText)) {
    for (const piece of expandMissingToken(token)) {
      const parsed = parseSerialToken(piece);
      if (!parsed) {
        ignoredMissing.push(piece);
        continue;
      }
      if (parsed.prefix && parsed.prefix !== from.prefix) {
        ignoredMissing.push(piece);
        continue;
      }
      if (parsed.n < from.n || parsed.n > to.n) {
        ignoredMissing.push(piece);
        continue;
      }
      inRange.add(formatSerial(canonical, parsed.n));
    }
  }

  const missing = [...inRange].sort((a, b) => {
    const an = parseSerialToken(a)?.n ?? 0;
    const bn = parseSerialToken(b)?.n ?? 0;
    return an - bn;
  });

  return {
    from: formatSerial(canonical, from.n),
    to: formatSerial(canonical, to.n),
    missing,
    rangeSize,
    missingCount: missing.length,
    count: rangeSize - missing.length,
    ignoredMissing,
    error: null,
  };
}

export function newAllotmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function allotmentFromPreview(
  preview: SerialRangePreview,
  series: SerialSeriesId = DEFAULT_SERIAL_SERIES,
  createdBy: string | null = null,
  createdAt = new Date().toISOString(),
): SerialNumberAllotment {
  return {
    id: newAllotmentId(),
    series: normalizeSerialSeries(series),
    from: preview.from,
    to: preview.to,
    missing: preview.missing,
    count: preview.count,
    createdAt,
    createdBy: createdBy?.trim() || null,
    pushedAt: null,
    pushError: null,
  };
}

export function totalAllottedCount(allotments: ReadonlyArray<Pick<SerialNumberAllotment, 'count'>>): number {
  return allotments.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
}

export function compactSerialKey(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function countLinkedUnused(
  input: Pick<SerialNumberAllotment, 'from' | 'to' | 'missing' | 'count'>,
  invoicedKeys: ReadonlySet<string>,
): { linked: number; unused: number } {
  const qty = Math.max(0, Number(input.count) || 0);
  if (!qty || invoicedKeys.size === 0) {
    return { linked: 0, unused: qty };
  }
  const from = parseSerialToken(input.from);
  const to = parseSerialToken(input.to);
  if (!from || !to || from.prefix !== to.prefix) {
    return { linked: 0, unused: qty };
  }
  const missing = new Set(input.missing.map(compactSerialKey));
  let linked = 0;
  for (const key of invoicedKeys) {
    const parsed = parseSerialToken(key);
    if (!parsed || parsed.prefix !== from.prefix) continue;
    if (parsed.n < from.n || parsed.n > to.n) continue;
    if (missing.has(key) || missing.has(compactSerialKey(formatSerial({ ...from, width: Math.max(from.width, to.width) }, parsed.n)))) {
      continue;
    }
    linked += 1;
  }
  if (linked > qty) linked = qty;
  return { linked, unused: qty - linked };
}

const INVOICED_SERIAL_CACHE_KEY = 'yesweigh.invoicedSerialKeys.v1';

function pushSerialKey(into: Set<string>, raw: unknown): void {
  const key = compactSerialKey(String(raw ?? ''));
  if (key) into.add(key);
}

export async function loadInvoicedSerialKeys(): Promise<Set<string>> {
  try {
    const cached = sessionStorage.getItem(INVOICED_SERIAL_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(value => compactSerialKey(String(value))).filter(Boolean));
      }
    }
  } catch {
    // Ignore a stale or private-mode cache.
  }

  const keys = new Set<string>();
  const snap = await getDocs(collectionGroup(db, 'invoices'));
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    if (Array.isArray(data.serialNumbers)) {
      for (const value of data.serialNumbers) pushSerialKey(keys, value);
    }
    if (!Array.isArray(data.lineItems)) continue;
    for (const raw of data.lineItems) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { description?: string | null; serialNumbers?: string[] };
      for (const serial of serialNumbersFromLineItem({
        description: item.description ?? null,
        serialNumbers: item.serialNumbers,
      })) {
        pushSerialKey(keys, serial);
      }
    }
  }

  try {
    sessionStorage.setItem(INVOICED_SERIAL_CACHE_KEY, JSON.stringify([...keys]));
  } catch {
    // Quota or private mode — still return the live set.
  }
  return keys;
}

function normalizeAllotment(raw: unknown): SerialNumberAllotment | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const from = String(data.from ?? '').trim();
  const to = String(data.to ?? '').trim();
  if (!from || !to) return null;
  const preview = previewSerialRange({
    from,
    to,
    missingText: Array.isArray(data.missing) ? data.missing.map(v => String(v)).join(',') : String(data.missing ?? ''),
  });
  if (preview.error) return null;
  return {
    id: String(data.id || '').trim() || newAllotmentId(),
    series: normalizeSerialSeries(data.series),
    from: preview.from,
    to: preview.to,
    missing: preview.missing,
    count: preview.count,
    createdAt: String(data.createdAt ?? '').trim() || new Date().toISOString(),
    createdBy: String(data.createdBy ?? '').trim() || null,
    pushedAt: String(data.pushedAt ?? '').trim() || null,
    pushError: String(data.pushError ?? '').trim() || null,
  };
}

export function emptySerialNumberAllotmentDoc(): SerialNumberAllotmentDoc {
  return { allotments: [], webhookUrl: null, updatedAt: null, updatedBy: null };
}

export function pendingSerialAllotmentCount(
  allotments: ReadonlyArray<Pick<SerialNumberAllotment, 'pushedAt'>>,
): number {
  return allotments.filter(row => !row.pushedAt).length;
}

export function normalizeSerialWebhookUrl(raw: string): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('Enter a valid webhook URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https.');
  }
  return parsed.toString();
}

export async function loadSerialNumberAllotments(): Promise<SerialNumberAllotmentDoc> {
  const snap = await getDoc(doc(db, 'appSettings', SERIAL_NUMBER_ALLOTMENT_DOC_ID));
  if (!snap.exists()) return emptySerialNumberAllotmentDoc();
  const data = snap.data() as Record<string, unknown>;
  const allotments = Array.isArray(data.allotments)
    ? data.allotments.flatMap(row => {
      const next = normalizeAllotment(row);
      return next ? [next] : [];
    })
    : [];
  const webhookUrl = typeof data.webhookUrl === 'string' ? data.webhookUrl.trim() : '';
  return {
    allotments,
    webhookUrl: webhookUrl || null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

function mergePushStatus(
  next: SerialNumberAllotment[],
  existing: SerialNumberAllotment[],
): SerialNumberAllotment[] {
  const prevById = new Map(existing.map(row => [row.id, row]));
  return next.map(row => {
    const prev = prevById.get(row.id);
    if (!row.pushedAt && prev?.pushedAt) {
      return { ...row, pushedAt: prev.pushedAt, pushError: prev.pushError };
    }
    return row;
  });
}

export async function saveSerialNumberAllotments(
  allotments: SerialNumberAllotment[],
  updatedBy?: string | null,
): Promise<SerialNumberAllotmentDoc> {
  const ref = doc(db, 'appSettings', SERIAL_NUMBER_ALLOTMENT_DOC_ID);
  const current = await loadSerialNumberAllotments();
  const normalized = mergePushStatus(
    allotments.flatMap(row => {
      const next = normalizeAllotment(row);
      return next ? [next] : [];
    }),
    current.allotments,
  );
  const payload: SerialNumberAllotmentDoc = {
    allotments: normalized,
    webhookUrl: current.webhookUrl,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy?.trim() || null,
  };
  await setDoc(ref, payload, { merge: true });
  return payload;
}

export async function saveSerialAllotmentWebhookUrl(
  webhookUrl: string,
  updatedBy?: string | null,
): Promise<string> {
  const value = normalizeSerialWebhookUrl(webhookUrl);
  await setDoc(doc(db, 'appSettings', SERIAL_NUMBER_ALLOTMENT_DOC_ID), {
    webhookUrl: value || null,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy?.trim() || null,
  }, { merge: true });
  return value;
}

export type PushSerialAllotmentsResult = {
  ok: boolean;
  test: boolean;
  sent: number;
  pending: number;
  webhookUrl: string;
};

export async function pushSerialAllotmentsToYesGatc(input: {
  mode: 'test' | 'ids';
  ids?: string[];
  webhookUrl?: string;
  actorName: string;
}): Promise<PushSerialAllotmentsResult> {
  const fn = httpsCallable<typeof input, PushSerialAllotmentsResult>(
    functions,
    'pushSerialAllotmentsToYesGatcFn',
    { timeout: 60_000 },
  );
  return (await fn(input)).data;
}
