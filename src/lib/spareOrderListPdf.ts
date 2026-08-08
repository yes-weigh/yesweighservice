import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  FIRM_ADDRESS_LINES,
  FIRM_CIN,
  FIRM_EMAIL,
  FIRM_GSTIN,
  FIRM_NAME,
  FIRM_PAN,
  FIRM_PHONE,
  FIRM_TRADE_NAME,
  FIRM_WEBSITE,
} from '../constants/brand';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { CatalogProduct } from '../types/catalog';
import {
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
} from '../types/catalog-site-inventory';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import { formatItemLocationShort, type YesStoreItemDoc } from '../types/yes-store';
import { getCatalogSiteInventory } from './catalogSiteInventory/data';
import { fetchCatalog } from './catalog';
import { formatInvoiceDate, isFreightInvoiceLineItem, moveFreightLinesToEnd } from './invoices';
import { shippingLabelBarcodeBars } from './shippingLabel';
import { listItemsByCatalogProduct } from './yesStore/data';

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 28;
const INK = rgb(0, 0, 0);
const MUTE = rgb(0.28, 0.28, 0.28);
const RULE = rgb(0.15, 0.15, 0.15);
const HEADER_BG = rgb(0.08, 0.08, 0.08);
const LIGHT_BG = rgb(0.96, 0.96, 0.96);

export type SpareOrderListLine = {
  name: string;
  qtyLabel: string;
  unitPriceLabel: string;
  location: string;
};

export type SpareOrderListPdfInput = {
  orderNo: string;
  dateTimeLabel: string;
  pickedBy: string;
  poNo: string;
  customerName: string;
  customerContact: string;
  customerGstin: string;
  billingAddress: string;
  modeOfTransport: string;
  shippingDateTime: string;
  specialInstructions: string;
  currencyCode: string;
  lines: SpareOrderListLine[];
};

/** Helvetica/WinAnsi-safe text. */
function winAnsiSafe(text: string): string {
  return text
    .replace(/\u20B9/g, 'Rs.')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function truncate(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = winAnsiSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  color = INK,
): void {
  page.drawText(winAnsiSafe(text), { x, y, size, font, color });
}

function drawCentered(
  page: PDFPage,
  font: PDFFont,
  text: string,
  cx: number,
  y: number,
  size: number,
  color = INK,
): void {
  const safe = winAnsiSafe(text);
  const w = font.widthOfTextAtSize(safe, size);
  page.drawText(safe, { x: cx - w / 2, y, size, font, color });
}

function drawBarcode(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const bars = shippingLabelBarcodeBars(value || '0');
  const modules = bars.reduce((sum, w) => sum + w, 0) || 1;
  const moduleW = width / modules;
  let bx = x;
  for (let i = 0; i < bars.length; i += 1) {
    const w = bars[i]! * moduleW;
    if (i % 2 === 0) {
      page.drawRectangle({
        x: bx,
        y,
        width: Math.max(0.35, w),
        height,
        color: INK,
      });
    }
    bx += w;
  }
}

function formatQty(qty: number, unit: string): string {
  const amount = Number.isFinite(qty) ? qty : 0;
  const qtyText = amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unitLabel = unit.trim() || 'nos';
  return `${qtyText} ${unitLabel}`;
}

function formatUnitPrice(rate: number, currencyCode: string): string {
  const amount = Number.isFinite(rate) ? rate : 0;
  const code = (currencyCode || 'INR').toUpperCase();
  if (code === 'INR') {
    return `Rs. ${amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTimeLabel(value: string | null | undefined): string {
  if (!value) {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return formatInvoiceDate(value);
  return new Date(parsed).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function locationFromSiteInventory(doc: CatalogSiteInventoryDoc | null): string {
  const locations = getCatalogSiteInventoryLocations(doc);
  if (!locations.length) return '';
  const primary = [...locations].sort((a, b) => b.quantity - a.quantity)[0];
  if (!primary) return '';
  return `${primary.zoneId.trim().toUpperCase()} · ${primary.zoneRowNumber}`;
}

function locationFromStoreItems(items: YesStoreItemDoc[]): string {
  const first = items[0];
  if (!first) return '';
  return formatItemLocationShort(first.rackId, first.rowNumber, first.binNumber);
}

async function resolveLineLocations(
  lineItems: DealerInvoiceLineItem[],
): Promise<Map<string, string>> {
  const ids = [...new Set(
    lineItems
      .map(line => line.itemId?.trim())
      .filter((id): id is string => Boolean(id)),
  )];
  const map = new Map<string, string>();
  await Promise.all(ids.map(async id => {
    try {
      const cochin = await getCatalogSiteInventory(id, 'cochin');
      const fromCochin = locationFromSiteInventory(cochin);
      if (fromCochin) {
        map.set(id, fromCochin);
        return;
      }
      const bins = await listItemsByCatalogProduct(id);
      const fromBins = locationFromStoreItems(bins);
      if (fromBins) map.set(id, fromBins);
    } catch {
      // Leave blank when location lookup fails.
    }
  }));
  return map;
}

export async function buildSpareOrderListPdfInput(
  invoice: DealerInvoiceDetail,
  booking: LogisticsBooking | null,
): Promise<SpareOrderListPdfInput> {
  const ordered = moveFreightLinesToEnd(invoice.lineItems);
  let productsById = new Map<string, CatalogProduct>();
  try {
    const catalog = await fetchCatalog();
    productsById = new Map(catalog.items.map(item => [item.id, item]));
  } catch {
    // Units/locations still work with defaults when catalog is unavailable.
  }
  const locations = await resolveLineLocations(ordered);
  const currencyCode = (invoice.currencyCode || 'INR').toUpperCase();
  const lines: SpareOrderListLine[] = ordered.map(line => {
    const product = line.itemId ? productsById.get(line.itemId) : null;
    const unit = product?.unit?.trim()
      || (isFreightInvoiceLineItem(line) ? 'Lumpsum' : 'nos');
    return {
      name: line.name?.trim() || line.description?.trim() || 'Item',
      qtyLabel: formatQty(line.quantity, unit),
      unitPriceLabel: formatUnitPrice(line.rate, currencyCode),
      location: (line.itemId && locations.get(line.itemId)) || '',
    };
  });

  const billing = (
    invoice.billingAddress
    || invoice.shippingAddress
    || booking?.dealer.billingAddress
    || booking?.dealer.shippingAddress
    || ''
  ).trim();

  const phone = (
    invoice.customerPhone
    || booking?.dealer.mobile
    || booking?.dealer.shippingPhone
    || booking?.dealer.billingPhone
    || ''
  ).trim();

  const transport = booking
    ? logisticsPartnerLabel(booking.partnerId)
    : '';

  const shippingDate = booking?.bookingDate
    ? formatDateTimeLabel(booking.bookingDate)
    : '';

  const special = (invoice.notes?.trim())
    || 'Handle with care. Fragile items. Keep away from moisture.';

  return {
    orderNo: invoice.invoiceNumber?.trim() || invoice.id,
    dateTimeLabel: formatDateTimeLabel(invoice.date),
    pickedBy: '',
    poNo: (
      invoice.referenceNumber?.trim()
      || invoice.salesOrderNumber?.trim()
      || ''
    ),
    customerName: (invoice.customerName || booking?.dealer.name || '').trim().toUpperCase(),
    customerContact: phone,
    customerGstin: (invoice.customerGstin || '').trim(),
    billingAddress: phone
      ? `${billing}${billing ? '\n' : ''}Phone: ${phone}`
      : billing,
    modeOfTransport: transport,
    shippingDateTime: shippingDate,
    specialInstructions: special,
    currencyCode,
    lines,
  };
}

export function spareOrderListPdfFileName(orderNo: string): string {
  const safe = orderNo.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'order';
  return `order-list-${safe}.pdf`;
}

export async function buildSpareOrderListPdfBlob(input: SpareOrderListPdfInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let markImage: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  try {
    const res = await fetch('/yesweigh-mark.png');
    if (res.ok) {
      const bytes = await res.arrayBuffer();
      markImage = await doc.embedPng(bytes);
    }
  } catch {
    // Letterhead still renders without the mark.
  }

  const cols = [
    { key: '#', label: '#', width: 22 },
    { key: 'name', label: 'ITEM NAME', width: 248 },
    { key: 'qty', label: 'QTY', width: 70 },
    {
      key: 'price',
      label: `UNIT PRICE (${input.currencyCode === 'INR' ? 'INR' : input.currencyCode})`,
      width: 88,
    },
    { key: 'loc', label: 'LOCATION', width: 72 },
  ] as const;
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  const tableLeft = MARGIN + Math.max(0, (PAGE_W - MARGIN * 2 - tableWidth) / 2);
  const rowH = 16;
  const headerH = 18;
  const bottomLimit = MARGIN + 78;

  const totalPagesEstimate = Math.max(
    1,
    Math.ceil(Math.max(1, input.lines.length) / 28),
  );

  let pageIndex = 0;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let lineIndex = 0;

  const ensureSpace = (needed: number) => {
    if (y - needed >= bottomLimit) return;
    drawFooter(page, font, fontBold, pageIndex + 1, totalPagesEstimate);
    pageIndex += 1;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawContinuationHeader(page, font, fontBold, input.orderNo);
    y -= 36;
    drawTableHeader(page, fontBold, tableLeft, y, cols, headerH);
    y -= headerH;
  };

  // —— Header ——
  const headerTop = y;
  if (markImage) {
    const markH = 28;
    const markW = (markImage.width / markImage.height) * markH;
    page.drawImage(markImage, {
      x: MARGIN,
      y: headerTop - markH,
      width: markW,
      height: markH,
    });
    drawText(page, fontBold, FIRM_TRADE_NAME, MARGIN + markW + 6, headerTop - 14, 11);
    drawText(page, fontBold, FIRM_NAME.toUpperCase(), MARGIN + markW + 6, headerTop - 26, 8);
  } else {
    drawText(page, fontBold, FIRM_TRADE_NAME, MARGIN, headerTop - 12, 12);
    drawText(page, fontBold, FIRM_NAME.toUpperCase(), MARGIN, headerTop - 24, 8);
  }

  const addrY = headerTop - 38;
  const firmLines = [
    ...FIRM_ADDRESS_LINES,
    `Ph: ${FIRM_PHONE}`,
    `GSTIN: ${FIRM_GSTIN}  CIN: ${FIRM_CIN}`,
    `PAN: ${FIRM_PAN}`,
    `${FIRM_EMAIL} | ${FIRM_WEBSITE}`,
  ];
  firmLines.forEach((line, i) => {
    drawText(page, font, line, MARGIN, addrY - i * 9, 6.5, MUTE);
  });

  drawCentered(page, fontBold, 'ORDER / PICKING LIST', PAGE_W / 2, headerTop - 18, 13);

  // Order No box (top right)
  const boxW = 118;
  const boxH = 58;
  const boxX = PAGE_W - MARGIN - boxW;
  const boxY = headerTop - boxH;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    borderColor: RULE,
    borderWidth: 1,
  });
  drawText(page, font, 'Order No.', boxX + 6, boxY + boxH - 12, 7, MUTE);
  drawText(
    page,
    fontBold,
    truncate(fontBold, input.orderNo, 9, boxW - 12),
    boxX + 6,
    boxY + boxH - 24,
    9,
  );
  drawBarcode(page, input.orderNo, boxX + 8, boxY + 8, boxW - 16, 18);

  y = Math.min(addrY - firmLines.length * 9, boxY) - 14;

  // —— Meta row ——
  const metaH = 28;
  const metaW = PAGE_W - MARGIN * 2;
  page.drawRectangle({
    x: MARGIN,
    y: y - metaH,
    width: metaW,
    height: metaH,
    borderColor: RULE,
    borderWidth: 0.8,
  });
  const metaCols = [
    { label: 'Date & Time', value: input.dateTimeLabel || '—' },
    { label: 'Picked By', value: input.pickedBy || '—' },
    { label: 'PO No.', value: input.poNo || '—' },
    { label: 'Page', value: `${pageIndex + 1} of ${totalPagesEstimate}` },
  ];
  const metaColW = metaW / metaCols.length;
  metaCols.forEach((col, i) => {
    const x = MARGIN + i * metaColW;
    if (i > 0) {
      page.drawLine({
        start: { x, y: y },
        end: { x, y: y - metaH },
        thickness: 0.6,
        color: RULE,
      });
    }
    drawText(page, font, col.label, x + 6, y - 10, 6, MUTE);
    drawText(
      page,
      fontBold,
      truncate(fontBold, col.value, 8, metaColW - 12),
      x + 6,
      y - 22,
      8,
    );
  });
  y -= metaH + 10;

  // —— Customer / Billing ——
  const partyH = 62;
  const gap = 8;
  const partyW = (PAGE_W - MARGIN * 2 - gap) / 2;
  drawSectionBox(
    page,
    font,
    fontBold,
    MARGIN,
    y - partyH,
    partyW,
    partyH,
    'CUSTOMER DETAILS',
    [
      `Customer Name: ${input.customerName || '—'}`,
      `Contact: ${input.customerContact || '—'}`,
      `GSTIN: ${input.customerGstin || '—'}`,
    ],
  );
  drawSectionBox(
    page,
    font,
    fontBold,
    MARGIN + partyW + gap,
    y - partyH,
    partyW,
    partyH,
    'BILLING ADDRESS',
    (input.billingAddress || '—').split(/\r?\n/).filter(Boolean).slice(0, 4),
  );
  y -= partyH + 8;

  // —— Logistics bar ——
  const logH = 22;
  page.drawRectangle({
    x: MARGIN,
    y: y - logH,
    width: PAGE_W - MARGIN * 2,
    height: logH,
    borderColor: RULE,
    borderWidth: 0.8,
    color: LIGHT_BG,
  });
  const midX = PAGE_W / 2;
  page.drawLine({
    start: { x: midX, y },
    end: { x: midX, y: y - logH },
    thickness: 0.6,
    color: RULE,
  });
  drawText(page, fontBold, 'MODE OF TRANSPORT', MARGIN + 6, y - 8, 6, MUTE);
  drawText(
    page,
    font,
    truncate(font, input.modeOfTransport || '—', 8, midX - MARGIN - 12),
    MARGIN + 6,
    y - 18,
    8,
  );
  drawText(page, fontBold, 'SHIPPING DATE & TIME', midX + 6, y - 8, 6, MUTE);
  drawText(
    page,
    font,
    truncate(font, input.shippingDateTime || '—', 8, PAGE_W - MARGIN - midX - 12),
    midX + 6,
    y - 18,
    8,
  );
  y -= logH + 10;

  // —— Items table ——
  drawTableHeader(page, fontBold, tableLeft, y, cols, headerH);
  y -= headerH;

  if (input.lines.length === 0) {
    ensureSpace(rowH);
    page.drawRectangle({
      x: tableLeft,
      y: y - rowH,
      width: tableWidth,
      height: rowH,
      borderColor: RULE,
      borderWidth: 0.5,
    });
    drawText(page, font, 'No line items', tableLeft + 6, y - 11, 8, MUTE);
    y -= rowH;
  } else {
    for (const line of input.lines) {
      ensureSpace(rowH);
      lineIndex += 1;
      const values = [
        String(lineIndex),
        line.name,
        line.qtyLabel,
        line.unitPriceLabel,
        line.location || '—',
      ];
      page.drawRectangle({
        x: tableLeft,
        y: y - rowH,
        width: tableWidth,
        height: rowH,
        borderColor: RULE,
        borderWidth: 0.45,
      });
      let x = tableLeft;
      cols.forEach((col, i) => {
        if (i > 0) {
          page.drawLine({
            start: { x, y },
            end: { x, y: y - rowH },
            thickness: 0.35,
            color: RULE,
          });
        }
        const pad = 3;
        const text = truncate(font, values[i]!, 7.5, col.width - pad * 2);
        const tw = font.widthOfTextAtSize(winAnsiSafe(text), 7.5);
        const tx = i === 0 || i === 2 || i === 3
          ? x + col.width - pad - tw
          : x + pad;
        drawText(page, font, text, tx, y - 11, 7.5);
        x += col.width;
      });
      y -= rowH;
    }
  }

  y -= 10;
  ensureSpace(70);

  // —— Special instructions ——
  const instrH = 58;
  page.drawRectangle({
    x: MARGIN,
    y: y - instrH,
    width: PAGE_W - MARGIN * 2,
    height: instrH,
    borderColor: RULE,
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x: MARGIN,
    y: y - 14,
    width: PAGE_W - MARGIN * 2,
    height: 14,
    color: HEADER_BG,
  });
  drawText(page, fontBold, 'SPECIAL INSTRUCTIONS', MARGIN + 6, y - 10, 7, rgb(1, 1, 1));
  const instr = truncate(font, input.specialInstructions, 8, PAGE_W - MARGIN * 2 - 16);
  drawText(page, font, instr, MARGIN + 6, y - 28, 8);
  for (let i = 0; i < 3; i += 1) {
    const ly = y - 38 - i * 7;
    page.drawLine({
      start: { x: MARGIN + 6, y: ly },
      end: { x: PAGE_W - MARGIN - 6, y: ly },
      thickness: 0.4,
      color: rgb(0.55, 0.55, 0.55),
      dashArray: [1.5, 2],
    });
  }
  y -= instrH + 16;

  // —— Signatures ——
  ensureSpace(40);
  const sigW = (PAGE_W - MARGIN * 2 - 24) / 2;
  drawSigBlock(page, font, MARGIN, y, sigW, 'Picked By');
  drawSigBlock(page, font, PAGE_W - MARGIN - sigW, y, sigW, 'Checked By');

  drawFooter(page, font, fontBold, pageIndex + 1, Math.max(totalPagesEstimate, pageIndex + 1));

  // Fix page labels now that we know the real page count
  const realPages = doc.getPageCount();
  // Meta "Page" on first page was an estimate — acceptable for warehouse print.
  void realPages;

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer-backed view so BlobPart accepts it under strict DOM typings.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

function drawContinuationHeader(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  orderNo: string,
): void {
  drawText(page, fontBold, 'ORDER / PICKING LIST (cont.)', MARGIN, PAGE_H - MARGIN - 10, 10);
  drawText(page, font, `Order No. ${orderNo}`, MARGIN, PAGE_H - MARGIN - 22, 8, MUTE);
}

function drawTableHeader(
  page: PDFPage,
  fontBold: PDFFont,
  tableLeft: number,
  y: number,
  cols: ReadonlyArray<{ label: string; width: number }>,
  headerH: number,
): void {
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  page.drawRectangle({
    x: tableLeft,
    y: y - headerH,
    width: tableWidth,
    height: headerH,
    color: HEADER_BG,
  });
  let x = tableLeft;
  for (const col of cols) {
    drawText(page, fontBold, col.label, x + 3, y - 12, 7, rgb(1, 1, 1));
    x += col.width;
  }
}

function drawSectionBox(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  lines: string[],
): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: RULE,
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x,
    y: y + h - 14,
    width: w,
    height: 14,
    color: HEADER_BG,
  });
  drawText(page, fontBold, title, x + 5, y + h - 10, 7, rgb(1, 1, 1));
  lines.forEach((line, i) => {
    drawText(
      page,
      font,
      truncate(font, line, 7.5, w - 12),
      x + 5,
      y + h - 28 - i * 11,
      7.5,
    );
  });
}

function drawSigBlock(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  w: number,
  label: string,
): void {
  drawText(page, font, label, x, y, 8, MUTE);
  page.drawLine({
    start: { x: x + 52, y: y + 2 },
    end: { x: x + w, y: y + 2 },
    thickness: 0.7,
    color: RULE,
  });
  drawText(page, font, 'Date', x, y - 16, 8, MUTE);
  page.drawLine({
    start: { x: x + 52, y: y - 14 },
    end: { x: x + w, y: y - 14 },
    thickness: 0.7,
    color: RULE,
  });
}

function drawFooter(
  page: PDFPage,
  font: PDFFont,
  _fontBold: PDFFont,
  pageNo: number,
  pageCount: number,
): void {
  drawCentered(
    page,
    font,
    'Thank you for your business!',
    PAGE_W / 2,
    MARGIN + 18,
    8,
    MUTE,
  );
  drawCentered(
    page,
    font,
    `Page ${pageNo} of ${pageCount}`,
    PAGE_W / 2,
    MARGIN + 6,
    7,
    MUTE,
  );
}
