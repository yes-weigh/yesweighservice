/**
 * Fills the ST Courier multi-copy POD form (OG.pdf) with booking details.
 * Coordinates are PDF points relative to the top-left of each slip copy.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { FIRM_NAME } from '../constants/brand';
import { shippingLabelBarcodeBars, stCourierTrackingUrl } from './shippingLabel';

export const ST_COURIER_SLIP_TEMPLATE_URL = '/logistics/st-courier-slip.pdf';

/** Fields required to stamp the ST Courier POD template. */
export type CourierSlipPdfInput = {
  consignmentNo: string;
  dealerName: string;
  dealerCode: string;
  contactPerson: string;
  deliveryAddress: string;
  /** Optimised multiline To address for the POD form. */
  toAddress: string;
  toMobile: string;
  fromName: string;
  fromAddress: string;
  fromMobile: string;
  /** Staff user who generated / is booking the slip (drawn above Consignor's Signature). */
  generatedBy: string;
  branch: string;
  /** Always "Cochin" in the BRANCH / CUSTOMER CODE cell. */
  branchCustomerCode: string;
  /** Box L×B×H for bottom-right of BRANCH / CUSTOMER CODE (empty for envelope). */
  boxDimensions: string;
  weightLabel: string;
  bookingDate: string;
  contents: string;
  isDox: boolean;
  isAir: boolean;
};

const PAGE_W = 589.44;
const PAGE_H = 835.92;
const SLIP_COUNT = 3;
const SLIP_H = PAGE_H / SLIP_COUNT;
/** Extra downward shift per slip copy (PDF points): top / middle / bottom. */
const SLIP_Y_OFFSETS = [0, 3, 3] as const;
const INK = rgb(0.05, 0.05, 0.05);

/** Field layout measured from the rendered OG.pdf template (points from slip top-left). */
const LAYOUT = {
  // BRANCH / CUSTOMER CODE box (~x 78–256, y 18–78 from slip top).
  branch: { x: 82, y: 34, size: 11, maxWidth: 160 },
  // Box lines sit on the bottom of BRANCH / CUSTOMER CODE (bottomY = last line baseline).
  branchLbh: { x: 82, bottomY: 74, size: 8, maxWidth: 168, maxLines: 4, lineGap: 1.2 },
  date: { centerX: 298, y: 44, size: 9 },
  kg: { centerX: 298, y: 72, size: 10 },
  dox: { x: 366, y: 70 },
  nonDox: { x: 468, y: 70 },
  air: { x: 80.5, y: 113 },
  surface: { x: 80.5, y: 133.5 },
  cash: { x: 168, y: 118 },
  credit: { x: 226, y: 118 },
  contents: { x: 274, y: 112, size: 8, maxWidth: 68, maxLines: 4 },
  // CONSIGNMENT NUMBER white cell — barcode + AWB vertically centered as a unit.
  consign: { x: 350, top: 97, bottom: 148, w: 142 },
  barcode: { h: 28 },
  /** Clear space between barcode bottom and AWB digit tops. */
  awb: { size: 9, gapAbove: 3 },
  // From / To: company + address as one block (shared left edge, normal line gap).
  fromAddr: { x: 101, y: 156, size: 7, maxWidth: 177, maxLines: 4 },
  fromMobile: { x: 106, y: 200, size: 8, maxWidth: 172 },
  toAddr: { x: 308, y: 156, size: 7, maxWidth: 178, maxLines: 5 },
  toMobile: { x: 318, y: 200, size: 8, maxWidth: 178 },
  // TRACK HERE square to the right of the vertical label.
  trackQr: { x: 468, y: 210, size: 40 },
  // Middle-left column — centered just above printed "Consignor's Signature".
  consignorSign: { centerX: 242, y: 240, size: 9, maxWidth: 88 },
} as const;

let templateBytesPromise: Promise<ArrayBuffer> | null = null;

async function loadTemplateBytes(): Promise<ArrayBuffer> {
  if (!templateBytesPromise) {
    templateBytesPromise = fetch(ST_COURIER_SLIP_TEMPLATE_URL)
      .then(async res => {
        if (!res.ok) throw new Error('Could not load ST Courier slip template.');
        return res.arrayBuffer();
      })
      .catch(err => {
        templateBytesPromise = null;
        throw err;
      });
  }
  return templateBytesPromise.then(buf => buf.slice(0));
}

function slipTopY(slipIndex: number): number {
  return PAGE_H - slipIndex * SLIP_H;
}

/** Convert slip-top-relative Y (downward) to PDF Y (upward from page bottom). */
function pdfY(slipIndex: number, yFromTop: number): number {
  const offset = SLIP_Y_OFFSETS[slipIndex] ?? 0;
  return slipTopY(slipIndex) - yFromTop - offset;
}

function wrapParagraph(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const full = words.join(' ');
    const joined = lines.join(' ');
    if (full.length > joined.length) {
      const last = lines[maxLines - 1] ?? '';
      lines[maxLines - 1] = `${last.replace(/\s+\S*$/, '').trimEnd()}…`;
    }
  }
  return lines;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (lines.length >= maxLines) break;
    const remaining = maxLines - lines.length;
    const wrapped = wrapParagraph(font, paragraph, size, maxWidth, remaining);
    if (!wrapped.length && paragraph.trim() === '') continue;
    lines.push(...(wrapped.length ? wrapped : [paragraph.trim()]));
  }
  return lines.slice(0, maxLines);
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  slipIndex: number,
  x: number,
  yFromTop: number,
  size: number,
): void {
  const value = text.trim();
  if (!value || value === '—') return;
  page.drawText(value, {
    x,
    y: pdfY(slipIndex, yFromTop) - size * 0.2,
    size,
    font,
    color: INK,
  });
}

function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  text: string,
  slipIndex: number,
  x: number,
  yFromTop: number,
  size: number,
  maxWidth: number,
  maxLines: number,
  lineGap = 1.15,
): number {
  const lines = wrapLines(font, text, size, maxWidth, maxLines);
  let y = yFromTop;
  for (const line of lines) {
    drawText(page, font, line, slipIndex, x, y, size);
    y += size * lineGap;
  }
  return y;
}

function drawCheck(page: PDFPage, slipIndex: number, x: number, yFromTop: number): void {
  // Tick mark inside the printed checkbox (short stem + longer rising stroke).
  const box = 11;
  const bottom = pdfY(slipIndex, yFromTop) - box + 1.5;
  const left = x - 0.5;
  const thickness = 1.6;
  const midX = left + box * 0.36;
  const midY = bottom + box * 0.22;
  const startX = left + box * 0.08;
  const startY = bottom + box * 0.55;
  const endX = left + box * 0.95;
  const endY = bottom + box * 0.88;
  page.drawLine({
    start: { x: startX, y: startY },
    end: { x: midX, y: midY },
    thickness,
    color: INK,
  });
  page.drawLine({
    start: { x: midX, y: midY },
    end: { x: endX, y: endY },
    thickness,
    color: INK,
  });
}

function drawSpacedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  slipIndex: number,
  x: number,
  yFromTop: number,
  size: number,
  targetWidth: number,
): void {
  const chars = [...text.trim()];
  if (!chars.length) return;
  if (chars.length === 1) {
    const w = font.widthOfTextAtSize(chars[0]!, size);
    drawText(page, font, chars[0]!, slipIndex, x + (targetWidth - w) / 2, yFromTop, size);
    return;
  }
  const widths = chars.map(ch => font.widthOfTextAtSize(ch, size));
  const glyphs = widths.reduce((sum, w) => sum + w, 0);
  const gap = Math.max(0, (targetWidth - glyphs) / (chars.length - 1));
  let cx = x;
  for (let i = 0; i < chars.length; i += 1) {
    drawText(page, font, chars[i]!, slipIndex, cx, yFromTop, size);
    cx += widths[i]! + gap;
  }
}

function drawBarcode(
  page: PDFPage,
  value: string,
  slipIndex: number,
  x: number,
  yFromTop: number,
  width: number,
  height: number,
): void {
  const bars = shippingLabelBarcodeBars(value || '0');
  const modules = bars.reduce((sum, w) => sum + w, 0) || 1;
  const moduleW = width / modules;
  let bx = x;
  const bottom = pdfY(slipIndex, yFromTop + height);
  for (let i = 0; i < bars.length; i += 1) {
    const w = bars[i]! * moduleW;
    if (i % 2 === 0) {
      page.drawRectangle({
        x: bx,
        y: bottom,
        width: Math.max(0.4, w),
        height,
        color: INK,
      });
    }
    bx += w;
  }
}

function formatSlipDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '—') return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const already = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (already) return trimmed;
  return trimmed;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function buildTrackingQrPng(consignmentNo: string): Promise<Uint8Array | null> {
  const awb = consignmentNo.trim();
  if (!awb || awb === '—') return null;
  try {
    const dataUrl = await QRCode.toDataURL(stCourierTrackingUrl(awb), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return dataUrlToUint8Array(dataUrl);
  } catch {
    return null;
  }
}

function drawTrackingQr(
  page: PDFPage,
  qrImage: PDFImage,
  slipIndex: number,
): void {
  const { x, y, size } = LAYOUT.trackQr;
  page.drawImage(qrImage, {
    x,
    y: pdfY(slipIndex, y + size),
    width: size,
    height: size,
  });
}

function fillSlip(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  slip: CourierSlipPdfInput,
  slipIndex: number,
  trackingQr: PDFImage | null,
): void {
  drawText(
    page,
    bold,
    slip.branchCustomerCode || 'Cochin',
    slipIndex,
    LAYOUT.branch.x,
    LAYOUT.branch.y,
    LAYOUT.branch.size,
  );

  if (slip.boxDimensions.trim()) {
    const lbh = LAYOUT.branchLbh;
    const lines = wrapLines(
      bold,
      slip.boxDimensions,
      lbh.size,
      lbh.maxWidth,
      lbh.maxLines,
    );
    if (lines.length) {
      const lineStep = lbh.size * lbh.lineGap;
      const startY = lbh.bottomY - (lines.length - 1) * lineStep;
      let y = startY;
      for (const line of lines) {
        drawText(page, bold, line, slipIndex, lbh.x, y, lbh.size);
        y += lineStep;
      }
    }
  }

  const dateText = formatSlipDate(slip.bookingDate);
  if (dateText) {
    const dateW = font.widthOfTextAtSize(dateText, LAYOUT.date.size);
    drawText(
      page,
      font,
      dateText,
      slipIndex,
      LAYOUT.date.centerX - dateW / 2,
      LAYOUT.date.y,
      LAYOUT.date.size,
    );
  }

  const kg = slip.weightLabel === '—' ? '' : slip.weightLabel.replace(/\s*kg$/i, '').trim();
  if (kg) {
    const kgW = bold.widthOfTextAtSize(kg, LAYOUT.kg.size);
    drawText(
      page,
      bold,
      kg,
      slipIndex,
      LAYOUT.kg.centerX - kgW / 2,
      LAYOUT.kg.y,
      LAYOUT.kg.size,
    );
  }

  if (slip.isDox) drawCheck(page, slipIndex, LAYOUT.dox.x, LAYOUT.dox.y);
  else drawCheck(page, slipIndex, LAYOUT.nonDox.x, LAYOUT.nonDox.y);

  if (slip.isAir) drawCheck(page, slipIndex, LAYOUT.air.x, LAYOUT.air.y);
  else drawCheck(page, slipIndex, LAYOUT.surface.x, LAYOUT.surface.y);

  drawWrapped(
    page,
    font,
    slip.contents,
    slipIndex,
    LAYOUT.contents.x,
    LAYOUT.contents.y,
    LAYOUT.contents.size,
    LAYOUT.contents.maxWidth,
    LAYOUT.contents.maxLines,
  );

  const awb = slip.consignmentNo.trim();
  if (awb && awb !== '—') {
    const box = LAYOUT.consign;
    const barH = LAYOUT.barcode.h;
    const awbSize = LAYOUT.awb.size;
    const gap = LAYOUT.awb.gapAbove;
    const contentH = barH + gap + awbSize;
    const pad = Math.max(0, (box.bottom - box.top - contentH) / 2);
    const barY = box.top + pad;
    // drawText y ≈ baseline; place baseline below gap so digit tops clear the bars.
    const awbY = barY + barH + gap + awbSize * 0.78;

    drawBarcode(page, awb, slipIndex, box.x, barY, box.w, barH);
    drawSpacedText(page, bold, awb, slipIndex, box.x, awbY, awbSize, box.w);
  }

  // From: company + address as one tight block (regular weight).
  const fromCompany = (slip.fromName.trim() && slip.fromName !== '—'
    ? slip.fromName
    : FIRM_NAME).trim();
  const fromBlock = [fromCompany, slip.fromAddress.trim()]
    .filter(line => line && line !== '—')
    .join('\n');
  drawWrapped(
    page,
    font,
    fromBlock,
    slipIndex,
    LAYOUT.fromAddr.x,
    LAYOUT.fromAddr.y,
    LAYOUT.fromAddr.size,
    LAYOUT.fromAddr.maxWidth,
    LAYOUT.fromAddr.maxLines,
    1.05,
  );
  drawText(page, font, slip.fromMobile, slipIndex, LAYOUT.fromMobile.x, LAYOUT.fromMobile.y, LAYOUT.fromMobile.size);

  // To: company + contact/address as one tight block (regular weight).
  const toCompany = (slip.dealerName.trim() || '—');
  const toBlock = [toCompany, slip.toAddress.trim()]
    .filter(line => line && line !== '—')
    .join('\n');
  drawWrapped(
    page,
    font,
    toBlock,
    slipIndex,
    LAYOUT.toAddr.x,
    LAYOUT.toAddr.y,
    LAYOUT.toAddr.size,
    LAYOUT.toAddr.maxWidth,
    LAYOUT.toAddr.maxLines,
    1.05,
  );
  drawText(page, font, slip.toMobile, slipIndex, LAYOUT.toMobile.x, LAYOUT.toMobile.y, LAYOUT.toMobile.size);

  // Name of staff generating the slip — blank area above Consignor's Signature.
  const generatedBy = slip.generatedBy.trim();
  if (generatedBy && generatedBy !== '—') {
    const sign = LAYOUT.consignorSign;
    let label = generatedBy;
    while (label.length > 1 && font.widthOfTextAtSize(label, sign.size) > sign.maxWidth) {
      label = `${label.slice(0, -2).trimEnd()}…`;
    }
    const w = font.widthOfTextAtSize(label, sign.size);
    drawText(
      page,
      font,
      label,
      slipIndex,
      sign.centerX - w / 2,
      sign.y,
      sign.size,
    );
  }

  if (trackingQr) {
    drawTrackingQr(page, trackingQr, slipIndex);
  }
}

/** Build a filled ST Courier POD PDF (all three copies on the page). */
export async function buildCourierSlipPdfBytes(slip: CourierSlipPdfInput): Promise<Uint8Array> {
  const template = await loadTemplateBytes();
  const doc = await PDFDocument.load(template);
  const pages = doc.getPages();
  if (!pages.length) throw new Error('Courier slip template has no pages.');
  const page = pages[0]!;
  const { width, height } = page.getSize();
  if (Math.abs(width - PAGE_W) > 2 || Math.abs(height - PAGE_H) > 2) {
    // Still fill using measured layout; template size drift is rare.
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const qrBytes = await buildTrackingQrPng(slip.consignmentNo);
  const trackingQr = qrBytes ? await doc.embedPng(qrBytes) : null;

  for (let i = 0; i < SLIP_COUNT; i += 1) {
    fillSlip(page, font, bold, slip, i, trackingQr);
  }

  return doc.save();
}

export async function buildCourierSlipPdfBlob(slip: CourierSlipPdfInput): Promise<Blob> {
  const bytes = await buildCourierSlipPdfBytes(slip);
  // Copy into a fresh ArrayBuffer so BlobPart typing stays clean under DOM libs.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'application/pdf' });
}

export function courierSlipPdfFileName(slip: Pick<CourierSlipPdfInput, 'consignmentNo'> & { orderRef?: string }): string {
  const safe = (slip.consignmentNo || slip.orderRef || 'slip')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40);
  return `courier-slip-${safe}.pdf`;
}
