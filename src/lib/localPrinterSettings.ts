import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_LABEL_PRINTER_HOST,
  DEFAULT_LABEL_PRINTER_PORT,
  LOCAL_PRINTER_SETTINGS_DOC_ID,
} from '../constants/localPrinterSettings';

export interface LocalPrinterSettings {
  host: string;
  port: number;
  name: string;
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

export function emptyLocalPrinterSettings(): LocalPrinterSettings {
  return {
    host: DEFAULT_LABEL_PRINTER_HOST,
    port: DEFAULT_LABEL_PRINTER_PORT,
    name: 'Store room label printer',
    updatedAt: '',
  };
}

export async function loadLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  const defaults = emptyLocalPrinterSettings();
  try {
    const snap = await getDoc(doc(db, 'appSettings', LOCAL_PRINTER_SETTINGS_DOC_ID));
    if (!snap.exists()) return defaults;
    const data = snap.data();
    return {
      host: normalizeHost(data.host) || defaults.host,
      port: normalizePort(data.port),
      name: typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : defaults.name,
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
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    const parts = trimmed.split('.').map(Number);
    if (parts.some(p => p > 255)) return 'IP address octets must be 0–255.';
    return null;
  }
  // Simple hostname
  if (/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(trimmed) && trimmed.length <= 253) {
    return null;
  }
  return 'Enter a valid IPv4 address or hostname.';
}

export async function saveLocalPrinterSettings(
  input: { host: string; port: number; name: string },
  updatedBy?: string | null,
): Promise<LocalPrinterSettings> {
  const hostError = validatePrinterHost(input.host);
  if (hostError) throw new Error(hostError);

  const port = normalizePort(input.port);
  if (port !== input.port && !(Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535)) {
    throw new Error('Port must be a whole number between 1 and 65535.');
  }

  const updatedAt = new Date().toISOString();
  const payload: LocalPrinterSettings = {
    host: input.host.trim(),
    port,
    name: input.name.trim() || 'Store room label printer',
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
