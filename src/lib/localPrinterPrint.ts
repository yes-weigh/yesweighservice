import { Capacitor } from '@capacitor/core';
import { TcpPrint } from 'tcp-print';

/** Encode UTF-8 text as base64 for the native TCP plugin. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * TSPL test label (~50×30 mm). Works on most TSC-compatible LAN label printers.
 * If the printer expects ZPL/EZPL instead, swap the payload in a later iteration.
 */
export function buildTestLabelTspl(options?: {
  title?: string;
  host?: string;
  printedAt?: Date;
}): string {
  const title = options?.title ?? 'YesWeigh Test';
  const host = options?.host ?? '';
  const when = (options?.printedAt ?? new Date()).toLocaleString();
  const lines = [
    'SIZE 50 mm, 30 mm',
    'GAP 2 mm, 0 mm',
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    `TEXT 24,24,"3",0,1,1,"${escapeTspl(title)}"`,
    host ? `TEXT 24,70,"2",0,1,1,"IP ${escapeTspl(host)}"` : null,
    `TEXT 24,110,"1",0,1,1,"${escapeTspl(when)}"`,
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
}): Promise<{ bytesSent: number }> {
  const payload = buildTestLabelTspl({
    title: 'YesWeigh Test',
    host: options.host,
  });
  return sendRawToPrinter({
    host: options.host,
    port: options.port,
    payload,
  });
}
