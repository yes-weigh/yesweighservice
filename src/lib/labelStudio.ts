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

/** Fixed printer slots — only `host` (IP) is user-configurable. */
export const HARDCODED_LABEL_PRINTERS: ReadonlyArray<Omit<LabelPrinter, 'host'>> = [
  {
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    port: DEFAULT_LABEL_PRINTER_PORT,
  },
];

export interface LabelStudioDoc {
  printers: LabelPrinter[];
  /** Default printer for bin / store-room labels. */
  storeLabelPrinterId: string;
  updatedAt: string;
  updatedBy?: string | null;
}

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function hostByPrinterId(rawPrinters: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rawPrinters)) return map;
  for (const raw of rawPrinters) {
    if (!raw || typeof raw !== 'object') continue;
    const data = raw as Record<string, unknown>;
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    if (!id) continue;
    const host = normalizeHost(data.host);
    if (host) map.set(id, host);
  }
  return map;
}

/** Build the fixed printer list, applying saved IPs where present. */
export function buildHardcodedPrinters(
  savedHosts?: Map<string, string> | Record<string, string>,
): LabelPrinter[] {
  const hosts = savedHosts instanceof Map
    ? savedHosts
    : new Map(Object.entries(savedHosts ?? {}));
  return HARDCODED_LABEL_PRINTERS.map((slot, index) => ({
    id: slot.id,
    name: slot.name,
    port: slot.port,
    host: hosts.get(slot.id)
      ?? (index === 0 && !hosts.size ? DEFAULT_LABEL_PRINTER_HOST : ''),
  }));
}

export function emptyLabelPrinter(overrides?: Partial<LabelPrinter>): LabelPrinter {
  const slot = HARDCODED_LABEL_PRINTERS.find(p => p.id === overrides?.id)
    ?? HARDCODED_LABEL_PRINTERS[0];
  return {
    id: overrides?.id ?? slot.id,
    name: overrides?.name ?? slot.name,
    host: overrides?.host ?? '',
    port: overrides?.port ?? slot.port,
  };
}

export function emptyStoreLabelPrinter(): LabelPrinter {
  return {
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    host: DEFAULT_LABEL_PRINTER_HOST,
    port: DEFAULT_LABEL_PRINTER_PORT,
  };
}

export function emptyLabelStudioDoc(): LabelStudioDoc {
  const printers = buildHardcodedPrinters();
  return {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    updatedAt: '',
  };
}

function normalizeStudioPayload(data: Record<string, unknown>): LabelStudioDoc | null {
  const hosts = hostByPrinterId(data.printers);
  // Legacy single-host docs.
  if (!hosts.size && typeof data.host === 'string') {
    hosts.set(STORE_LABEL_PRINTER_ID, normalizeHost(data.host) || DEFAULT_LABEL_PRINTER_HOST);
  }
  if (!hosts.size && !Array.isArray(data.printers) && typeof data.host !== 'string') {
    return null;
  }
  const printers = buildHardcodedPrinters(hosts);
  return {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

function migrateFromLegacyPrintersDoc(data: Record<string, unknown>): LabelStudioDoc {
  const hosts = hostByPrinterId(data.printers);
  if (!hosts.size && (typeof data.host === 'string' || typeof data.port !== 'undefined')) {
    hosts.set(STORE_LABEL_PRINTER_ID, normalizeHost(data.host) || DEFAULT_LABEL_PRINTER_HOST);
  }
  return {
    printers: buildHardcodedPrinters(hosts),
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export function getStoreLabelPrinter(docData: LabelStudioDoc): LabelPrinter {
  const byId = docData.printers.find(p => p.id === STORE_LABEL_PRINTER_ID);
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
  const slot = HARDCODED_LABEL_PRINTERS.find(p => p.id === printer.id);
  if (!slot) return `Unknown printer: ${printer.id}`;
  const hostError = validatePrinterHost(printer.host);
  if (hostError) return `${slot.name}: ${hostError}`;
  return null;
}

export function validateLabelStudioDoc(input: {
  printers: LabelPrinter[];
  storeLabelPrinterId?: string;
}): string | null {
  const byId = new Map(input.printers.map(p => [p.id, p]));
  for (const slot of HARDCODED_LABEL_PRINTERS) {
    const printer = byId.get(slot.id);
    if (!printer) return `Missing printer: ${slot.name}`;
    const err = validateLabelPrinter({
      ...printer,
      id: slot.id,
      name: slot.name,
      port: slot.port,
    });
    if (err) return err;
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
    storeLabelPrinterId?: string;
  },
  updatedBy?: string | null,
): Promise<LabelStudioDoc> {
  const hosts = new Map(input.printers.map(p => [p.id, normalizeHost(p.host)]));
  const printers = buildHardcodedPrinters(hosts);
  const err = validateLabelStudioDoc({ printers });
  if (err) throw new Error(err);

  const updatedAt = new Date().toISOString();
  const payload: LabelStudioDoc = {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(doc(db, 'appSettings', LABEL_STUDIO_DOC_ID), payload, { merge: false });
  return payload;
}
