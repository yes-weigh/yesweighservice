import { Capacitor } from '@capacitor/core';
import { TcpPrint } from 'tcp-print';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';

/** Encode UTF-8 text as base64 for the native TCP plugin. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function formatMm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * TSPL test label for TSC TE210 (and compatible).
 * SIZE/GAP use mm to match physical caliper measurements.
 */
export function buildTestLabelTspl(options?: {
  title?: string;
  host?: string;
  printedAt?: Date;
  labelWidthMm?: number;
  labelHeightMm?: number;
  labelGapMm?: number;
}): string {
  const title = options?.title ?? 'YesWeigh Test';
  const host = options?.host ?? '';
  const when = (options?.printedAt ?? new Date()).toLocaleString();
  const width = options?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM;
  const height = options?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM;
  const gap = options?.labelGapMm ?? DEFAULT_LABEL_GAP_MM;

  const lines = [
    `SIZE ${formatMm(width)} mm,${formatMm(height)} mm`,
    `GAP ${formatMm(Math.max(0, gap))} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    `TEXT 24,40,"3",0,1,1,"${escapeTspl(title)}"`,
    host ? `TEXT 24,100,"2",0,1,1,"IP ${escapeTspl(host)}"` : null,
    `TEXT 24,150,"1",0,1,1,"${escapeTspl(when)}"`,
    'PRINT 1,1',
    '',
  ];
  return lines.filter(line => line != null).join('\r\n');
}

function escapeTspl(value: string): string {
  return value.replace(/"/g, "'").slice(0, 40);
}

export function isNativePrintAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function sendRawToPrinter(options: {
  host: string;
  port: number;
  payload: string;
}): Promise<{ bytesSent: number }> {
  if (!isNativePrintAvailable()) {
    throw new Error(
      'Test print only works in the YesWeigh Android APK on the same Wi‑Fi as the printer. The browser PWA cannot open a LAN TCP socket.',
    );
  }

  const result = await TcpPrint.send({
    host: options.host,
    port: options.port,
    dataBase64: textToBase64(options.payload),
    timeoutMs: 8000,
  });

  return { bytesSent: result.bytesSent };
}

export async function sendTestLabel(options: {
  host: string;
  port: number;
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
}): Promise<{ bytesSent: number }> {
  const payload = buildTestLabelTspl({
    title: 'YesWeigh Test',
    host: options.host,
    labelWidthMm: options.labelWidthMm,
    labelHeightMm: options.labelHeightMm,
    labelGapMm: options.labelGapMm,
  });
  return sendRawToPrinter({
    host: options.host,
    port: options.port,
    payload,
  });
}
