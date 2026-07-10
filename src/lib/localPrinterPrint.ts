import { Capacitor } from '@capacitor/core';
import { TcpPrint } from 'tcp-print';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import {
  buildGenuineSpareLabelTspl,
  TEST_BIN_LABEL_SAMPLE,
  type BinLabelFields,
} from './localPrinterLabel';

/** Encode UTF-8 text as base64 for the native TCP plugin. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
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

export async function sendBinLabel(options: {
  host: string;
  port: number;
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
  fields: BinLabelFields;
}): Promise<{ bytesSent: number }> {
  const payload = buildGenuineSpareLabelTspl(options.fields, {
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

/** Test print uses the Genuine Spare mockup sample (4pinCW / Rack A · Raw 5 · Bin 3). */
export async function sendTestLabel(options: {
  host: string;
  port: number;
  labelWidthMm: number;
  labelHeightMm: number;
  labelGapMm: number;
}): Promise<{ bytesSent: number }> {
  return sendBinLabel({
    ...options,
    fields: {
      ...TEST_BIN_LABEL_SAMPLE,
      printedOn: new Date(),
    },
  });
}

/** @deprecated Use buildGenuineSpareLabelTspl — kept for any older imports. */
export function buildTestLabelTspl(options?: {
  labelWidthMm?: number;
  labelHeightMm?: number;
  labelGapMm?: number;
}): string {
  return buildGenuineSpareLabelTspl(
    { ...TEST_BIN_LABEL_SAMPLE, printedOn: new Date() },
    {
      labelWidthMm: options?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
      labelHeightMm: options?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
      labelGapMm: options?.labelGapMm ?? DEFAULT_LABEL_GAP_MM,
    },
  );
}
