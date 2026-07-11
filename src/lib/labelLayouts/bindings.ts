import type { BinLabelFields } from '../localPrinterLabel';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_WIDTH_MM,
} from '../../constants/localPrinterSettings';

export function formatPrintedOn(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function buildLabelBindings(fields: BinLabelFields): Record<string, string> {
  return {
    sku: fields.sku ?? '',
    itemName: fields.itemName ?? '',
    masterSku: fields.masterSku ?? '',
    masterProduct: fields.masterProduct ?? '',
    rack: fields.rack ?? '',
    row: fields.row ?? '',
    bin: fields.bin ?? '',
    qrPayload: fields.qrPayload || fields.sku || '',
    printedOn: formatPrintedOn(fields.printedOn ?? new Date()),
  };
}

export function applyBindings(template: string, bindings: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => bindings[key] ?? '');
}

export function attr(el: Element, name: string, fallback = ''): string {
  return el.getAttribute(name)?.trim() || fallback;
}

export function attrNum(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function attrBool(el: Element, name: string, fallback = false): boolean {
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
};

/** Bindings that may be blank on the printed label (no fill-in required). */
const OPTIONAL_BINDINGS = new Set([
  'masterSku',
  'masterProduct',
  'printedOn',
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

/** Read widthMm / heightMm / gapMm from layout XML root (with defaults). */
export function parseLayoutMedia(xml: string, fallbacks?: Partial<LayoutMedia>): LayoutMedia {
  const fallback: LayoutMedia = {
    labelWidthMm: fallbacks?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: fallbacks?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: fallbacks?.labelGapMm ?? DEFAULT_LABEL_GAP_MM,
  };

  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
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
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return xml;
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'label') return xml;
    if (!root.getAttribute('widthMm')) root.setAttribute('widthMm', String(media.labelWidthMm));
    if (!root.getAttribute('heightMm')) root.setAttribute('heightMm', String(media.labelHeightMm));
    if (!root.getAttribute('gapMm')) root.setAttribute('gapMm', String(media.labelGapMm));
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch {
    return xml;
  }
}

export function validateLayoutXml(xml: string): string | null {
  const trimmed = xml.trim();
  if (!trimmed) return 'Layout XML is empty.';
  const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) return `Invalid XML: ${err.textContent?.trim() || 'parse error'}`;
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
