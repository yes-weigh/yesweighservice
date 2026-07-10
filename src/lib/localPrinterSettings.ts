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

export interface LocalPrinterSettings {
  host: string;
  port: number;
  name: string;
  /** Label width in mm (TSPL SIZE). */
  labelWidthMm: number;
  /** Label height in mm (TSPL SIZE). */
  labelHeightMm: number;
  /** Gap between labels in mm (TSPL GAP). Use 0 if sensor already calibrated. */
  labelGapMm: number;
  updatedAt: string;
  updatedBy?: string | null;
}

export type LocalPrinterSettingsInput = {
  host: string;
  port: number;
  name: string;
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
};

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

export function emptyLocalPrinterSettings(): LocalPrinterSettings {
  return {
    host: DEFAULT_LABEL_PRINTER_HOST,
    port: DEFAULT_LABEL_PRINTER_PORT,
    name: 'Store room label printer',
    labelWidthMm: DEFAULT_LABEL_WIDTH_MM,
    labelHeightMm: DEFAULT_LABEL_HEIGHT_MM,
    labelGapMm: DEFAULT_LABEL_GAP_MM,
    updatedAt: '',
  };
}

export async function loadLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  const defaults = emptyLocalPrinterSettings();
  try {
    const snap = await getDoc(doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID));
    if (!snap.exists()) return defaults;
    const data = snap.data();

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

    return {
      host: normalizeHost(data.host) || defaults.host,
      port: normalizePort(data.port),
      name: typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : defaults.name,
      labelWidthMm,
      labelHeightMm,
      labelGapMm,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
  } catch {
    return defaults;
  }
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

export async function saveLocalPrinterSettings(
  input: LocalPrinterSettingsInput,
  updatedBy?: string | null,
): Promise<LocalPrinterSettings> {
  const hostError = validatePrinterHost(input.host);
  if (hostError) throw new Error(hostError);

  if (!(Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535)) {
    throw new Error('Port must be a whole number between 1 and 65535.');
  }

  const dimError = validateLabelDimensions(input);
  if (dimError) throw new Error(dimError);

  const updatedAt = new Date().toISOString();
  const payload: LocalPrinterSettings = {
    host: input.host.trim(),
    port: input.port,
    name: input.name.trim() || 'Store room label printer',
    labelWidthMm: normalizeMm(input.labelWidthMm, DEFAULT_LABEL_WIDTH_MM),
    labelHeightMm: normalizeMm(input.labelHeightMm, DEFAULT_LABEL_HEIGHT_MM),
    labelGapMm: normalizeMm(input.labelGapMm, 0),
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(
    doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID),
    payload,
    { merge: true },
  );

  return payload;
}
