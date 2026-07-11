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
import {
  buildLabelBitmapJob,
  bytesToBase64,
} from './localPrinterLabelBitmap';
import { parseLayoutMedia } from './labelLayouts';
import type { LabelPrinter } from './labelStudio';

/** Encode bytes/text as base64 for the native TCP plugin. */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function isNativePrintAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function sendRawToPrinter(options: {
  host: string;
  port: number;
  payload: string | Uint8Array;
}): Promise<{ bytesSent: number }> {
  if (!isNativePrintAvailable()) {
    throw new Error(
      'Test print only works in the YesWeigh Android APK on the same Wi‑Fi as the printer. The browser PWA cannot open a LAN TCP socket.',
    );
  }

  const dataBase64 = typeof options.payload === 'string'
    ? textToBase64(options.payload)
    : bytesToBase64(options.payload);

  const result = await TcpPrint.send({
    host: options.host,
    port: options.port,
    dataBase64,
    timeoutMs: 15000,
  });

  return { bytesSent: result.bytesSent };
}

/**
 * Print a label using a printer + layout XML (size/gap from XML unless overridden).
 */
export async function sendBinLabel(options: {
  host: string;
  port: number;
  layoutXml: string;
  labelWidthMm?: number;
  labelHeightMm?: number;
  labelGapMm?: number;
  fields: BinLabelFields;
}): Promise<{ bytesSent: number }> {
  const payload = await buildLabelBitmapJob(options.fields, {
    layoutXml: options.layoutXml,
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

export async function sendLabelViaPrinter(
  printer: Pick<LabelPrinter, 'host' | 'port'>,
  layoutXml: string,
  fields: BinLabelFields,
): Promise<{ bytesSent: number }> {
  return sendBinLabel({
    host: printer.host.trim(),
    port: printer.port,
    layoutXml,
    fields,
  });
}

/** Test print — same renderer as the on-screen preview. */
export async function sendTestLabel(options: {
  host: string;
  port: number;
  layoutXml: string;
  labelWidthMm?: number;
  labelHeightMm?: number;
  labelGapMm?: number;
  fields?: BinLabelFields;
}): Promise<{ bytesSent: number }> {
  return sendBinLabel({
    ...options,
    fields: options.fields ?? {
      ...TEST_BIN_LABEL_SAMPLE,
      printedOn: new Date(),
    },
  });
}

/** Legacy vector TSPL (not used for WYSIWYG print). */
export function buildTestLabelTspl(options?: {
  labelWidthMm?: number;
  labelHeightMm?: number;
  labelGapMm?: number;
  layoutXml?: string;
}): string {
  const media = options?.layoutXml
    ? parseLayoutMedia(options.layoutXml)
    : {
        labelWidthMm: options?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
        labelHeightMm: options?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
        labelGapMm: options?.labelGapMm ?? DEFAULT_LABEL_GAP_MM,
      };
  return buildGenuineSpareLabelTspl(
    { ...TEST_BIN_LABEL_SAMPLE, printedOn: new Date() },
    media,
  );
}
