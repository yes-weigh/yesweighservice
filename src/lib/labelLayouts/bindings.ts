import type { BinLabelFields } from '../localPrinterLabel';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_WIDTH_MM,
} from '../../constants/localPrinterSettings';
import { encodePackedDateBatch } from './batchCode';
export function formatPrintedOn(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** dd-MM-yyyy for product-pack footer (matches mockup). */
export function formatPackedOn(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

export function buildLabelBindings(fields: BinLabelFields): Record<string, string> {
  const printed = fields.printedOn ?? new Date();
  const batchNo = (fields.batchNo ?? '').trim() || encodePackedDateBatch(printed);
  return {
    sku: fields.sku ?? '',
    itemName: fields.itemName ?? '',
    masterSku: fields.masterSku ?? '',
    masterProduct: fields.masterProduct ?? '',
    rack: fields.rack ?? '',
    row: fields.row ?? '',
    bin: fields.bin ?? '',
    qrPayload: fields.qrPayload || fields.sku || '',
    printedOn: formatPrintedOn(printed),
    packedOn: formatPackedOn(printed),
    qty: fields.qty ?? '',
    mrp: fields.mrp ?? '',
    batchNo,
    packedBy: fields.packedBy ?? '',
    qcStatus: fields.qcStatus ?? '',
    modelNumber: fields.modelNumber ?? '',
    approvalNumber: fields.approvalNumber ?? '',
    serialNumber: fields.serialNumber ?? '',
  };
}

export function applyBindings(template: string, bindings: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => bindings[key] ?? '');
}

export function attr(el: Element | null | undefined, name: string, fallback = ''): string {
  if (!el) return fallback;
  // Preserve explicit empty attributes (e.g. center="") instead of falling back.
  if (!el.hasAttribute(name)) return fallback;
  return (el.getAttribute(name) ?? '').trim();
}

export function attrNum(el: Element | null | undefined, name: string, fallback: number): number {
  if (!el) return fallback;
  const raw = el.getAttribute(name);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function attrBool(el: Element | null | undefined, name: string, fallback = false): boolean {
  if (!el) return fallback;
  const raw = el.getAttribute(name)?.trim().toLowerCase();
  if (raw == null || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const BINDING_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Keys referenced via {{key}} or QR field/fallbackField attributes. */
export function extractBindingKeys(xml: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(BINDING_TOKEN_RE.source, 'g');
  while ((match = re.exec(xml)) != null) {
    keys.add(match[1]);
  }

  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (!doc.querySelector('parsererror')) {
      doc.querySelectorAll('qr').forEach(el => {
        const field = el.getAttribute('field')?.trim();
        const fallback = el.getAttribute('fallbackField')?.trim();
        if (field) keys.add(field);
        if (fallback) keys.add(fallback);
      });
    }
  } catch {
    // ignore parse errors — token scan still useful
  }

  return [...keys].sort();
}

/** Human labels for binding keys in the print dialog. */
export const BINDING_FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  itemName: 'Item name',
  masterSku: 'Master SKU',
  masterProduct: 'Master product',
  rack: 'Rack',
  row: 'Row',
  bin: 'Bin',
  qrPayload: 'QR payload',
  printedOn: 'Printed on',
  packedOn: 'Packed on',
  qty: 'Qty',
  mrp: 'MRP',
  batchNo: 'Batch no.',
  packedBy: 'Packed by',
  qcStatus: 'QC status',
  modelNumber: 'Model number',
  approvalNumber: 'Model approval no.',
  serialNumber: 'Serial number',
};

/** Bindings that may be blank on the printed label (no fill-in required). */
const OPTIONAL_BINDINGS = new Set([
  'masterSku',
  'masterProduct',
  'printedOn',
  'packedOn',
  'qty',
  'mrp',
  'batchNo',
  'packedBy',
  'qcStatus',
  'modelNumber',
  'approvalNumber',
]);

/**
 * Return binding keys that are still empty after applying defaults
 * (printedOn always filled; qrPayload falls back to sku).
 * Optional keys like masterSku may stay empty and print blank.
 */
export function missingBindings(
  keys: string[],
  fields: Partial<BinLabelFields> | BinLabelFields,
): string[] {
  const bindings = buildLabelBindings({
    sku: fields.sku ?? '',
    itemName: fields.itemName ?? '',
    masterSku: fields.masterSku ?? '',
    masterProduct: fields.masterProduct ?? '',
    rack: fields.rack ?? '',
    row: fields.row ?? '',
    bin: fields.bin ?? '',
    qrPayload: fields.qrPayload ?? '',
    printedOn: fields.printedOn ?? new Date(),
    qty: fields.qty ?? '',
    mrp: fields.mrp ?? '',
    batchNo: fields.batchNo ?? '',
    packedBy: fields.packedBy ?? '',
    qcStatus: fields.qcStatus ?? '',
    modelNumber: fields.modelNumber ?? '',
    approvalNumber: fields.approvalNumber ?? '',
    serialNumber: fields.serialNumber ?? '',
  });

  return keys.filter(key => {
    if (OPTIONAL_BINDINGS.has(key)) return false;
    const value = (bindings[key] ?? '').trim();
    return !value;
  });
}

export type LayoutMedia = {
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
};

/** Strip BOM and recover from accidental double-paste (second <?xml mid-document). */
export function sanitizeLayoutXml(xml: string): string {
  let s = xml.replace(/^\uFEFF/, '').trim();
  if (!s) return s;

  const decls = [...s.matchAll(/<\?xml\b[^?]*\?>/gi)];
  if (decls.length > 1) {
    // Keep the last document — usually the one the user just pasted.
    const last = decls[decls.length - 1];
    s = s.slice(last.index ?? 0).trim();
  }

  return s;
}

/** Read widthMm / heightMm / gapMm from layout XML root (with defaults). */
export function parseLayoutMedia(xml: string, fallbacks?: Partial<LayoutMedia>): LayoutMedia {
  const fallback: LayoutMedia = {
    labelWidthMm: fallbacks?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: fallbacks?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: fallbacks?.labelGapMm ?? DEFAULT_LABEL_GAP_MM,
  };

  try {
    const doc = new DOMParser().parseFromString(sanitizeLayoutXml(xml), 'application/xml');
    if (doc.querySelector('parsererror')) return fallback;
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'label') return fallback;
    return {
      labelWidthMm: attrNum(root, 'widthMm', fallback.labelWidthMm),
      labelHeightMm: attrNum(root, 'heightMm', fallback.labelHeightMm),
      labelGapMm: attrNum(root, 'gapMm', fallback.labelGapMm),
    };
  } catch {
    return fallback;
  }
}

/** Ensure root <label> has widthMm / heightMm / gapMm attributes. */
export function ensureLayoutMediaAttrs(
  xml: string,
  media: LayoutMedia = {
    labelWidthMm: DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: DEFAULT_LABEL_GAP_MM,
  },
): string {
  const cleaned = sanitizeLayoutXml(xml);
  try {
    const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
    if (doc.querySelector('parsererror')) return cleaned;
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'label') return cleaned;
    if (!root.getAttribute('widthMm')) root.setAttribute('widthMm', String(media.labelWidthMm));
    if (!root.getAttribute('heightMm')) root.setAttribute('heightMm', String(media.labelHeightMm));
    if (!root.getAttribute('gapMm')) root.setAttribute('gapMm', String(media.labelGapMm));
    const serializer = new XMLSerializer();
    // Prefer keeping a single declaration + original comments when possible;
    // serializer drops the declaration which is fine for DOMParser.
    return serializer.serializeToString(doc);
  } catch {
    return cleaned;
  }
}

export function validateLayoutXml(xml: string): string | null {
  const trimmed = sanitizeLayoutXml(xml);
  if (!trimmed) return 'Layout XML is empty.';
  const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    const msg = err.textContent?.trim() || 'parse error';
    if (/XML declaration allowed only at the start/i.test(msg)) {
      return 'Invalid XML: paste replaced the old document incompletely. Clear the editor, then paste once (or use Load … seed).';
    }
    return `Invalid XML: ${msg}`;
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'label') {
    return 'Layout XML must have a root <label> element.';
  }
  const media = parseLayoutMedia(trimmed);
  if (media.labelWidthMm <= 0 || media.labelWidthMm > 120) {
    return 'widthMm must be between 0 and 120.';
  }
  if (media.labelHeightMm <= 0 || media.labelHeightMm > 500) {
    return 'heightMm must be greater than 0.';
  }
  if (media.labelGapMm < 0 || media.labelGapMm > 25) {
    return 'gapMm must be between 0 and 25.';
  }
  return null;
}
