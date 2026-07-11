import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_PRINTER_HOST,
  DEFAULT_LABEL_PRINTER_PORT,
  DEFAULT_LABEL_WIDTH_MM,
  LOCAL_PRINTER_SETTINGS_DOC_ID,
} from '../constants/localPrinterSettings';

export const STORE_LABEL_PRINTER_ID = 'store-label';

export interface LocalPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  /** Label width in mm (TSPL SIZE). */
  labelWidthMm: number;
  /** Label height in mm (TSPL SIZE). */
  labelHeightMm: number;
  /** Gap between labels in mm (TSPL GAP). Use 0 if sensor already calibrated. */
  labelGapMm: number;
}

/** @deprecated Use LocalPrinter — kept for callers that expect the flat store-label shape. */
export interface LocalPrinterSettings extends Omit<LocalPrinter, 'id'> {
  updatedAt: string;
  updatedBy?: string | null;
}

export type LocalPrinterSettingsInput = Omit<LocalPrinter, 'id'>;

export interface LocalPrintersDoc {
  printers: LocalPrinter[];
  storeLabelPrinterId: string;
  updatedAt: string;
  updatedBy?: string | null;
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

function normalizeMm(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

/** Migrate older inch-based settings if present. */
function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4 * 100) / 100;
}

function newPrinterId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `printer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyLocalPrinter(overrides?: Partial<LocalPrinter>): LocalPrinter {
  return {
    id: overrides?.id ?? newPrinterId(),
    name: overrides?.name ?? 'Label printer',
    host: overrides?.host ?? '',
    port: overrides?.port ?? DEFAULT_LABEL_PRINTER_PORT,
    labelWidthMm: overrides?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: overrides?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: overrides?.labelGapMm ?? DEFAULT_LABEL_GAP_MM,
  };
}

export function emptyStoreLabelPrinter(): LocalPrinter {
  return emptyLocalPrinter({
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    host: DEFAULT_LABEL_PRINTER_HOST,
  });
}

export function emptyLocalPrintersDoc(): LocalPrintersDoc {
  const store = emptyStoreLabelPrinter();
  return {
    printers: [store],
    storeLabelPrinterId: store.id,
    updatedAt: '',
  };
}

/** @deprecated Prefer emptyStoreLabelPrinter / emptyLocalPrintersDoc. */
export function emptyLocalPrinterSettings(): LocalPrinterSettings {
  const store = emptyStoreLabelPrinter();
  return {
    host: store.host,
    port: store.port,
    name: store.name,
    labelWidthMm: store.labelWidthMm,
    labelHeightMm: store.labelHeightMm,
    labelGapMm: store.labelGapMm,
    updatedAt: '',
  };
}

function readMmFields(data: Record<string, unknown>, defaults: LocalPrinter): {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
} {
  let labelWidthMm = defaults.labelWidthMm;
  let labelHeightMm = defaults.labelHeightMm;
  let labelGapMm = defaults.labelGapMm;

  if (typeof data.labelWidthMm === 'number' || typeof data.labelWidthMm === 'string') {
    labelWidthMm = normalizeMm(data.labelWidthMm, defaults.labelWidthMm);
  } else if (typeof data.labelWidthIn === 'number' || typeof data.labelWidthIn === 'string') {
    labelWidthMm = inchesToMm(Number(data.labelWidthIn));
  }

  if (typeof data.labelHeightMm === 'number' || typeof data.labelHeightMm === 'string') {
    labelHeightMm = normalizeMm(data.labelHeightMm, defaults.labelHeightMm);
  } else if (typeof data.labelHeightIn === 'number' || typeof data.labelHeightIn === 'string') {
    labelHeightMm = inchesToMm(Number(data.labelHeightIn));
  }

  if (typeof data.labelGapMm === 'number' || typeof data.labelGapMm === 'string') {
    labelGapMm = normalizeMm(data.labelGapMm, defaults.labelGapMm);
  } else if (typeof data.labelGapIn === 'number' || typeof data.labelGapIn === 'string') {
    labelGapMm = inchesToMm(Number(data.labelGapIn));
  }

  return { labelWidthMm, labelHeightMm, labelGapMm };
}

function normalizePrinter(raw: unknown, fallback: LocalPrinter): LocalPrinter | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : fallback.id;
  const mm = readMmFields(data, fallback);
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : fallback.name,
    host: normalizeHost(data.host) || fallback.host,
    port: normalizePort(data.port),
    ...mm,
  };
}

function migrateLegacyFlatDoc(data: Record<string, unknown>): LocalPrintersDoc {
  const defaults = emptyStoreLabelPrinter();
  const mm = readMmFields(data, defaults);
  const printer: LocalPrinter = {
    id: STORE_LABEL_PRINTER_ID,
    name: typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : 'Store label printer',
    host: normalizeHost(data.host) || defaults.host,
    port: normalizePort(data.port),
    ...mm,
  };
  return {
    printers: [printer],
    storeLabelPrinterId: printer.id,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export function getStoreLabelPrinter(docData: LocalPrintersDoc): LocalPrinter {
  const byId = docData.printers.find(p => p.id === docData.storeLabelPrinterId);
  if (byId) return byId;
  if (docData.printers[0]) return docData.printers[0];
  return emptyStoreLabelPrinter();
}

export function printerToSettings(
  printer: LocalPrinter,
  meta?: { updatedAt?: string; updatedBy?: string | null },
): LocalPrinterSettings {
  return {
    host: printer.host,
    port: printer.port,
    name: printer.name,
    labelWidthMm: printer.labelWidthMm,
    labelHeightMm: printer.labelHeightMm,
    labelGapMm: printer.labelGapMm,
    updatedAt: meta?.updatedAt ?? '',
    updatedBy: meta?.updatedBy ?? null,
  };
}

export async function loadLocalPrintersDoc(): Promise<LocalPrintersDoc> {
  const defaults = emptyLocalPrintersDoc();
  try {
    const snap = await getDoc(doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID));
    if (!snap.exists()) return defaults;
    const data = snap.data() as Record<string, unknown>;

    if (Array.isArray(data.printers) && data.printers.length > 0) {
      const fallback = emptyStoreLabelPrinter();
      const printers = data.printers
        .map((raw, index) => normalizePrinter(raw, {
          ...fallback,
          id: index === 0 ? STORE_LABEL_PRINTER_ID : `printer-${index}`,
          name: index === 0 ? 'Store label printer' : `Label printer ${index + 1}`,
        }))
        .filter((p): p is LocalPrinter => p != null);

      if (printers.length === 0) return defaults;

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

    // Legacy single-printer document
    if (typeof data.host === 'string' || typeof data.port !== 'undefined') {
      return migrateLegacyFlatDoc(data);
    }

    return defaults;
  } catch {
    return defaults;
  }
}

/** Loads the designated store-label printer (legacy-compatible flat shape). */
export async function loadLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  const docData = await loadLocalPrintersDoc();
  return printerToSettings(getStoreLabelPrinter(docData), {
    updatedAt: docData.updatedAt,
    updatedBy: docData.updatedBy,
  });
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

export function validateLabelDimensions(input: {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
}): string | null {
  if (!Number.isFinite(input.labelWidthMm) || input.labelWidthMm <= 0 || input.labelWidthMm > 120) {
    return 'Label width must be between 0 and 120 mm.';
  }
  if (!Number.isFinite(input.labelHeightMm) || input.labelHeightMm <= 0 || input.labelHeightMm > 500) {
    return 'Label height must be greater than 0 mm.';
  }
  if (!Number.isFinite(input.labelGapMm) || input.labelGapMm < 0 || input.labelGapMm > 25) {
    return 'Label gap must be between 0 and 25 mm (0 is allowed).';
  }
  return null;
}

export function validateLocalPrinter(printer: LocalPrinter): string | null {
  const name = printer.name.trim();
  if (!name) return 'Each printer needs a name.';
  const hostError = validatePrinterHost(printer.host);
  if (hostError) return `${name}: ${hostError}`;
  if (!(Number.isInteger(printer.port) && printer.port >= 1 && printer.port <= 65535)) {
    return `${name}: Port must be a whole number between 1 and 65535.`;
  }
  const dimError = validateLabelDimensions(printer);
  if (dimError) return `${name}: ${dimError}`;
  return null;
}

export async function saveLocalPrintersDoc(
  input: {
    printers: LocalPrinter[];
    storeLabelPrinterId: string;
  },
  updatedBy?: string | null,
): Promise<LocalPrintersDoc> {
  if (!input.printers.length) {
    throw new Error('Add at least one local printer.');
  }

  const printers: LocalPrinter[] = [];
  const seenIds = new Set<string>();
  for (const raw of input.printers) {
    const printer: LocalPrinter = {
      id: raw.id.trim() || newPrinterId(),
      name: raw.name.trim() || 'Label printer',
      host: raw.host.trim(),
      port: raw.port,
      labelWidthMm: normalizeMm(raw.labelWidthMm, DEFAULT_LABEL_WIDTH_MM),
      labelHeightMm: normalizeMm(raw.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM),
      labelGapMm: normalizeMm(raw.labelGapMm, 0),
    };
    if (seenIds.has(printer.id)) {
      throw new Error(`Duplicate printer id: ${printer.id}`);
    }
    seenIds.add(printer.id);
    const err = validateLocalPrinter(printer);
    if (err) throw new Error(err);
    printers.push(printer);
  }

  let storeLabelPrinterId = input.storeLabelPrinterId.trim();
  if (!printers.some(p => p.id === storeLabelPrinterId)) {
    storeLabelPrinterId = printers[0].id;
  }

  const updatedAt = new Date().toISOString();
  const payload: LocalPrintersDoc = {
    printers,
    storeLabelPrinterId,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(
    doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID),
    payload,
    { merge: false },
  );

  return payload;
}

/** @deprecated Prefer saveLocalPrintersDoc — updates only the store-label printer entry. */
export async function saveLocalPrinterSettings(
  input: LocalPrinterSettingsInput,
  updatedBy?: string | null,
): Promise<LocalPrinterSettings> {
  const existing = await loadLocalPrintersDoc();
  const storeId = existing.storeLabelPrinterId;
  const nextPrinters = existing.printers.map(p =>
    p.id === storeId
      ? {
          ...p,
          name: input.name.trim() || 'Store label printer',
          host: input.host.trim(),
          port: input.port,
          labelWidthMm: normalizeMm(input.labelWidthMm, DEFAULT_LABEL_WIDTH_MM),
          labelHeightMm: normalizeMm(input.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM),
          labelGapMm: normalizeMm(input.labelGapMm, 0),
        }
      : p,
  );

  if (!nextPrinters.some(p => p.id === storeId)) {
    nextPrinters.unshift({
      id: STORE_LABEL_PRINTER_ID,
      name: input.name.trim() || 'Store label printer',
      host: input.host.trim(),
      port: input.port,
      labelWidthMm: normalizeMm(input.labelWidthMm, DEFAULT_LABEL_WIDTH_MM),
      labelHeightMm: normalizeMm(input.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM),
      labelGapMm: normalizeMm(input.labelGapMm, 0),
    });
  }

  const saved = await saveLocalPrintersDoc(
    {
      printers: nextPrinters,
      storeLabelPrinterId: nextPrinters.some(p => p.id === storeId)
        ? storeId
        : nextPrinters[0].id,
    },
    updatedBy,
  );

  return printerToSettings(getStoreLabelPrinter(saved), {
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  });
}
