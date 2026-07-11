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

/**
 * Render the Genuine Spare bin label to a canvas at printer DPI (B&W thermal).
 * Layout: brand header · left product fields (boxed) · right LOCATION grid + QR.
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

  // Column geometry — widen left so header title can use max font; keep min right for QR
  const inset = 5;
  const contentL = boxL + inset;
  const contentR = boxL + boxW - inset;
  const contentB = boxT + boxH - inset;
  const contentW = contentR - contentL;
  const splitGap = 6;

  const headerH = Math.round(30 * 1.3); // 39
  const headerL = boxL + 2;
  const headerT = boxT + 2;
  const headerW = boxW - 4;
  const logoH = headerH - 10;
  const logoX = headerL + 8;
  let logoW = logoH;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = inkBounds(logo);
    logoW = (crop.sw / crop.sh) * logoH;
  }

  const headerTitle = 'YESWEIGH GENUINE SPARE';
  const maxHeaderFont = headerH - 8;
  ctx.font = `bold ${maxHeaderFont}px Arial, Helvetica, sans-serif`;
  const titleW = ctx.measureText(headerTitle).width;
  const headerTextX = logoX + logoW + 8;
  // Divider must clear logo + max-size title; keep ~34% for location + QR
  const minLocW = Math.floor(contentW * 0.34);
  const titleNeededLeft = Math.ceil(headerTextX + titleW + 6 - contentL);
  const leftW = Math.min(
    Math.max(titleNeededLeft, Math.floor(contentW * 0.62)),
    contentW - minLocW - splitGap,
  );
  const leftL = contentL;
  const leftR = leftL + leftW;
  const locL = leftR + splitGap;
  const locR = contentR;
  const locW = locR - locL;
  const colW = Math.floor(locW / 3);
  const dividerX = leftR + splitGap / 2;

  // --- Header: brand left · RACK/ROW/BIN titles right ---
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

  const logoY = headerT + (headerH - logoH) / 2;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = inkBounds(logo);
    ctx.drawImage(logo, crop.sx, crop.sy, crop.sw, crop.sh, logoX, logoY, logoW, logoH);
  } else {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(logoX + logoH / 2, logoY + logoH / 2, logoH / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const headerTextMaxW = dividerX - headerTextX - 6;
  const headerFont = fitFontSize(ctx, headerTitle, headerTextMaxW, maxHeaderFont, 11, true);
  ctx.fillStyle = '#000';
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(headerTitle, headerTextX, headerT + headerH / 2);

  // RACK / ROW / BIN titles — same large bold font for all (fit to longest label)
  const headers = ['RACK', 'ROW', 'BIN'] as const;
  const values = [fields.rack, fields.row, fields.bin];
  const headerLabelFont = fitFontSize(ctx, 'RACK', colW - 4, Math.floor(headerH * 0.55), 11, true);
  for (let i = 0; i < 3; i += 1) {
    const cx = locL + i * colW;
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, headerT);
      ctx.lineTo(cx, headerT + headerH);
      ctx.stroke();
    }
    ctx.fillStyle = '#000';
    ctx.font = `bold ${headerLabelFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headers[i], cx + colW / 2, headerT + headerH / 2);
  }

  const bodyH = contentB - contentT;

  // --- Left: boxed rows; ITEM NAME = label on top, value below; no MASTER PRODUCT ---
  const leftBodyH = contentB - contentT;
  const leftFields: Array<{ label: string; value: string; weight: number; stacked?: boolean }> = [
    { label: 'SKU', value: fields.sku, weight: 1 },
    { label: 'ITEM NAME', value: fields.itemName, weight: 2, stacked: true },
    { label: 'MASTER SKU', value: fields.masterSku, weight: 1 },
    { label: 'PRINTED ON', value: formatPrintedOn(fields.printedOn), weight: 1 },
  ];
  const totalWeight = leftFields.reduce((sum, f) => sum + f.weight, 0);
  const unitH = leftBodyH / totalWeight;

  let rowTop = contentT;
  for (let i = 0; i < leftFields.length; i += 1) {
    const rowH = Math.floor(unitH * leftFields[i].weight);
    const rowBottom = i === leftFields.length - 1 ? contentB : rowTop + rowH;
    const rowMid = (rowTop + rowBottom) / 2;
    const field = leftFields[i];

    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(leftL, rowTop);
      ctx.lineTo(leftR, rowTop);
      ctx.stroke();
    }

    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    const labelPadX = 10;
    const measured = ctx.measureText(field.label).width + labelPadX * 2;
    const badgeW = Math.min(Math.max(Math.ceil(measured), 48), Math.floor(leftW * 0.48));

    if (field.stacked) {
      // Label on its own line (boxed), value on the line(s) below — full width
      const badgeH = Math.min(22, Math.floor((rowBottom - rowTop) * 0.32));
      const badgeY = rowTop + 3;
      roundRect(ctx, leftL, badgeY, badgeW, badgeH, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const labelFont = fitFontSize(ctx, field.label, badgeW - 8, 12, 8, true);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${labelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(field.label, leftL + badgeW / 2, badgeY + badgeH / 2);

      const valueTop = badgeY + badgeH + 2;
      const valueAreaH = rowBottom - valueTop - 2;
      const valueMaxW = leftW - 4;
      // Locked font — wrap to multiple lines instead of shrinking
      const itemNameFont = 30;
      const lineGap = itemNameFont + 2;
      const maxLines = Math.max(1, Math.floor(valueAreaH / lineGap));
      ctx.font = `bold ${itemNameFont}px Arial, Helvetica, sans-serif`;
      const lines = wrapMultiline(ctx, field.value, valueMaxW, maxLines);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const blockH = lines.length * lineGap;
      let y = valueTop + (valueAreaH - blockH) / 2 + lineGap / 2;
      for (const line of lines) {
        ctx.fillText(line, leftL, y);
        y += lineGap;
      }
    } else {
      const badgeH = Math.min(28, Math.floor((rowBottom - rowTop) * 0.55));
      const badgeY = rowMid - badgeH / 2;
      roundRect(ctx, leftL, badgeY, badgeW, badgeH, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const labelFont = fitFontSize(ctx, field.label, badgeW - 8, 13, 8, true);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${labelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(field.label, leftL + badgeW / 2, rowMid);

      const valueMaxW = leftW - badgeW - 10;
      const valueFont = fitFontSize(ctx, field.value, valueMaxW, 28, 12, true);
      ctx.textAlign = 'left';
      ctx.font = `bold ${valueFont}px Arial, Helvetica, sans-serif`;
      ctx.fillText(field.value, leftL + badgeW + 8, rowMid);
    }

    rowTop = rowBottom;
  }

  // --- Right: location values + QR with equal padding on all sides ---
  // Size QR to column width (max), then shrink the location block so leftover height
  // matches — equal pad without reducing QR.
  const qrPad = 10;
  const qrSize = Math.max(40, locW - 2 * qrPad);
  const qrBlockH = qrSize + 2 * qrPad;
  const locH = Math.max(32, bodyH - qrBlockH);
  const locT = contentT;
  const locB = locT + locH;

  // If location took the min floor, remaining QR area may be taller than wide —
  // keep QR at qrSize and center with equal pad in the leftover square cell.
  const qrAreaT = locB;
  const qrAreaH = contentB - qrAreaT;
  // Prefer the planned pad; if area is taller, extra goes equally top/bottom
  // (QR itself stays qrSize — not downsized).
  const padX = Math.floor((locW - qrSize) / 2);
  const padY = Math.floor((qrAreaH - qrSize) / 2);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';

  for (let i = 1; i < 3; i += 1) {
    const cx = locL + i * colW;
    ctx.beginPath();
    ctx.moveTo(cx, locT);
    ctx.lineTo(cx, locB);
    ctx.stroke();
  }

  const valueMaxW = colW - 6;
  const valueMaxH = Math.floor(locH * 0.7);
  const sharedValueFont = Math.min(
    ...values.map((v) => fitFontSize(ctx, v, valueMaxW, valueMaxH, 14, true)),
  );
  for (let i = 0; i < 3; i += 1) {
    const cx = locL + i * colW;
    ctx.fillStyle = '#000';
    ctx.font = `bold ${sharedValueFont}px Arial, Helvetica, sans-serif`;
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

  const qrImg = await loadImage(qrDataUrl);
  const qrX = locL + padX;
  const qrY = qrAreaT + padY;
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

/** Wrap text at a fixed font (ctx.font must already be set). Last line ellipsizes if needed. */
function wrapMultiline(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const trimmed = text.trim();
  if (!trimmed || maxLines < 1) return [''];

  const lines: string[] = [];
  let remaining = trimmed;

  const takeLine = (chunk: string, ellipsis: boolean): string => {
    if (!ellipsis || ctx.measureText(chunk).width <= maxWidth) return chunk;
    let line = chunk;
    while (line.length > 1 && ctx.measureText(`${line}…`).width > maxWidth) {
      line = line.slice(0, -1);
    }
    return `${line}…`;
  };

  while (remaining && lines.length < maxLines) {
    const isLast = lines.length === maxLines - 1;
    if (ctx.measureText(remaining).width <= maxWidth) {
      lines.push(remaining);
      break;
    }

    // Prefer breaking on spaces
    const spaceParts = remaining.split(/(\s+)/);
    let built = '';
    let consumed = 0;
    for (let i = 0; i < spaceParts.length; i += 1) {
      const next = built + spaceParts[i];
      const probe = isLast && i < spaceParts.length - 1 ? `${next.trimEnd()}…` : next;
      if (ctx.measureText(probe).width <= maxWidth) {
        built = next;
        consumed = i + 1;
      } else {
        break;
      }
    }

    if (consumed > 0 && built.trim()) {
      const line = built.trimEnd();
      remaining = spaceParts.slice(consumed).join('').trimStart();
      lines.push(isLast && remaining ? takeLine(line, true) : line);
      if (isLast) break;
      continue;
    }

    // Character wrap
    let cut = 1;
    for (let i = 1; i <= remaining.length; i += 1) {
      const slice = remaining.slice(0, i);
      const probe = isLast && i < remaining.length ? `${slice}…` : slice;
      if (ctx.measureText(probe).width <= maxWidth) cut = i;
      else break;
    }
    if (isLast && cut < remaining.length) {
      lines.push(takeLine(remaining.slice(0, cut), true));
      break;
    }
    lines.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  return lines.length ? lines : [''];
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
