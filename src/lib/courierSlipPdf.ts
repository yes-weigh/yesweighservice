/**
 * Fills the ST Courier multi-copy POD form (OG.pdf) with booking details.
 * Coordinates are PDF points relative to the top-left of each slip copy.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { shippingLabelBarcodeBars } from './shippingLabel';

export const ST_COURIER_SLIP_TEMPLATE_URL = '/logistics/st-courier-slip.pdf';

/** Fields required to stamp the ST Courier POD template. */
export type CourierSlipPdfInput = {
  consignmentNo: string;
  dealerName: string;
  dealerCode: string;
  contactPerson: string;
  deliveryAddress: string;
  toMobile: string;
  fromName: string;
  fromAddress: string;
  fromMobile: string;
  branch: string;
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
const INK = rgb(0.05, 0.05, 0.05);

/** Field layout measured from the rendered OG.pdf template (points from slip top-left). */
const LAYOUT = {
  // Intentionally unused for now — BRANCH / CUSTOMER CODE is left blank for manual fill.
  branch: { x: 86, y: 48, size: 10, maxWidth: 160 },
  date: { x: 274, y: 40, size: 9, maxWidth: 60 },
  kg: { x: 274, y: 68, size: 10, maxWidth: 60 },
  dox: { x: 366, y: 70 },
  nonDox: { x: 468, y: 70 },
  air: { x: 80.5, y: 113 },
  surface: { x: 80.5, y: 133.5 },
  cash: { x: 168, y: 118 },
  credit: { x: 226, y: 118 },
  contents: { x: 274, y: 112, size: 8, maxWidth: 68, maxLines: 4 },
  barcode: { x: 350, y: 99, w: 142, h: 34 },
  awb: { x: 350, y: 138, size: 10, maxWidth: 142 },
  // Start after printed "From" / "To" labels so stamped text does not collide.
  fromName: { x: 122, y: 160, size: 8, maxWidth: 158 },
  fromAddr: { x: 122, y: 170, size: 7, maxWidth: 158, maxLines: 3 },
  fromMobile: { x: 118, y: 203, size: 8, maxWidth: 155 },
  toName: { x: 332, y: 160, size: 8, maxWidth: 172 },
  toAddr: { x: 332, y: 170, size: 7, maxWidth: 172, maxLines: 3 },
  toMobile: { x: 330, y: 203, size: 8, maxWidth: 170 },
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
  return slipTopY(slipIndex) - yFromTop;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
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
  const size = 7;
  const y = pdfY(slipIndex, yFromTop) - size;
  // Solid mark inside the printed checkbox square
  page.drawRectangle({
    x: x + 1.5,
    y: y + 1.5,
    width: size - 1,
    height: size - 1,
    color: INK,
  });
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

function fillSlip(page: PDFPage, font: PDFFont, bold: PDFFont, slip: CourierSlipPdfInput, slipIndex: number): void {
  // BRANCH / CUSTOMER CODE left blank for manual fill (LAYOUT.branch kept for later).

  drawText(page, font, slip.bookingDate, slipIndex, LAYOUT.date.x, LAYOUT.date.y, LAYOUT.date.size);

  const kg = slip.weightLabel === '—' ? '' : slip.weightLabel.replace(/\s*kg$/i, '').trim();
  drawText(page, bold, kg, slipIndex, LAYOUT.kg.x, LAYOUT.kg.y, LAYOUT.kg.size);

  if (slip.isDox) drawCheck(page, slipIndex, LAYOUT.dox.x, LAYOUT.dox.y);
  else drawCheck(page, slipIndex, LAYOUT.nonDox.x, LAYOUT.nonDox.y);

  if (slip.isAir) drawCheck(page, slipIndex, LAYOUT.air.x, LAYOUT.air.y);
  else drawCheck(page, slipIndex, LAYOUT.surface.x, LAYOUT.surface.y);

  // Dealer / account shipments are credit by default.
  drawCheck(page, slipIndex, LAYOUT.credit.x, LAYOUT.credit.y);

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
    // Keep barcode modules scannable; center within the consignment box.
    const bars = shippingLabelBarcodeBars(awb);
    const modules = bars.reduce((sum, w) => sum + w, 0) || 1;
    const targetModule = 0.85;
    const barWidth = Math.min(LAYOUT.barcode.w, modules * targetModule);
    const barX = LAYOUT.barcode.x + (LAYOUT.barcode.w - barWidth) / 2;
    drawBarcode(
      page,
      awb,
      slipIndex,
      barX,
      LAYOUT.barcode.y,
      barWidth,
      LAYOUT.barcode.h,
    );
    const awbWidth = bold.widthOfTextAtSize(awb, LAYOUT.awb.size);
    const awbX = LAYOUT.awb.x + Math.max(0, (LAYOUT.awb.maxWidth - awbWidth) / 2);
    drawText(page, bold, awb, slipIndex, awbX, LAYOUT.awb.y, LAYOUT.awb.size);
  }

  const fromName = slip.fromName.trim() || '—';
  let y = drawWrapped(
    page,
    bold,
    fromName,
    slipIndex,
    LAYOUT.fromName.x,
    LAYOUT.fromName.y,
    LAYOUT.fromName.size,
    LAYOUT.fromName.maxWidth,
    2,
  );
  drawWrapped(
    page,
    font,
    slip.fromAddress,
    slipIndex,
    LAYOUT.fromAddr.x,
    Math.max(y + 1, LAYOUT.fromAddr.y),
    LAYOUT.fromAddr.size,
    LAYOUT.fromAddr.maxWidth,
    LAYOUT.fromAddr.maxLines,
  );
  drawText(page, font, slip.fromMobile, slipIndex, LAYOUT.fromMobile.x, LAYOUT.fromMobile.y, LAYOUT.fromMobile.size);

  const toName = slip.dealerName.trim() || '—';
  y = drawWrapped(
    page,
    bold,
    toName,
    slipIndex,
    LAYOUT.toName.x,
    LAYOUT.toName.y,
    LAYOUT.toName.size,
    LAYOUT.toName.maxWidth,
    2,
  );
  const toBody = [slip.contactPerson, slip.deliveryAddress]
    .map(v => v.trim())
    .filter(v => v && v !== '—')
    .join(', ');
  drawWrapped(
    page,
    font,
    toBody,
    slipIndex,
    LAYOUT.toAddr.x,
    Math.max(y + 1, LAYOUT.toAddr.y),
    LAYOUT.toAddr.size,
    LAYOUT.toAddr.maxWidth,
    LAYOUT.toAddr.maxLines,
  );
  drawText(page, font, slip.toMobile, slipIndex, LAYOUT.toMobile.x, LAYOUT.toMobile.y, LAYOUT.toMobile.size);
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

  for (let i = 0; i < SLIP_COUNT; i += 1) {
    fillSlip(page, font, bold, slip, i);
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
