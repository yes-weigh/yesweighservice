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

/** Tight crop around non-white ink so padded logo assets fill the header. */
function inkBounds(img: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const cctx = c.getContext('2d', { willReadFrequently: true });
  if (!cctx) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  cctx.drawImage(img, 0, 0);
  const { data } = cctx.getImageData(0, 0, c.width, c.height);
  let minX = c.width;
  let minY = c.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 4;
      const a = data[i + 3];
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (a > 32 && lum < 240) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  const pad = 2;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(c.width - sx, maxX - minX + 1 + pad * 2);
  const sh = Math.min(c.height - sy, maxY - minY + 1 + pad * 2);
  return { sx, sy, sw, sh };
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
 * Render the Genuine Spare bin label to a canvas at printer DPI (B&W thermal).
 * Layout: black header bar · left product fields · right LOCATION grid + QR · date footer.
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

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  const boxL = pad;
  const boxT = pad;
  const boxW = width - pad * 2;
  const boxH = height - pad * 2;

  // Outer rounded border
  ctx.lineWidth = 2;
  roundRect(ctx, boxL, boxT, boxW, boxH, 10);
  ctx.stroke();

  const [qrDataUrl, logo] = await Promise.all([
    QRCode.toDataURL(fields.qrPayload || fields.sku, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 160,
      color: { dark: '#000000', light: '#ffffff' },
    }),
    loadImage('/yesweigh-mark.png'),
  ]);

  // Column geometry first (needed for header RACK/ROW/BIN alignment)
  const inset = 5;
  const contentL = boxL + inset;
  const contentR = boxL + boxW - inset;
  const contentB = boxT + boxH - inset;
  const contentW = contentR - contentL;
  const splitGap = 6;
  const leftW = Math.floor(contentW * 0.56);
  const leftL = contentL;
  const leftR = leftL + leftW;
  const locL = leftR + splitGap;
  const locR = contentR;
  const locW = locR - locL;
  const colW = Math.floor(locW / 3);
  const dividerX = leftR + splitGap / 2;

  // --- Header: brand left · RACK/ROW/BIN titles right ---
  const headerH = 30;
  const headerL = boxL + 2;
  const headerT = boxT + 2;
  const headerW = boxW - 4;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headerL, headerT + headerH);
  ctx.lineTo(headerL + headerW, headerT + headerH);
  ctx.stroke();

  // Vertical divider through header + body
  const contentT = headerT + headerH + 4;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(dividerX, headerT);
  ctx.lineTo(dividerX, contentB);
  ctx.stroke();

  const logoH = 20;
  const logoX = headerL + 8;
  const logoY = headerT + (headerH - logoH) / 2;
  let logoW = logoH;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = inkBounds(logo);
    logoW = (crop.sw / crop.sh) * logoH;
    ctx.drawImage(logo, crop.sx, crop.sy, crop.sw, crop.sh, logoX, logoY, logoW, logoH);
  } else {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(logoX + logoH / 2, logoY + logoH / 2, logoH / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const headerTitle = 'YESWEIGH GENUINE SPARE';
  const headerTextX = logoX + logoW + 8;
  const headerTextMaxW = dividerX - headerTextX - 6;
  const headerFont = fitFontSize(ctx, headerTitle, headerTextMaxW, 15, 9, true);
  ctx.fillStyle = '#000';
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(headerTitle, headerTextX, headerT + headerH / 2);

  // RACK / ROW / BIN titles in header, aligned to right columns
  const headers = ['RACK', 'ROW', 'BIN'] as const;
  const values = [fields.rack, fields.row, fields.bin];
  for (let i = 0; i < 3; i += 1) {
    const cx = locL + i * colW;
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, headerT);
      ctx.lineTo(cx, headerT + headerH);
      ctx.stroke();
    }
    const hFont = fitFontSize(ctx, headers[i], colW - 4, 12, 8, true);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${hFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headers[i], cx + colW / 2, headerT + headerH / 2);
  }

  const bodyH = contentB - contentT;

  // Date strip only under the left column (does not clip QR)
  const dateH = 16;
  const leftBodyBottom = contentB - dateH;
  const leftBodyH = leftBodyBottom - contentT;

  // --- Left: 4 equal rows + date under them ---
  const leftRows = 4;
  const rowH = Math.floor(leftBodyH / leftRows);
  const leftFields: Array<{ label: string; value: string; skuRow?: boolean }> = [
    { label: 'SKU', value: fields.sku, skuRow: true },
    { label: 'ITEM NAME', value: fields.itemName },
    { label: 'MASTER SKU', value: fields.masterSku },
    { label: 'MASTER PRODUCT', value: fields.masterProduct },
  ];

  for (let i = 0; i < leftRows; i += 1) {
    const rowTop = contentT + i * rowH;
    const rowBottom = i === leftRows - 1 ? leftBodyBottom : rowTop + rowH;
    const rowMid = (rowTop + rowBottom) / 2;
    const valueMaxW = leftW - 4;

    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(leftL, rowTop);
      ctx.lineTo(leftR, rowTop);
      ctx.stroke();
    }

    if (leftFields[i].skuRow) {
      const badgeW = 48;
      const badgeH = Math.min(26, rowH - 8);
      const badgeY = rowMid - badgeH / 2;
      roundRect(ctx, leftL, badgeY, badgeW, badgeH, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const skuLabelFont = fitFontSize(ctx, 'SKU', badgeW - 8, 14, 9, true);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${skuLabelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SKU', leftL + badgeW / 2, rowMid);

      const skuValMaxW = leftW - badgeW - 10;
      const skuFont = fitFontSize(ctx, fields.sku, skuValMaxW, 28, 14, true);
      ctx.textAlign = 'left';
      ctx.font = `bold ${skuFont}px Arial, Helvetica, sans-serif`;
      ctx.fillText(fields.sku, leftL + badgeW + 8, rowMid);
    } else {
      const labelH = Math.floor(rowH * 0.32);
      const labelFont = fitFontSize(ctx, leftFields[i].label, valueMaxW, 12, 8, false);
      ctx.fillStyle = '#000';
      ctx.font = `${labelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(leftFields[i].label, leftL, rowTop + labelH / 2 + 2);

      const valueFont = fitFontSize(ctx, leftFields[i].value, valueMaxW, 22, 12, true);
      ctx.font = `bold ${valueFont}px Arial, Helvetica, sans-serif`;
      ctx.fillText(leftFields[i].value, leftL, rowTop + labelH + (rowBottom - rowTop - labelH) / 2);
    }
  }

  // Printed date under left column only
  ctx.beginPath();
  ctx.moveTo(leftL, leftBodyBottom);
  ctx.lineTo(leftR, leftBodyBottom);
  ctx.stroke();
  const printed = `PRINTED ON ${formatPrintedOn(fields.printedOn)}`;
  drawCalendarIcon(ctx, leftL, leftBodyBottom + 1, 12);
  const footerFont = fitFontSize(ctx, printed, leftW - 20, 11, 7, false);
  ctx.fillStyle = '#000';
  ctx.font = `${footerFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(printed, leftL + 16, leftBodyBottom + dateH / 2);

  // --- Right: location values only (titles are in header) + QR ---
  const locT = contentT;
  const locH = Math.floor(bodyH * 0.22);
  const locB = locT + locH;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';

  for (let i = 1; i < 3; i += 1) {
    const cx = locL + i * colW;
    ctx.beginPath();
    ctx.moveTo(cx, locT);
    ctx.lineTo(cx, locB);
    ctx.stroke();
  }

  for (let i = 0; i < 3; i += 1) {
    const cx = locL + i * colW;
    const vFont = fitFontSize(ctx, values[i], colW - 6, Math.floor(locH * 0.75), 18, true);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${vFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(values[i], cx + colW / 2, locT + locH / 2);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Rule between location values and QR
  ctx.beginPath();
  ctx.moveTo(locL, locB);
  ctx.lineTo(locR, locB);
  ctx.stroke();

  // QR fills remaining right area, with small top/bottom padding
  const qrPad = 12;
  const qrAreaT = locB + qrPad;
  const qrAreaH = contentB - qrAreaT - qrPad;
  const qrSize = Math.max(40, Math.min(locW, qrAreaH));
  const qrImg = await loadImage(qrDataUrl);
  const qrX = locL + Math.floor((locW - qrSize) / 2);
  const qrY = qrAreaT + Math.floor((qrAreaH - qrSize) / 2);
  if (qrImg) ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  return canvas;
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  bold: boolean,
): number {
  for (let size = start; size >= min; size -= 1) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, Helvetica, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return min;
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

  // TSC TE210 BITMAP polarity: 0 = burn (black), 1 = no burn (white).
  for (let i = 0; i < data.length; i += 1) data[i] ^= 0xff;

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
