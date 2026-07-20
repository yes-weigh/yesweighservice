import type { BinLabelFields } from './localPrinterLabel';
import { renderLabelLayoutCanvas } from './labelLayouts';
import { parseLayoutMedia } from './labelLayouts/bindings';

export { LABEL_DPI, LABEL_PAD_MM, mmToDots } from './labelLayouts/units';

export type LabelRenderMedia = {
  /** Full layout XML (Firestore layout or template). */
  layoutXml: string;
  labelWidthMm?: number;
  labelHeightMm?: number;
};

/**
 * Render a bin label to canvas (WYSIWYG preview === print bitmap).
 * Size comes from layout XML widthMm/heightMm unless overridden.
 */
export async function renderBinLabelCanvas(
  fields: BinLabelFields,
  media: LabelRenderMedia,
): Promise<HTMLCanvasElement> {
  const fromXml = parseLayoutMedia(media.layoutXml);
  return renderLabelLayoutCanvas(media.layoutXml, fields, {
    labelWidthMm: media.labelWidthMm ?? fromXml.labelWidthMm,
    labelHeightMm: media.labelHeightMm ?? fromXml.labelHeightMm,
  });
}

/** Same luminance cut used for TSPL BITMAP (matches thermal burn). */
export const THERMAL_BLACK_LUMINANCE = 160;

/**
 * Force canvas to pure black/white using the thermal BITMAP threshold.
 * Preview then matches what the logistics printer will burn.
 */
export function applyThermalMonochrome(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const black = a > 128 && lum < THERMAL_BLACK_LUMINANCE;
    const v = black ? 0x11 : 0xff;
    pixels[i] = v;
    pixels[i + 1] = v;
    pixels[i + 2] = v;
    pixels[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Convert canvas pixels to 1-bit packed rows for TSC BITMAP (1 = black).
 * Width is padded to a multiple of 8.
 */
export function canvasToTsplBitmapBytes(canvas: HTMLCanvasElement): {
  widthBytes: number;
  height: number;
  data: Uint8Array;
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read label canvas.');

  const { width, height } = canvas;
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const image = ctx.getImageData(0, 0, width, height).data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = image[i];
      const g = image[i + 1];
      const b = image[i + 2];
      const a = image[i + 3];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const black = a > 128 && lum < THERMAL_BLACK_LUMINANCE;
      if (black) {
        const byteIndex = y * widthBytes + (x >> 3);
        data[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  // TSC TE210 BITMAP polarity: 0 = burn (black), 1 = no burn (white).
  for (let i = 0; i < data.length; i += 1) data[i] ^= 0xff;

  return { widthBytes, height, data };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export { bytesToBase64 };

/** Build TSPL job from an already-rendered canvas (WYSIWYG). */
export function buildCanvasTsplBitmapJob(
  canvas: HTMLCanvasElement,
  media: {
    labelWidthMm: number;
    labelHeightMm: number;
    labelGapMm: number;
  },
  /** Extra TSPL lines after BITMAP data (e.g. native TEXT overlays), before PRINT. */
  afterBitmapCommands: string[] = [],
): Uint8Array {
  const { widthBytes, height, data } = canvasToTsplBitmapBytes(canvas);
  const header = new TextEncoder().encode(
    [
      `SIZE ${media.labelWidthMm} mm,${media.labelHeightMm} mm`,
      `GAP ${media.labelGapMm} mm,0`,
      'DIRECTION 1',
      'REFERENCE 0,0',
      'CLS',
      `BITMAP 0,0,${widthBytes},${height},0,`,
    ].join('\r\n'),
  );
  const after = afterBitmapCommands.length
    ? `\r\n${afterBitmapCommands.join('\r\n')}`
    : '';
  const footer = new TextEncoder().encode(`${after}\r\nPRINT 1,1\r\n`);
  const out = new Uint8Array(header.length + data.length + footer.length);
  out.set(header, 0);
  out.set(data, header.length);
  out.set(footer, header.length + data.length);
  return out;
}

/** Build TSPL job: SIZE/GAP/CLS + BITMAP + PRINT (same pixels as preview). */
export async function buildLabelBitmapJob(
  fields: BinLabelFields,
  media: {
    layoutXml: string;
    labelWidthMm?: number;
    labelHeightMm?: number;
    labelGapMm?: number;
  },
): Promise<Uint8Array> {
  const fromXml = parseLayoutMedia(media.layoutXml);
  const labelWidthMm = media.labelWidthMm ?? fromXml.labelWidthMm;
  const labelHeightMm = media.labelHeightMm ?? fromXml.labelHeightMm;
  const labelGapMm = media.labelGapMm ?? fromXml.labelGapMm;

  const canvas = await renderBinLabelCanvas(fields, {
    layoutXml: media.layoutXml,
    labelWidthMm,
    labelHeightMm,
  });
  return buildCanvasTsplBitmapJob(canvas, {
    labelWidthMm,
    labelHeightMm,
    labelGapMm,
  });
}

/** @deprecated Use buildLabelBitmapJob */
export async function buildGenuineSpareLabelBitmapJob(
  fields: BinLabelFields,
  media: {
    layoutXml: string;
    labelWidthMm?: number;
    labelHeightMm?: number;
    labelGapMm?: number;
  },
): Promise<Uint8Array> {
  return buildLabelBitmapJob(fields, media);
}
