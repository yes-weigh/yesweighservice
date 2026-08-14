import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  SerialNumberAllotment,
  SerialNumberAllotmentDoc,
} from '../types/serial-number-allotment';

export const SERIAL_NUMBER_ALLOTMENT_DOC_ID = 'serialNumberAllotment';

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
  createdAt = new Date().toISOString(),
): SerialNumberAllotment {
  return {
    id: newAllotmentId(),
    from: preview.from,
    to: preview.to,
    missing: preview.missing,
    count: preview.count,
    createdAt,
  };
}

export function totalAllottedCount(allotments: ReadonlyArray<Pick<SerialNumberAllotment, 'count'>>): number {
  return allotments.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
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
    from: preview.from,
    to: preview.to,
    missing: preview.missing,
    count: preview.count,
    createdAt: String(data.createdAt ?? '').trim() || new Date().toISOString(),
  };
}

export function emptySerialNumberAllotmentDoc(): SerialNumberAllotmentDoc {
  return { allotments: [], updatedAt: null, updatedBy: null };
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
  return {
    allotments,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export async function saveSerialNumberAllotments(
  allotments: SerialNumberAllotment[],
  updatedBy?: string | null,
): Promise<SerialNumberAllotmentDoc> {
  const normalized = allotments.flatMap(row => {
    const next = normalizeAllotment(row);
    return next ? [next] : [];
  });
  const payload: SerialNumberAllotmentDoc = {
    allotments: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy?.trim() || null,
  };
  await setDoc(doc(db, 'appSettings', SERIAL_NUMBER_ALLOTMENT_DOC_ID), payload, { merge: true });
  return payload;
}
