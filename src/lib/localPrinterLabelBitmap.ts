import QRCode from 'qrcode';
import type { BinLabelFields } from './localPrinterLabel';

/** TE210 native density. */
export const LABEL_DPI = 203;

/** Clear margin from physical edge (mm). */
export const LABEL_PAD_MM = 2;

export function mmToDots(mm: number, dpi = LABEL_DPI): number {
  return Math.round((mm * dpi) / 25.4);
}

function formatPrintedOn(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCheckBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(x + size * 0.28, y + size * 0.52);
  ctx.lineTo(x + size * 0.44, y + size * 0.68);
  ctx.lineTo(x + size * 0.74, y + size * 0.32);
  ctx.stroke();
  ctx.restore();
}

function drawRackIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, s, s * 0.85);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.28);
  ctx.lineTo(x + s, y + s * 0.28);
  ctx.moveTo(x, y + s * 0.56);
  ctx.lineTo(x + s, y + s * 0.56);
  ctx.moveTo(x + s * 0.5, y);
  ctx.lineTo(x + s * 0.5, y + s * 0.85);
  ctx.stroke();
  ctx.restore();
}

function drawBoxIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + s * 0.08, y + s * 0.28, s * 0.84, s * 0.55);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.08, y + s * 0.28);
  ctx.lineTo(x + s * 0.5, y + s * 0.08);
  ctx.lineTo(x + s * 0.92, y + s * 0.28);
  ctx.moveTo(x + s * 0.5, y + s * 0.08);
  ctx.lineTo(x + s * 0.5, y + s * 0.83);
  ctx.stroke();
  ctx.restore();
}

function drawBinIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y + s * 0.2);
  ctx.lineTo(x + s * 0.85, y + s * 0.2);
  ctx.lineTo(x + s * 0.75, y + s * 0.85);
  ctx.lineTo(x + s * 0.25, y + s * 0.85);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.2, y + s * 0.42);
  ctx.lineTo(x + s * 0.8, y + s * 0.42);
  ctx.stroke();
  ctx.restore();
}

function drawPhoneScanIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, s * 0.55, s, 3);
  ctx.stroke();
  ctx.strokeRect(x + s * 0.62, y + s * 0.2, s * 0.35, s * 0.35);
  ctx.restore();
}

function drawCalendarIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.3;
  roundRect(ctx, x, y + s * 0.15, s, s * 0.75, 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.38);
  ctx.lineTo(x + s, y + s * 0.38);
  ctx.moveTo(x + s * 0.28, y + s * 0.05);
  ctx.lineTo(x + s * 0.28, y + s * 0.28);
  ctx.moveTo(x + s * 0.72, y + s * 0.05);
  ctx.lineTo(x + s * 0.72, y + s * 0.28);
  ctx.stroke();
  ctx.restore();
}

/**
 * Render the Genuine Spare bin label to a canvas at printer DPI.
 */
export async function renderBinLabelCanvas(
  fields: BinLabelFields,
  media: { labelWidthMm: number; labelHeightMm: number },
): Promise<HTMLCanvasElement> {
  const width = mmToDots(media.labelWidthMm);
  const height = mmToDots(media.labelHeightMm);
  const pad = mmToDots(LABEL_PAD_MM);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create label canvas.');

  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  const boxL = pad;
  const boxT = pad;
  const boxW = width - pad * 2;
  const boxH = height - pad * 2;
  const inset = 8;
  const contentL = boxL + inset;
  const contentT = boxT + inset;
  const contentR = boxL + boxW - inset;
  const contentB = boxT + boxH - inset;
  const contentW = contentR - contentL;

  // Outer rounded border
  ctx.lineWidth = 2;
  roundRect(ctx, boxL, boxT, boxW, boxH, 10);
  ctx.stroke();

  const [qrDataUrl] = await Promise.all([
    QRCode.toDataURL(fields.qrPayload || fields.sku, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 128,
      color: { dark: '#000000', light: '#ffffff' },
    }),
  ]);

  // Header: check badge + title (centered as a group)
  const headerY = contentT + 2;
  const badgeSize = 16;
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  const title = 'YESWEIGH GENUINE SPARE';
  const titleW = ctx.measureText(title).width;
  const headerBlockW = badgeSize + 6 + titleW;
  const headerStart = contentL + (contentW - headerBlockW) / 2;
  drawCheckBadge(ctx, headerStart, headerY, badgeSize);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, headerStart + badgeSize + 6, headerY + badgeSize / 2);
  ctx.textBaseline = 'alphabetic';

  const headerLineY = headerY + badgeSize + 6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(contentL, headerLineY);
  ctx.lineTo(contentR, headerLineY);
  ctx.stroke();

  // Columns
  const footerH = 34;
  const footerTop = contentB - footerH;
  const bodyBottom = footerTop - 6;
  const splitGap = 10;
  const leftW = Math.floor(contentW * 0.46);
  const leftL = contentL;
  const leftR = leftL + leftW;
  const locL = leftR + splitGap;
  const locR = contentR;
  const locT = headerLineY + 8;
  const locB = bodyBottom;
  const locW = locR - locL;
  const colW = Math.floor(locW / 3);

  // --- Left product fields ---
  let y = locT;

  // SKU badge + value
  const skuBadgeW = 44;
  const skuBadgeH = 20;
  roundRect(ctx, leftL, y, skuBadgeW, skuBadgeH, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SKU', leftL + skuBadgeW / 2, y + skuBadgeH / 2 + 0.5);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(fields.sku, leftL + skuBadgeW + 8, y + skuBadgeH / 2);
  y += skuBadgeH + 6;
  ctx.beginPath();
  ctx.moveTo(leftL, y);
  ctx.lineTo(leftR, y);
  ctx.stroke();
  y += 6;

  const drawField = (label: string, value: string) => {
    ctx.font = '9px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, leftL, y + 9);
    ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
    ctx.fillText(value, leftL, y + 24);
    y += 30;
    ctx.beginPath();
    ctx.moveTo(leftL, y);
    ctx.lineTo(leftR, y);
    ctx.stroke();
    y += 6;
  };

  drawField('ITEM NAME', fields.itemName);
  drawField('MASTER SKU', fields.masterSku);
  // Last field without trailing line into QR
  ctx.font = '9px Arial, Helvetica, sans-serif';
  ctx.fillText('MASTER PRODUCT', leftL, y + 9);
  ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
  ctx.fillText(fields.masterProduct, leftL, y + 24);
  y += 32;

  // QR + scan hint
  const qrSize = Math.min(78, bodyBottom - y - 16);
  const qrImg = await loadImage(qrDataUrl);
  if (qrImg) ctx.drawImage(qrImg, leftL, y, qrSize, qrSize);
  drawPhoneScanIcon(ctx, leftL + qrSize + 8, y + 8, 22);
  ctx.font = 'bold 9px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('SCAN FOR SKU INFO', leftL + qrSize + 34, y + 18);
  ctx.font = '8px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Scan this QR code to view product details', leftL, y + qrSize + 12);

  // --- Right location panel ---
  ctx.lineWidth = 2;
  roundRect(ctx, locL, locT, locW, locB - locT, 6);
  ctx.stroke();

  const headers = ['RACK', 'RAW', 'BIN'] as const;
  const values = [fields.rack, fields.raw, fields.bin];
  const headerH = 22;
  for (let i = 0; i < 3; i += 1) {
    const cx = locL + i * colW;
    // header fill
    ctx.fillStyle = '#000';
    ctx.fillRect(cx + (i === 0 ? 1 : 0), locT + 1, colW - (i === 2 ? 1 : 0), headerH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headers[i], cx + colW / 2, locT + 1 + headerH / 2);
    ctx.fillStyle = '#000';

    // divider
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, locT);
      ctx.lineTo(cx, locB);
      ctx.stroke();
    }

    const iconY = locT + headerH + 14;
    const iconS = 28;
    const iconX = cx + (colW - iconS) / 2;
    if (i === 0) drawRackIcon(ctx, iconX, iconY, iconS);
    if (i === 1) drawBoxIcon(ctx, iconX, iconY, iconS);
    if (i === 2) drawBinIcon(ctx, iconX, iconY, iconS);

    ctx.font = 'bold 42px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(values[i], cx + colW / 2, locT + headerH + (locB - locT - headerH) * 0.62);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Header underline under black headers
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(locL, locT + headerH + 1);
  ctx.lineTo(locR, locT + headerH + 1);
  ctx.stroke();

  // Footer
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentL, footerTop);
  ctx.lineTo(contentR, footerTop);
  ctx.stroke();

  drawCalendarIcon(ctx, contentL, footerTop + 8, 14);
  ctx.font = '9px Arial, Helvetica, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`PRINTED ON ${formatPrintedOn(fields.printedOn)}`, contentL + 18, footerTop + 16);

  // Brand right
  const brandX = contentR - 150;
  ctx.beginPath();
  ctx.moveTo(brandX - 10, footerTop + 6);
  ctx.lineTo(brandX - 10, footerTop + footerH - 4);
  ctx.stroke();
  drawCheckBadge(ctx, brandX, footerTop + 4, 14);
  ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
  ctx.fillText('YESWEIGH', brandX + 18, footerTop + 12);
  ctx.font = '7px Arial, Helvetica, sans-serif';
  ctx.fillText('PRECISION IN EVERY WEIGH', brandX, footerTop + 26);

  return canvas;
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
      // Perceived luminance; treat dark / opaque pixels as black (print)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const black = a > 128 && lum < 160;
      if (black) {
        const byteIndex = y * widthBytes + (x >> 3);
        data[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  return { widthBytes, height, data };
}

function encodeAscii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Full TSPL job: SIZE/GAP/CLS + BITMAP (binary) + PRINT.
 */
export async function buildGenuineSpareLabelBitmapJob(
  fields: BinLabelFields,
  media: { labelWidthMm: number; labelHeightMm: number; labelGapMm: number },
): Promise<Uint8Array> {
  const canvas = await renderBinLabelCanvas(fields, media);
  const bitmap = canvasToTsplBitmapBytes(canvas);

  const header = [
    `SIZE ${media.labelWidthMm} mm,${media.labelHeightMm} mm`,
    `GAP ${Math.max(0, media.labelGapMm)} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    // x,y,width(bytes),height,mode(0=overwrite), then raw bytes
    `BITMAP 0,0,${bitmap.widthBytes},${bitmap.height},0,`,
  ].join('\r\n');

  const footer = '\r\nPRINT 1,1\r\n';

  return concatBytes([
    encodeAscii(header),
    bitmap.data,
    encodeAscii(footer),
  ]);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
