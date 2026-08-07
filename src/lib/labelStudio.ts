import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_LABEL_PRINTER_HOST,
  DEFAULT_LABEL_PRINTER_PORT,
  LABEL_STUDIO_DOC_ID,
  LOCAL_PRINTER_SETTINGS_DOC_ID,
  LOGISTICS_LABEL_GAP_MM,
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
  STORE_LABEL_GAP_MM,
  STORE_LABEL_HEIGHT_MM,
  STORE_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';

export const STORE_LABEL_PRINTER_ID = 'store-label';
export const LOGISTICS_LABEL_PRINTER_ID = 'logistics-label';

/** Hardcoded print jobs — printer + stock size are fixed per usage. */
export type LabelPrintUsage =
  | 'catalog_bin'
  | 'catalog_item'
  | 'logistics_shipping'
  | 'logistics_courier';

export interface LabelMediaSize {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
}

/** Slim LAN printer — layout is chosen by print context, not stored here. */
export interface LabelPrinter {
  id: string;
  name: string;
  /**
   * Primary IP (first of `hosts`) — kept for older readers / single-IP UIs.
   */
  host: string;
  /**
   * Ordered LAN IPs. Logistics print uses the first reachable host.
   * Always normalized on load/save (includes `host` when set).
   */
  hosts: string[];
  port: number;
}

export interface HardcodedLabelPrinterSlot {
  id: string;
  name: string;
  port: number;
  /** Short badge in settings (e.g. "Store label"). */
  roleBadge: string;
  /** What this printer is for — shown under the name. */
  usageDescription: string;
  media: LabelMediaSize;
  usages: readonly LabelPrintUsage[];
}

/** Fixed printer slots — only `host` (IP) is user-configurable. */
export const HARDCODED_LABEL_PRINTERS: ReadonlyArray<HardcodedLabelPrinterSlot> = [
  {
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    port: DEFAULT_LABEL_PRINTER_PORT,
    roleBadge: 'Store label',
    usageDescription: 'Catalog bin labels and item / product pack labels',
    media: {
      labelWidthMm: STORE_LABEL_WIDTH_MM,
      labelHeightMm: STORE_LABEL_HEIGHT_MM,
      labelGapMm: STORE_LABEL_GAP_MM,
    },
    usages: ['catalog_bin', 'catalog_item'],
  },
  {
    id: LOGISTICS_LABEL_PRINTER_ID,
    name: 'Logistics label printer',
    port: DEFAULT_LABEL_PRINTER_PORT,
    roleBadge: 'Logistics',
    usageDescription: 'Shipping labels and courier labels',
    media: {
      labelWidthMm: LOGISTICS_LABEL_WIDTH_MM,
      labelHeightMm: LOGISTICS_LABEL_HEIGHT_MM,
      labelGapMm: LOGISTICS_LABEL_GAP_MM,
    },
    usages: ['logistics_shipping', 'logistics_courier'],
  },
];

export interface LabelStudioDoc {
  printers: LabelPrinter[];
  /** Default printer for bin / store-room labels. */
  storeLabelPrinterId: string;
  /** Default printer for shipping / courier labels. */
  logisticsLabelPrinterId: string;
  updatedAt: string;
  updatedBy?: string | null;
}

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** Unique non-empty hosts, preserving order. */
export function normalizePrinterHosts(values: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(values)) {
    for (const value of values) {
      const host = normalizeHost(value);
      if (host) list.push(host);
    }
  } else {
    const host = normalizeHost(values);
    if (host) list.push(host);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const host of list) {
    const key = host.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(host);
  }
  return out;
}

/** Split typed host list — commas, newlines, or spaces. */
export function parsePrinterHostsText(text: string): string[] {
  return normalizePrinterHosts(
    String(text ?? '')
      .split(/[\s,;]+/)
      .map(part => part.trim())
      .filter(Boolean),
  );
}

export function formatPrinterHostsText(hosts: string[]): string {
  return normalizePrinterHosts(hosts).join(', ');
}

export function printerHostCandidates(printer: Pick<LabelPrinter, 'host' | 'hosts'>): string[] {
  return normalizePrinterHosts([...(printer.hosts ?? []), printer.host]);
}

function hostsByPrinterId(rawPrinters: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!Array.isArray(rawPrinters)) return map;
  for (const raw of rawPrinters) {
    if (!raw || typeof raw !== 'object') continue;
    const data = raw as Record<string, unknown>;
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    if (!id) continue;
    const hosts = normalizePrinterHosts([
      ...(Array.isArray(data.hosts) ? data.hosts : []),
      data.host,
    ]);
    if (hosts.length) map.set(id, hosts);
  }
  return map;
}

export function getHardcodedPrinterSlot(printerId: string): HardcodedLabelPrinterSlot | undefined {
  return HARDCODED_LABEL_PRINTERS.find(p => p.id === printerId);
}

export function getPrinterSlotForUsage(usage: LabelPrintUsage): HardcodedLabelPrinterSlot {
  const slot = HARDCODED_LABEL_PRINTERS.find(p => p.usages.includes(usage));
  if (!slot) {
    throw new Error(`No printer configured for usage: ${usage}`);
  }
  return slot;
}

export function getLabelMediaForUsage(usage: LabelPrintUsage): LabelMediaSize {
  return getPrinterSlotForUsage(usage).media;
}

export function formatLabelMediaSize(media: LabelMediaSize): string {
  const h = Number.isInteger(media.labelHeightMm)
    ? String(media.labelHeightMm)
    : media.labelHeightMm.toFixed(1);
  return `${media.labelWidthMm} × ${h} mm`;
}

/** Build the fixed printer list, applying saved IPs where present. */
export function buildHardcodedPrinters(
  savedHosts?: Map<string, string | string[]> | Record<string, string | string[]>,
): LabelPrinter[] {
  const hostsMap = savedHosts instanceof Map
    ? savedHosts
    : new Map(Object.entries(savedHosts ?? {}));
  return HARDCODED_LABEL_PRINTERS.map((slot, index) => {
    const raw = hostsMap.get(slot.id);
    let hosts = normalizePrinterHosts(raw);
    if (!hosts.length && index === 0 && !hostsMap.size) {
      hosts = [DEFAULT_LABEL_PRINTER_HOST];
    }
    return {
      id: slot.id,
      name: slot.name,
      port: slot.port,
      host: hosts[0] ?? '',
      hosts,
    };
  });
}

export function emptyLabelPrinter(overrides?: Partial<LabelPrinter>): LabelPrinter {
  const slot = HARDCODED_LABEL_PRINTERS.find(p => p.id === overrides?.id)
    ?? HARDCODED_LABEL_PRINTERS[0];
  const hosts = normalizePrinterHosts(overrides?.hosts ?? overrides?.host ?? '');
  return {
    id: overrides?.id ?? slot.id,
    name: overrides?.name ?? slot.name,
    host: hosts[0] ?? '',
    hosts,
    port: overrides?.port ?? slot.port,
  };
}

export function emptyStoreLabelPrinter(): LabelPrinter {
  return {
    id: STORE_LABEL_PRINTER_ID,
    name: 'Store label printer',
    host: DEFAULT_LABEL_PRINTER_HOST,
    hosts: [DEFAULT_LABEL_PRINTER_HOST],
    port: DEFAULT_LABEL_PRINTER_PORT,
  };
}

export function emptyLogisticsLabelPrinter(): LabelPrinter {
  return {
    id: LOGISTICS_LABEL_PRINTER_ID,
    name: 'Logistics label printer',
    host: '',
    hosts: [],
    port: DEFAULT_LABEL_PRINTER_PORT,
  };
}

export function emptyLabelStudioDoc(): LabelStudioDoc {
  const printers = buildHardcodedPrinters();
  return {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    logisticsLabelPrinterId: LOGISTICS_LABEL_PRINTER_ID,
    updatedAt: '',
  };
}

function normalizeStudioPayload(data: Record<string, unknown>): LabelStudioDoc | null {
  const hosts = hostsByPrinterId(data.printers);
  // Legacy single-host docs.
  if (!hosts.size && typeof data.host === 'string') {
    const host = normalizeHost(data.host) || DEFAULT_LABEL_PRINTER_HOST;
    hosts.set(STORE_LABEL_PRINTER_ID, [host]);
  }
  if (!hosts.size && !Array.isArray(data.printers) && typeof data.host !== 'string') {
    return null;
  }
  const printers = buildHardcodedPrinters(hosts);
  return {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    logisticsLabelPrinterId: LOGISTICS_LABEL_PRINTER_ID,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

function migrateFromLegacyPrintersDoc(data: Record<string, unknown>): LabelStudioDoc {
  const hosts = hostsByPrinterId(data.printers);
  if (!hosts.size && (typeof data.host === 'string' || typeof data.port !== 'undefined')) {
    const host = normalizeHost(data.host) || DEFAULT_LABEL_PRINTER_HOST;
    hosts.set(STORE_LABEL_PRINTER_ID, [host]);
  }
  return {
    printers: buildHardcodedPrinters(hosts),
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    logisticsLabelPrinterId: LOGISTICS_LABEL_PRINTER_ID,
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

export function getLogisticsLabelPrinter(docData: LabelStudioDoc): LabelPrinter {
  const byId = docData.printers.find(p => p.id === LOGISTICS_LABEL_PRINTER_ID);
  if (byId) return byId;
  return emptyLogisticsLabelPrinter();
}

/** Resolve the hardcoded printer for a usage from saved settings. */
export function getPrinterForUsage(
  docData: LabelStudioDoc,
  usage: LabelPrintUsage,
): LabelPrinter {
  const slot = getPrinterSlotForUsage(usage);
  return docData.printers.find(p => p.id === slot.id)
    ?? emptyLabelPrinter({ id: slot.id, name: slot.name, port: slot.port });
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
  const hosts = printerHostCandidates(printer);
  // Empty IP is allowed in settings (configure later); print paths require a host.
  if (!hosts.length) return null;
  for (const host of hosts) {
    const hostError = validatePrinterHost(host);
    if (hostError) return `${slot.name}: ${hostError} (${host})`;
  }
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
  const hosts = new Map(
    input.printers.map(p => [p.id, printerHostCandidates(p)]),
  );
  const printers = buildHardcodedPrinters(hosts);
  const err = validateLabelStudioDoc({ printers });
  if (err) throw new Error(err);

  const updatedAt = new Date().toISOString();
  const payload: LabelStudioDoc = {
    printers,
    storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
    logisticsLabelPrinterId: LOGISTICS_LABEL_PRINTER_ID,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(doc(db, 'appSettings', LABEL_STUDIO_DOC_ID), payload, { merge: false });
  return payload;
}
