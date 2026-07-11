import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_LABEL_PRINTER_HOST,
  DEFAULT_LABEL_PRINTER_PORT,
  LABEL_STUDIO_DOC_ID,
  LOCAL_PRINTER_SETTINGS_DOC_ID,
} from '../constants/localPrinterSettings';

export const STORE_LABEL_PRINTER_ID = 'store-label';

/** Slim LAN printer — layout is chosen by print context, not stored here. */
export interface LabelPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface LabelStudioDoc {
  printers: LabelPrinter[];
  /** Default printer for bin / store-room labels. */
  storeLabelPrinterId: string;
  updatedAt: string;
  updatedBy?: string | null;
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizePort(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_LABEL_PRINTER_PORT;
  return n;
}

export function emptyLabelPrinter(overrides?: Partial<LabelPrinter>): LabelPrinter {
  return {
    id: overrides?.id ?? newId('printer'),
    name: overrides?.name ?? 'Label printer',
    host: overrides?.host ?? '',
    port: overrides?.port ?? DEFAULT_LABEL_PRINTER_PORT,
  };
}

export function emptyStoreLabelPrinter(): LabelPrinter {
  return emptyLabelPrinter({
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    host: DEFAULT_LABEL_PRINTER_HOST,
  });
}

export function emptyLabelStudioDoc(): LabelStudioDoc {
  const printer = emptyStoreLabelPrinter();
  return {
    printers: [printer],
    storeLabelPrinterId: printer.id,
    updatedAt: '',
  };
}

function normalizePrinter(raw: unknown, fallback: LabelPrinter): LabelPrinter | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : fallback.id;
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : fallback.name,
    host: normalizeHost(data.host) || fallback.host,
    port: normalizePort(data.port),
  };
}

function normalizeStudioPayload(data: Record<string, unknown>): LabelStudioDoc | null {
  if (!Array.isArray(data.printers) || data.printers.length === 0) return null;

  const defaults = emptyLabelStudioDoc();
  const printers = data.printers
    .map((raw, i) => normalizePrinter(raw, defaults.printers[Math.min(i, defaults.printers.length - 1)]
      ?? emptyStoreLabelPrinter()))
    .filter((p): p is LabelPrinter => p != null);
  if (!printers.length) return null;

  let storeLabelPrinterId =
    typeof data.storeLabelPrinterId === 'string' && data.storeLabelPrinterId.trim()
      ? data.storeLabelPrinterId.trim()
      : printers[0].id;

  // Migrate old Labels model: first label's printer becomes store label.
  if (
    !printers.some(p => p.id === storeLabelPrinterId)
    && Array.isArray(data.labels)
    && data.labels[0]
    && typeof data.labels[0] === 'object'
  ) {
    const firstLabel = data.labels[0] as Record<string, unknown>;
    if (typeof firstLabel.printerId === 'string' && printers.some(p => p.id === firstLabel.printerId)) {
      storeLabelPrinterId = firstLabel.printerId;
    }
  }

  if (!printers.some(p => p.id === storeLabelPrinterId)) {
    storeLabelPrinterId = printers[0].id;
  }

  return {
    printers,
    storeLabelPrinterId,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

function migrateFromLegacyPrintersDoc(data: Record<string, unknown>): LabelStudioDoc {
  const fallbackPrinter = emptyStoreLabelPrinter();
  let printers: LabelPrinter[] = [];

  if (Array.isArray(data.printers) && data.printers.length > 0) {
    printers = data.printers
      .map((raw, index) => normalizePrinter(raw, {
        ...fallbackPrinter,
        id: index === 0 ? STORE_LABEL_PRINTER_ID : `printer-${index}`,
        name: index === 0 ? 'Store label printer' : `Label printer ${index + 1}`,
      }))
      .filter((p): p is LabelPrinter => p != null);
  } else if (typeof data.host === 'string' || typeof data.port !== 'undefined') {
    printers = [{
      id: STORE_LABEL_PRINTER_ID,
      name: typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : 'Store label printer',
      host: normalizeHost(data.host) || DEFAULT_LABEL_PRINTER_HOST,
      port: normalizePort(data.port),
    }];
  }

  if (!printers.length) printers = [fallbackPrinter];

  let storeLabelPrinterId =
    typeof data.storeLabelPrinterId === 'string' && data.storeLabelPrinterId.trim()
      ? data.storeLabelPrinterId.trim()
      : printers[0].id;
  if (!printers.some(p => p.id === storeLabelPrinterId)) {
    storeLabelPrinterId = printers[0].id;
  }

  return {
    printers,
    storeLabelPrinterId,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export function getStoreLabelPrinter(docData: LabelStudioDoc): LabelPrinter {
  const byId = docData.printers.find(p => p.id === docData.storeLabelPrinterId);
  if (byId) return byId;
  if (docData.printers[0]) return docData.printers[0];
  return emptyStoreLabelPrinter();
}

export function getPrinterById(docData: LabelStudioDoc, printerId: string): LabelPrinter | null {
  return docData.printers.find(p => p.id === printerId) ?? null;
}

export function validatePrinterHost(host: string): string | null {
  const trimmed = host.trim();
  if (!trimmed) return 'Enter the printer IP address.';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    const parts = trimmed.split('.').map(Number);
    if (parts.some(p => p > 255)) return 'IP address octets must be 0–255.';
    return null;
  }
  if (/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(trimmed) && trimmed.length <= 253) {
    return null;
  }
  return 'Enter a valid IPv4 address or hostname.';
}

export function validateLabelPrinter(printer: LabelPrinter): string | null {
  const name = printer.name.trim();
  if (!name) return 'Each printer needs a name.';
  const hostError = validatePrinterHost(printer.host);
  if (hostError) return `${name}: ${hostError}`;
  if (!(Number.isInteger(printer.port) && printer.port >= 1 && printer.port <= 65535)) {
    return `${name}: Port must be a whole number between 1 and 65535.`;
  }
  return null;
}

export function validateLabelStudioDoc(input: {
  printers: LabelPrinter[];
  storeLabelPrinterId: string;
}): string | null {
  if (!input.printers.length) return 'Add at least one printer.';

  const printerIds = new Set<string>();
  for (const p of input.printers) {
    if (printerIds.has(p.id)) return `Duplicate printer id: ${p.id}`;
    printerIds.add(p.id);
    const err = validateLabelPrinter(p);
    if (err) return err;
  }

  if (!printerIds.has(input.storeLabelPrinterId.trim())) {
    return 'Pick a store label printer.';
  }

  return null;
}

export async function loadLabelStudioDoc(): Promise<LabelStudioDoc> {
  const defaults = emptyLabelStudioDoc();
  try {
    const studioSnap = await getDoc(doc(db, 'appSettings', LABEL_STUDIO_DOC_ID));
    if (studioSnap.exists()) {
      const normalized = normalizeStudioPayload(studioSnap.data() as Record<string, unknown>);
      if (normalized) return normalized;
    }

    const legacySnap = await getDoc(doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID));
    if (legacySnap.exists()) {
      return migrateFromLegacyPrintersDoc(legacySnap.data() as Record<string, unknown>);
    }

    return defaults;
  } catch {
    return defaults;
  }
}

export async function saveLabelStudioDoc(
  input: {
    printers: LabelPrinter[];
    storeLabelPrinterId: string;
  },
  updatedBy?: string | null,
): Promise<LabelStudioDoc> {
  const err = validateLabelStudioDoc(input);
  if (err) throw new Error(err);

  const printers = input.printers.map(p => ({
    id: p.id.trim() || newId('printer'),
    name: p.name.trim() || 'Label printer',
    host: p.host.trim(),
    port: p.port,
  }));

  let storeLabelPrinterId = input.storeLabelPrinterId.trim();
  if (!printers.some(p => p.id === storeLabelPrinterId)) {
    storeLabelPrinterId = printers[0].id;
  }

  const updatedAt = new Date().toISOString();
  const payload: LabelStudioDoc = {
    printers,
    storeLabelPrinterId,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(doc(db, 'appSettings', LABEL_STUDIO_DOC_ID), payload, { merge: false });
  return payload;
}
