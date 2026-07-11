import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_PRINTER_HOST,
  DEFAULT_LABEL_PRINTER_PORT,
  DEFAULT_LABEL_WIDTH_MM,
  LABEL_STUDIO_DOC_ID,
  LOCAL_PRINTER_SETTINGS_DOC_ID,
} from '../constants/localPrinterSettings';
import {
  DEFAULT_LABEL_LAYOUT_ID,
  ensureLayoutMediaAttrs,
  getLabelLayoutTemplateXml,
  LABEL_LAYOUT_TEMPLATES,
  validateLayoutXml,
} from './labelLayouts';

export const STORE_LABEL_PRINTER_ID = 'store-label';
export const DEFAULT_GENUINE_LAYOUT_ID = 'genuine-spare';
export const DEFAULT_SIMPLE_LAYOUT_ID = 'simple-bin';
export const DEFAULT_STORE_LABEL_ID = 'store-bin-label';

/** Slim LAN printer — size lives on the layout XML. */
export interface LabelPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface LabelLayout {
  id: string;
  name: string;
  xml: string;
}

/** Named print recipe: printer + layout. */
export interface PrintLabel {
  id: string;
  name: string;
  printerId: string;
  layoutId: string;
}

export interface LabelStudioDoc {
  printers: LabelPrinter[];
  layouts: LabelLayout[];
  labels: PrintLabel[];
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

function normalizeMm(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4 * 100) / 100;
}

function readLegacyMm(data: Record<string, unknown>): {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
} {
  let labelWidthMm = DEFAULT_LABEL_WIDTH_MM;
  let labelHeightMm = DEFAULT_LABEL_HEIGHT_MM;
  let labelGapMm = DEFAULT_LABEL_GAP_MM;

  if (typeof data.labelWidthMm === 'number' || typeof data.labelWidthMm === 'string') {
    labelWidthMm = normalizeMm(data.labelWidthMm, DEFAULT_LABEL_WIDTH_MM);
  } else if (typeof data.labelWidthIn === 'number' || typeof data.labelWidthIn === 'string') {
    labelWidthMm = inchesToMm(Number(data.labelWidthIn));
  }

  if (typeof data.labelHeightMm === 'number' || typeof data.labelHeightMm === 'string') {
    labelHeightMm = normalizeMm(data.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM);
  } else if (typeof data.labelHeightIn === 'number' || typeof data.labelHeightIn === 'string') {
    labelHeightMm = inchesToMm(Number(data.labelHeightIn));
  }

  if (typeof data.labelGapMm === 'number' || typeof data.labelGapMm === 'string') {
    labelGapMm = normalizeMm(data.labelGapMm, DEFAULT_LABEL_GAP_MM);
  } else if (typeof data.labelGapIn === 'number' || typeof data.labelGapIn === 'string') {
    labelGapMm = inchesToMm(Number(data.labelGapIn));
  }

  return { labelWidthMm, labelHeightMm, labelGapMm };
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

function seededLayouts(media?: {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
}): LabelLayout[] {
  const size = media ?? {
    labelWidthMm: DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: DEFAULT_LABEL_GAP_MM,
  };

  return LABEL_LAYOUT_TEMPLATES.map(meta => {
    const raw = getLabelLayoutTemplateXml(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      xml: ensureLayoutMediaAttrs(raw, size),
    };
  });
}

export function emptyLabelStudioDoc(): LabelStudioDoc {
  const printer = emptyStoreLabelPrinter();
  const layouts = seededLayouts();
  const genuine = layouts.find(l => l.id === DEFAULT_GENUINE_LAYOUT_ID) ?? layouts[0];
  return {
    printers: [printer],
    layouts,
    labels: [
      {
        id: DEFAULT_STORE_LABEL_ID,
        name: 'Store bin label',
        printerId: printer.id,
        layoutId: genuine.id,
      },
    ],
    updatedAt: '',
  };
}

export function emptyLabelLayout(overrides?: Partial<LabelLayout>): LabelLayout {
  const id = overrides?.id ?? newId('layout');
  const name = overrides?.name ?? 'Custom layout';
  const baseXml = overrides?.xml?.trim()
    || ensureLayoutMediaAttrs(getLabelLayoutTemplateXml(DEFAULT_LABEL_LAYOUT_ID));
  return { id, name, xml: baseXml };
}

export function emptyPrintLabel(overrides?: Partial<PrintLabel>): PrintLabel {
  return {
    id: overrides?.id ?? newId('label'),
    name: overrides?.name ?? 'New label',
    printerId: overrides?.printerId ?? '',
    layoutId: overrides?.layoutId ?? DEFAULT_GENUINE_LAYOUT_ID,
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

function normalizeLayout(raw: unknown, fallback: LabelLayout): LabelLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : fallback.id;
  const name = typeof data.name === 'string' && data.name.trim()
    ? data.name.trim()
    : fallback.name;
  const xml = typeof data.xml === 'string' && data.xml.trim()
    ? data.xml
    : fallback.xml;
  return { id, name, xml: ensureLayoutMediaAttrs(xml) };
}

function normalizePrintLabel(raw: unknown, fallback: PrintLabel): PrintLabel | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : fallback.id;
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : fallback.name,
    printerId: typeof data.printerId === 'string' ? data.printerId.trim() : fallback.printerId,
    layoutId: typeof data.layoutId === 'string' ? data.layoutId.trim() : fallback.layoutId,
  };
}

function normalizeStudioPayload(data: Record<string, unknown>): LabelStudioDoc | null {
  if (!Array.isArray(data.printers) || data.printers.length === 0) return null;
  if (!Array.isArray(data.layouts) || data.layouts.length === 0) return null;
  if (!Array.isArray(data.labels)) return null;

  const defaults = emptyLabelStudioDoc();
  const printers = data.printers
    .map((raw, i) => normalizePrinter(raw, defaults.printers[Math.min(i, defaults.printers.length - 1)]
      ?? emptyStoreLabelPrinter()))
    .filter((p): p is LabelPrinter => p != null);
  if (!printers.length) return null;

  const layouts = data.layouts
    .map((raw, i) => normalizeLayout(raw, defaults.layouts[Math.min(i, defaults.layouts.length - 1)]
      ?? emptyLabelLayout()))
    .filter((l): l is LabelLayout => l != null);
  if (!layouts.length) return null;

  let labels = data.labels
    .map((raw, i) => normalizePrintLabel(raw, {
      id: `label-${i}`,
      name: `Label ${i + 1}`,
      printerId: printers[0].id,
      layoutId: layouts[0].id,
    }))
    .filter((l): l is PrintLabel => l != null);

  labels = labels.filter(l =>
    printers.some(p => p.id === l.printerId) && layouts.some(lay => lay.id === l.layoutId),
  );

  if (!labels.length) {
    labels = [{
      id: DEFAULT_STORE_LABEL_ID,
      name: 'Store bin label',
      printerId: printers[0].id,
      layoutId: layouts.find(l => l.id === DEFAULT_GENUINE_LAYOUT_ID)?.id ?? layouts[0].id,
    }];
  }

  return {
    printers,
    layouts,
    labels,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/** Migrate legacy localPrinterSettings → LabelStudioDoc. */
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

  const firstRaw = Array.isArray(data.printers) && data.printers[0] && typeof data.printers[0] === 'object'
    ? data.printers[0] as Record<string, unknown>
    : data;
  const media = readLegacyMm(firstRaw);

  const layouts = seededLayouts(media);
  const customLayouts: LabelLayout[] = [];

  const rawPrinters = Array.isArray(data.printers) ? data.printers : [data];
  rawPrinters.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const row = raw as Record<string, unknown>;
    const override = typeof row.layoutXmlOverride === 'string' ? row.layoutXmlOverride.trim() : '';
    if (!override) return;
    const printerName = typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : printers[index]?.name ?? `Printer ${index + 1}`;
    customLayouts.push({
      id: newId('custom'),
      name: `Custom – ${printerName}`,
      xml: ensureLayoutMediaAttrs(override, media),
    });
  });

  const allLayouts = [...layouts, ...customLayouts];
  const preferredLayoutId = customLayouts[0]?.id
    ?? (allLayouts.find(l => l.id === DEFAULT_GENUINE_LAYOUT_ID)?.id ?? allLayouts[0].id);

  return {
    printers,
    layouts: allLayouts,
    labels: [
      {
        id: DEFAULT_STORE_LABEL_ID,
        name: 'Store bin label',
        printerId: printers[0].id,
        layoutId: preferredLayoutId,
      },
    ],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

export function getLayoutById(docData: LabelStudioDoc, layoutId: string): LabelLayout | null {
  return docData.layouts.find(l => l.id === layoutId) ?? null;
}

export function getPrinterById(docData: LabelStudioDoc, printerId: string): LabelPrinter | null {
  return docData.printers.find(p => p.id === printerId) ?? null;
}

export function getPrintLabelById(docData: LabelStudioDoc, labelId: string): PrintLabel | null {
  return docData.labels.find(l => l.id === labelId) ?? null;
}

export function resolvePrintLabel(
  docData: LabelStudioDoc,
  labelId: string,
): { label: PrintLabel; printer: LabelPrinter; layout: LabelLayout } | null {
  const label = getPrintLabelById(docData, labelId);
  if (!label) return null;
  const printer = getPrinterById(docData, label.printerId);
  const layout = getLayoutById(docData, label.layoutId);
  if (!printer || !layout) return null;
  return { label, printer, layout };
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
  layouts: LabelLayout[];
  labels: PrintLabel[];
}): string | null {
  if (!input.printers.length) return 'Add at least one printer.';
  if (!input.layouts.length) return 'Add at least one layout.';
  if (!input.labels.length) return 'Add at least one label (printer + layout).';

  const printerIds = new Set<string>();
  for (const p of input.printers) {
    if (printerIds.has(p.id)) return `Duplicate printer id: ${p.id}`;
    printerIds.add(p.id);
    const err = validateLabelPrinter(p);
    if (err) return err;
  }

  const layoutIds = new Set<string>();
  for (const layout of input.layouts) {
    if (layoutIds.has(layout.id)) return `Duplicate layout id: ${layout.id}`;
    layoutIds.add(layout.id);
    if (!layout.name.trim()) return 'Each layout needs a name.';
    const xmlErr = validateLayoutXml(layout.xml);
    if (xmlErr) return `${layout.name}: ${xmlErr}`;
  }

  const labelIds = new Set<string>();
  for (const label of input.labels) {
    if (labelIds.has(label.id)) return `Duplicate label id: ${label.id}`;
    labelIds.add(label.id);
    if (!label.name.trim()) return 'Each label needs a name.';
    if (!printerIds.has(label.printerId)) {
      return `${label.name}: printer not found.`;
    }
    if (!layoutIds.has(label.layoutId)) {
      return `${label.name}: layout not found.`;
    }
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
    layouts: LabelLayout[];
    labels: PrintLabel[];
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

  const layouts = input.layouts.map(l => ({
    id: l.id.trim() || newId('layout'),
    name: l.name.trim() || 'Layout',
    xml: ensureLayoutMediaAttrs(l.xml.trim()),
  }));

  const labels = input.labels.map(l => ({
    id: l.id.trim() || newId('label'),
    name: l.name.trim() || 'Label',
    printerId: l.printerId,
    layoutId: l.layoutId,
  }));

  const updatedAt = new Date().toISOString();
  const payload: LabelStudioDoc = {
    printers,
    layouts,
    labels,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(doc(db, 'appSettings', LABEL_STUDIO_DOC_ID), payload, { merge: false });
  return payload;
}
