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
  catalogSiteInventoryTotalQuantity,
  getCatalogSiteInventoryLocations,
  type CatalogSiteInventoryDoc,
} from '../types/catalog-site-inventory';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import { formatItemLocationShort, readItemQuantity, type YesStoreItemDoc } from '../types/yes-store';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  portalSalesOrderRemarks,
  type AdminSalesOrderDetail,
} from './admin-sales-orders';
import { getCatalogSiteInventory } from './catalogSiteInventory/data';
import { fetchCatalog } from './catalog';
import { formatInvoiceDate, isFreightInvoiceLineItem, moveFreightLinesToEnd } from './invoices';
import { shippingLabelBarcodeBars } from './shippingLabel';
import { listItemsByCatalogProduct } from './yesStore/data';

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GAP = 8;
const INK = rgb(0, 0, 0);
const MUTE = rgb(0.32, 0.32, 0.32);
const RULE = rgb(0.12, 0.12, 0.12);
const HEADER_BG = rgb(0.08, 0.08, 0.08);
const LIGHT_BG = rgb(0.96, 0.96, 0.96);
/** Shared corner radius for modern card-style boxes. */
const BOX_R = 8;
/** Special instructions + signature block pinned above page footer. */
const BOTTOM_BLOCK_H = 176;
const PAGE_FOOTER_H = 34;

/** Fallback when the sales order has no portal remarks. */
const DEFAULT_SPECIAL_INSTRUCTIONS =
  'Handle with care. Fragile items. Keep away from moisture.';

/** Shared type scale — bumped for warehouse readability. */
const FS = {
  brand: 14,
  firm: 9,
  firmMeta: 8,
  title: 14,
  invLabel: 8.5,
  invNo: 16,
  metaLabel: 8,
  metaValue: 10,
  sectionTitle: 9,
  sectionLabel: 8.5,
  sectionValue: 9,
  tableHeader: 8.5,
  cell: 9.5,
  location: 12,
  itemName: 9.5,
  itemMeta: 8.5,
  instrTitle: 9,
  instrBody: 9.5,
  sig: 9.5,
  page: 8.5,
  contTitle: 12,
  contMeta: 9.5,
} as const;

export type SpareOrderListLine = {
  name: string;
  sku: string;
  availableQtyLabel: string;
  orderQtyLabel: string;
  unitPriceLabel: string;
  location: string;
};

export type SpareOrderListPdfInput = {
  /** Primary document number (invoice # when invoiced, else SO #). */
  invoiceNumber: string;
  /** Label above the primary number box. */
  documentNumberLabel: string;
  dateTimeLabel: string;
  /** Invoice/SO date — used as pickup date on the Picked By Date line. */
  pickupDateLabel: string;
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

/** Word-wrap text to fit maxWidth (WinAnsi-safe). */
function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const safe = winAnsiSafe(text).trim();
  if (!safe) return [];
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return [safe];

  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
    } else {
      // Hard-break oversized tokens
      let chunk = word;
      while (chunk.length > 1 && font.widthOfTextAtSize(chunk, size) > maxWidth) {
        let cut = chunk.length;
        while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) {
          cut -= 1;
        }
        lines.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
      current = chunk;
    }
  }
  if (current) lines.push(current);
  return lines;
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

type LineStockMeta = {
  location: string;
  availableQty: number | null;
};

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

async function resolveLineStockMeta(
  lineItems: DealerInvoiceLineItem[],
): Promise<Map<string, LineStockMeta>> {
  const ids = [...new Set(
    lineItems
      .map(line => line.itemId?.trim())
      .filter((id): id is string => Boolean(id)),
  )];
  const map = new Map<string, LineStockMeta>();
  await Promise.all(ids.map(async id => {
    try {
      const cochin = await getCatalogSiteInventory(id, 'cochin');
      const fromCochin = locationFromSiteInventory(cochin);
      if (fromCochin || cochin) {
        map.set(id, {
          location: fromCochin,
          availableQty: cochin ? catalogSiteInventoryTotalQuantity(cochin) : null,
        });
        return;
      }
      const bins = await listItemsByCatalogProduct(id);
      const fromBins = locationFromStoreItems(bins);
      const binQty = bins.reduce((sum, item) => sum + readItemQuantity(item), 0);
      map.set(id, {
        location: fromBins,
        availableQty: bins.length ? binQty : null,
      });
    } catch {
      // Leave blank when location lookup fails.
    }
  }));
  return map;
}

async function buildOrderListLines(
  lineItems: DealerInvoiceLineItem[],
  currencyCode: string,
): Promise<SpareOrderListLine[]> {
  const ordered = moveFreightLinesToEnd(lineItems);
  let productsById = new Map<string, CatalogProduct>();
  try {
    const catalog = await fetchCatalog();
    productsById = new Map(catalog.items.map(item => [item.id, item]));
  } catch {
    // Units/locations still work with defaults when catalog is unavailable.
  }
  const stockMeta = await resolveLineStockMeta(ordered);
  return ordered.map(line => {
    const product = line.itemId ? productsById.get(line.itemId) : null;
    const unit = product?.unit?.trim()
      || (isFreightInvoiceLineItem(line) ? 'Lumpsum' : 'nos');
    const meta = line.itemId ? stockMeta.get(line.itemId) : undefined;
    const availableQty = meta?.availableQty != null
      ? meta.availableQty
      : (product && Number.isFinite(product.stock) ? product.stock : null);
    const freight = isFreightInvoiceLineItem(line);
    return {
      name: line.name?.trim() || line.description?.trim() || 'Item',
      sku: (line.sku || product?.sku || '').trim(),
      availableQtyLabel: freight || availableQty == null
        ? '—'
        : formatQty(availableQty, unit),
      orderQtyLabel: formatQty(line.quantity, unit),
      unitPriceLabel: formatUnitPrice(line.rate, currencyCode),
      location: meta?.location || '',
    };
  });
}

function bookingTransportFields(booking: LogisticsBooking | null): {
  modeOfTransport: string;
  shippingDateTime: string;
} {
  return {
    modeOfTransport: booking ? logisticsPartnerLabel(booking.partnerId) : '',
    shippingDateTime: booking?.bookingDate
      ? formatDateTimeLabel(booking.bookingDate)
      : '',
  };
}

export async function buildSpareOrderListPdfInput(
  invoice: DealerInvoiceDetail,
  booking: LogisticsBooking | null,
): Promise<SpareOrderListPdfInput> {
  const currencyCode = (invoice.currencyCode || 'INR').toUpperCase();
  const lines = await buildOrderListLines(invoice.lineItems, currencyCode);

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

  const soRemarks = invoice.salesOrderId
    ? await fetchLinkedSalesOrderRemarks(invoice.salesOrderId)
    : null;
  const special = soRemarks || DEFAULT_SPECIAL_INSTRUCTIONS;

  return {
    invoiceNumber: invoice.invoiceNumber?.trim() || invoice.id,
    documentNumberLabel: 'Invoice Number',
    dateTimeLabel: formatDateTimeLabel(invoice.date),
    pickupDateLabel: formatInvoiceDate(invoice.date),
    pickedBy: (invoice.salespersonName || '').trim(),
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
    ...bookingTransportFields(booking),
    specialInstructions: special,
    currencyCode,
    lines,
  };
}

/**
 * Order / picking list from a sales order.
 * Invoiced → primary number is the invoice #; otherwise SO # only.
 */
export async function buildSpareOrderListPdfInputFromSalesOrder(
  salesOrder: AdminSalesOrderDetail,
  booking: LogisticsBooking | null = null,
): Promise<SpareOrderListPdfInput> {
  const currencyCode = (salesOrder.currencyCode || 'INR').toUpperCase();
  const lines = await buildOrderListLines(salesOrder.lineItems, currencyCode);

  const soNumber = (salesOrder.salesOrderNumber || salesOrder.id).trim();
  const invoiceNumber = (salesOrder.zohoInvoiceNumber || '').trim();
  const invoiced = Boolean(invoiceNumber);

  const billing = (
    salesOrder.shippingAddress
    || booking?.dealer.billingAddress
    || booking?.dealer.shippingAddress
    || ''
  ).trim();

  const phone = (
    salesOrder.customerPhone
    || booking?.dealer.mobile
    || booking?.dealer.shippingPhone
    || booking?.dealer.billingPhone
    || ''
  ).trim();

  const special = portalSalesOrderRemarks(salesOrder) || DEFAULT_SPECIAL_INSTRUCTIONS;

  return {
    invoiceNumber: invoiced ? invoiceNumber : soNumber,
    documentNumberLabel: invoiced ? 'Invoice Number' : 'Sales Order Number',
    dateTimeLabel: formatDateTimeLabel(salesOrder.date),
    pickupDateLabel: formatInvoiceDate(salesOrder.date),
    pickedBy: (salesOrder.salespersonName || '').trim(),
    // When invoiced, surface the SO number as PO/ref; otherwise ref only (no fake invoice #).
    poNo: invoiced
      ? soNumber
      : (salesOrder.referenceNumber?.trim() || ''),
    customerName: (salesOrder.customerName || booking?.dealer.name || '').trim().toUpperCase(),
    customerContact: phone,
    customerGstin: '',
    billingAddress: phone
      ? `${billing}${billing ? '\n' : ''}Phone: ${phone}`
      : billing,
    ...bookingTransportFields(booking),
    specialInstructions: special,
    currencyCode,
    lines,
  };
}

/** Best-effort SO remarks for invoice → order list (portal/cart notes only). */
async function fetchLinkedSalesOrderRemarks(salesOrderId: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'salesOrders', salesOrderId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return portalSalesOrderRemarks({
      notes: data.notes ? String(data.notes) : null,
      referenceNumber: data.referenceNumber ? String(data.referenceNumber) : null,
      yesOneCreatedFromCart: Boolean(data.yesOneCreatedFromCart),
      yesOneCreatedByStaff: Boolean(data.yesOneCreatedByStaff),
    });
  } catch {
    return null;
  }
}

export function spareOrderListPdfFileName(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'invoice';
  return `order-list-${safe}.pdf`;
}

async function embedBrandMark(doc: PDFDocument) {
  const candidates = ['/yesweigh-mark.png', '/logo.png'] as const;
  for (const src of candidates) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 4) continue;
      // yesweigh-mark.png is actually JPEG on disk; logo.png is PNG.
      const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      if (isJpeg) return doc.embedJpg(bytes);
      if (isPng) return doc.embedPng(bytes);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function buildSpareOrderListPdfBlob(input: SpareOrderListPdfInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const markImage = await embedBrandMark(doc);

  const currency = input.currencyCode === 'INR' ? 'INR' : input.currencyCode;
  const cols: Array<{ label: string; width: number; align: 'left' | 'right' | 'center' }> = [
    { label: '#', width: 26, align: 'center' },
    { label: 'ITEM', width: 240, align: 'left' },
    { label: 'ORDER QTY', width: 82, align: 'right' },
    { label: `UNIT PRICE (${currency})`, width: 102, align: 'right' },
    { label: 'LOCATION', width: CONTENT_W - 26 - 240 - 82 - 102, align: 'left' },
  ];
  const tableLeft = MARGIN;
  const rowH = 46;
  const headerH = 22;
  /** Leave room for special-instructions block + page footer on every page. */
  const bottomLimit = MARGIN + PAGE_FOOTER_H + BOTTOM_BLOCK_H;
  const rowsPerPageEstimate = Math.max(1, Math.floor(400 / rowH));
  const totalPagesEstimate = Math.max(
    1,
    Math.ceil(Math.max(1, input.lines.length) / rowsPerPageEstimate),
  );

  let pageIndex = 0;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let lineIndex = 0;

  const ensureSpace = (needed: number) => {
    if (y - needed >= bottomLimit) return;
    drawFooter(page, font, pageIndex + 1, totalPagesEstimate);
    pageIndex += 1;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawContinuationHeader(
      page,
      font,
      fontBold,
      input.invoiceNumber,
      input.documentNumberLabel || 'Invoice Number',
    );
    y -= 38;
    drawTableHeader(page, fontBold, tableLeft, y, cols, headerH);
    y -= headerH;
  };

  // —— Header: brand (left) + invoice box (right); title on its own row below ——
  const invBoxW = 176;
  const invBoxH = 78;
  const headerTop = y;
  const invBoxX = PAGE_W - MARGIN - invBoxW;
  const invBoxY = headerTop - invBoxH;
  // Keep letterhead clear of the invoice box.
  const brandW = Math.max(160, invBoxX - MARGIN - GAP);

  // Brand (left) — logo + YES WEIGH (matched height); firm name in address block
  const markH = 28;
  let textX = MARGIN;
  if (markImage) {
    const markW = (markImage.width / markImage.height) * markH;
    page.drawImage(markImage, {
      x: MARGIN,
      y: headerTop - markH,
      width: markW,
      height: markH,
    });
    textX = MARGIN + markW + 7;
  }
  // Match "YES WEIGH" cap-height to the logo height and vertically center beside it.
  const brandSize = markH * 0.78;
  const brandBaseline = headerTop - markH / 2 - brandSize * 0.32;
  drawText(page, fontBold, FIRM_TRADE_NAME, textX, brandBaseline, brandSize);
  const brandBottom = headerTop - markH - 6;

  // Address area — firm legal name first (same bold style as before), then details
  const addrLineH = 10;
  drawText(
    page,
    fontBold,
    truncate(fontBold, FIRM_NAME.toUpperCase(), FS.firm, brandW),
    MARGIN,
    brandBottom - addrLineH,
    FS.firm,
  );
  const firmLines = [
    ...FIRM_ADDRESS_LINES,
    `Ph: ${FIRM_PHONE}`,
    `GSTIN: ${FIRM_GSTIN}`,
    `CIN: ${FIRM_CIN}  PAN: ${FIRM_PAN}`,
  ];
  firmLines.forEach((line, i) => {
    drawText(
      page,
      font,
      truncate(font, line, FS.firmMeta, brandW),
      MARGIN,
      brandBottom - addrLineH * (i + 2),
      FS.firmMeta,
      MUTE,
    );
  });
  const contactLine = `${FIRM_EMAIL} | ${FIRM_WEBSITE}`;
  const contactY = brandBottom - addrLineH * (firmLines.length + 2);
  drawText(
    page,
    fontBold,
    truncate(fontBold, contactLine, FS.firmMeta, brandW),
    MARGIN,
    contactY,
    FS.firmMeta,
    INK,
  );
  const brandEndY = contactY;

  // Invoice number box (right)
  drawRoundedRect(page, invBoxX, invBoxY, invBoxW, invBoxH, BOX_R, {
    stroke: RULE,
    strokeWidth: 1.1,
  });
  drawText(
    page,
    font,
    input.documentNumberLabel || 'Invoice Number',
    invBoxX + 8,
    invBoxY + invBoxH - 14,
    FS.invLabel,
    MUTE,
  );
  const invNo = truncate(fontBold, input.invoiceNumber, FS.invNo, invBoxW - 16);
  const invNoSize = FS.invNo;
  const invNoW = fontBold.widthOfTextAtSize(winAnsiSafe(invNo), invNoSize);
  drawText(
    page,
    fontBold,
    invNo,
    invBoxX + (invBoxW - invNoW) / 2,
    invBoxY + invBoxH - 36,
    invNoSize,
  );
  drawBarcode(page, input.invoiceNumber, invBoxX + 10, invBoxY + 8, invBoxW - 20, 22);

  // Title on its own row — full content width, no overlap with invoice box
  y = Math.min(brandEndY, invBoxY) - GAP;
  const title = 'ORDER / PICKING LIST';
  const titleSize = FS.title;
  drawCentered(page, fontBold, title, PAGE_W / 2, y - titleSize, titleSize);
  y -= titleSize + GAP * 1.25;

  // —— Meta row ——
  const metaH = 34;
  drawKeyedRow(
    page,
    font,
    fontBold,
    MARGIN,
    y,
    CONTENT_W,
    metaH,
    [
      { label: 'Date & Time', value: input.dateTimeLabel || '—' },
      { label: 'Picked By', value: input.pickedBy || '—' },
      { label: 'PO No.', value: input.poNo || '—' },
      { label: 'Page', value: `${pageIndex + 1} of ${totalPagesEstimate}` },
    ],
    false,
  );
  y -= metaH + GAP;

  // —— Customer / Billing ——
  const partyW = (CONTENT_W - GAP) / 2;
  const partyH = Math.max(
    76,
    measureSectionBoxHeight(font, fontBold, partyW, [
      ['Customer Name', input.customerName || '—'],
      ['Contact', input.customerContact || '—'],
      ['GSTIN', input.customerGstin || '—'],
    ]),
    measureSectionBoxHeight(font, fontBold, partyW, [
      ['Address', (input.billingAddress || '—').replace(/\r?\n/g, ', ')],
    ]),
  );
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
      ['Customer Name', input.customerName || '—'],
      ['Contact', input.customerContact || '—'],
      ['GSTIN', input.customerGstin || '—'],
    ],
  );
  drawSectionBox(
    page,
    font,
    fontBold,
    MARGIN + partyW + GAP,
    y - partyH,
    partyW,
    partyH,
    'BILLING ADDRESS',
    [
      ['Address', (input.billingAddress || '—').replace(/\r?\n/g, ', ')],
    ],
  );
  y -= partyH + GAP;

  // —— Logistics bar ——
  const logH = 34;
  drawKeyedRow(
    page,
    font,
    fontBold,
    MARGIN,
    y,
    CONTENT_W,
    logH,
    [
      { label: 'Mode of Transport', value: input.modeOfTransport || '—' },
      { label: 'Shipping Date & Time', value: input.shippingDateTime || '—' },
    ],
    true,
  );
  y -= logH + GAP;

  // —— Items table ——
  drawTableHeader(page, fontBold, tableLeft, y, cols, headerH);
  y -= headerH;

  if (input.lines.length === 0) {
    ensureSpace(rowH);
    drawItemTableRow(
      page,
      font,
      fontBold,
      tableLeft,
      y,
      cols,
      rowH,
      {
        index: '',
        name: 'No line items',
        sku: '',
        availableQtyLabel: '',
        orderQtyLabel: '',
        unitPriceLabel: '',
        location: '',
        muted: true,
      },
      { last: true },
    );
    y -= rowH;
  } else {
    for (let i = 0; i < input.lines.length; i += 1) {
      ensureSpace(rowH);
      lineIndex += 1;
      const line = input.lines[i]!;
      const isLastOverall = i === input.lines.length - 1;
      const nextNeedsPage = !isLastOverall && y - 2 * rowH < bottomLimit;
      drawItemTableRow(
        page,
        font,
        fontBold,
        tableLeft,
        y,
        cols,
        rowH,
        {
          index: String(lineIndex),
          name: line.name,
          sku: line.sku,
          availableQtyLabel: line.availableQtyLabel,
          orderQtyLabel: line.orderQtyLabel,
          unitPriceLabel: line.unitPriceLabel,
          location: line.location || '—',
          muted: false,
        },
        { last: isLastOverall || nextNeedsPage },
      );
      y -= rowH;
    }
  }

  // —— Special instructions / SO remarks + signatures pinned to bottom of last page ——
  drawBottomBlock(
    page,
    font,
    fontBold,
    input.pickedBy,
    input.pickupDateLabel,
    input.specialInstructions,
  );
  drawFooter(page, font, pageIndex + 1, Math.max(totalPagesEstimate, pageIndex + 1));

  // Object streams break pdf.js canvas preview in some builds; keep classic xref.
  const bytes = await doc.save({ useObjectStreams: false });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

/** SVG path for a rounded rect (origin top-left in path space; pdf-lib flips Y). */
function roundedRectSvg(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    `M ${radius},0`,
    `H ${w - radius}`,
    `A ${radius},${radius} 0 0 1 ${w},${radius}`,
    `V ${h - radius}`,
    `A ${radius},${radius} 0 0 1 ${w - radius},${h}`,
    `H ${radius}`,
    `A ${radius},${radius} 0 0 1 0,${h - radius}`,
    `V ${radius}`,
    `A ${radius},${radius} 0 0 1 ${radius},0`,
    'Z',
  ].join(' ');
}

/** Top corners rounded; bottom edge square (section title bars / table headers). */
function roundedTopRectSvg(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    `M 0,${h}`,
    `V ${radius}`,
    `A ${radius},${radius} 0 0 1 ${radius},0`,
    `H ${w - radius}`,
    `A ${radius},${radius} 0 0 1 ${w},${radius}`,
    `V ${h}`,
    'Z',
  ].join(' ');
}

/** Bottom corners rounded; top edge square (last table row). */
function roundedBottomRectSvg(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    `M 0,0`,
    `H ${w}`,
    `V ${h - radius}`,
    `A ${radius},${radius} 0 0 1 ${w - radius},${h}`,
    `H ${radius}`,
    `A ${radius},${radius} 0 0 1 0,${h - radius}`,
    'Z',
  ].join(' ');
}

type RoundRectOpts = {
  fill?: ReturnType<typeof rgb>;
  stroke?: ReturnType<typeof rgb>;
  strokeWidth?: number;
};

function drawSvgShape(
  page: PDFPage,
  path: string,
  x: number,
  yBottom: number,
  h: number,
  opts: RoundRectOpts,
): void {
  // pdf-lib applies scale(1, -1) to SVG paths, so path +Y draws downward from `y`.
  // Pass the TOP of the shape as the origin so the box fills [yBottom, yBottom+h].
  page.drawSvgPath(path, {
    x,
    y: yBottom + h,
    color: opts.fill,
    borderColor: opts.stroke,
    borderWidth: opts.strokeWidth ?? (opts.stroke ? 1 : 0),
  });
}

function drawRoundedRect(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  r: number,
  opts: RoundRectOpts,
): void {
  drawSvgShape(page, roundedRectSvg(w, h, r), x, yBottom, h, opts);
}

function drawRoundedTopRect(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  r: number,
  opts: RoundRectOpts,
): void {
  drawSvgShape(page, roundedTopRectSvg(w, h, r), x, yBottom, h, opts);
}

function drawRoundedBottomRect(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  r: number,
  opts: RoundRectOpts,
): void {
  drawSvgShape(page, roundedBottomRectSvg(w, h, r), x, yBottom, h, opts);
}

/** Compact white clipboard glyph for the special-instructions pill. */
function drawClipboardIcon(page: PDFPage, x: number, yBottom: number, size: number): void {
  const boardW = size * 0.7;
  const boardH = size * 0.78;
  const boardX = x + (size - boardW) / 2;
  const boardY = yBottom;
  page.drawRectangle({
    x: boardX,
    y: boardY,
    width: boardW,
    height: boardH,
    borderColor: rgb(1, 1, 1),
    borderWidth: 0.9,
  });
  // Clip tab
  const tabW = boardW * 0.55;
  const tabH = size * 0.28;
  page.drawRectangle({
    x: boardX + (boardW - tabW) / 2,
    y: boardY + boardH - tabH * 0.35,
    width: tabW,
    height: tabH,
    color: rgb(1, 1, 1),
  });
  // Inner lines
  for (let i = 0; i < 2; i += 1) {
    const ly = boardY + boardH * 0.28 + i * (boardH * 0.22);
    page.drawLine({
      start: { x: boardX + boardW * 0.18, y: ly },
      end: { x: boardX + boardW * 0.82, y: ly },
      thickness: 0.7,
      color: rgb(1, 1, 1),
    });
  }
}

function drawBottomBlock(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  pickedBy: string,
  pickupDateLabel: string,
  specialInstructions: string,
): void {
  // Bottom-up layout (PDF y increases upward):
  // page# → signatures → special-instructions / remarks box
  const pageNoY = MARGIN + 6;
  /** Vertical gap between name row and Date row in each sig column. */
  const sigRowGap = 26;
  const sigDateY = pageNoY + 18;
  const sigLabelY = sigDateY + sigRowGap;
  /** Space between special-instructions box and Picked By / Checked By. */
  const instrBottom = sigLabelY + 28;
  const instrH = 86;
  const instrTop = instrBottom + instrH;

  // Outer rounded container (special instructions / SO remarks)
  drawRoundedRect(page, MARGIN, instrBottom, CONTENT_W, instrH, BOX_R, {
    stroke: INK,
    strokeWidth: 1.15,
  });

  // Pill header badge — sits on the top edge, clear of body text
  const isDefault = specialInstructions.trim() === DEFAULT_SPECIAL_INSTRUCTIONS;
  const label = isDefault ? 'SPECIAL INSTRUCTIONS' : 'SO REMARKS';
  const labelSize = FS.instrTitle;
  const iconSize = 10;
  const badgePadX = 7;
  const badgeH = 15;
  const labelW = fontBold.widthOfTextAtSize(label, labelSize);
  const badgeW = badgePadX + iconSize + 5 + labelW + badgePadX;
  const badgeX = MARGIN + 10;
  const badgeBottom = instrTop - badgeH / 2;
  drawRoundedRect(page, badgeX, badgeBottom, badgeW, badgeH, 4, {
    fill: INK,
  });
  drawClipboardIcon(page, badgeX + badgePadX, badgeBottom + (badgeH - iconSize) / 2, iconSize);
  drawText(
    page,
    fontBold,
    label,
    badgeX + badgePadX + iconSize + 5,
    badgeBottom + (badgeH - labelSize) / 2 + 1,
    labelSize,
    rgb(1, 1, 1),
  );

  // SO remarks (or default care copy) — clear of the badge
  const textX = MARGIN + 14;
  const textMaxW = CONTENT_W - 28;
  let textY = badgeBottom - 14;
  const bodyLines = wrapLines(font, specialInstructions, FS.instrBody, textMaxW);
  const maxBodyLines = 4;
  const shown = bodyLines.slice(0, maxBodyLines);
  if (bodyLines.length > maxBodyLines && shown.length > 0) {
    const last = shown[shown.length - 1];
    shown[shown.length - 1] = truncate(font, last, FS.instrBody, textMaxW);
  }
  for (const line of shown) {
    drawText(page, font, line, textX, textY, FS.instrBody);
    textY -= 13;
  }

  // Dashed note lines for handwritten extras (fill remaining space in the box)
  const lineLeft = MARGIN + 12;
  const lineRight = PAGE_W - MARGIN - 12;
  for (let i = 0; i < 3; i += 1) {
    const ly = textY - 6 - i * 11;
    if (ly < instrBottom + 8) break;
    page.drawLine({
      start: { x: lineLeft, y: ly },
      end: { x: lineRight, y: ly },
      thickness: 0.55,
      color: rgb(0.55, 0.55, 0.55),
      dashArray: [1.2, 1.8],
    });
  }

  // Signatures below the box (no enclosing border)
  // Picked By + Date filled; Checked By left blank with dotted write-in lines.
  const sigW = (CONTENT_W - 28) / 2;
  drawSigBlock(page, font, MARGIN, sigLabelY, sigW, 'Picked By', {
    name: pickedBy,
    date: pickupDateLabel,
    rowGap: sigRowGap,
  });
  drawSigBlock(page, font, PAGE_W - MARGIN - sigW, sigLabelY, sigW, 'Checked By', {
    rowGap: sigRowGap,
  });
}

function drawKeyedRow(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  x: number,
  yTop: number,
  width: number,
  height: number,
  cols: Array<{ label: string; value: string }>,
  shaded: boolean,
): void {
  drawRoundedRect(page, x, yTop - height, width, height, BOX_R, {
    stroke: RULE,
    strokeWidth: 0.9,
    ...(shaded ? { fill: LIGHT_BG } : {}),
  });
  const colW = width / cols.length;
  // Keep dividers inset from rounded corners so they don't clip the arcs.
  const divInset = Math.min(BOX_R * 0.55, height * 0.28);
  cols.forEach((col, i) => {
    const cx = x + i * colW;
    if (i > 0) {
      page.drawLine({
        start: { x: cx, y: yTop - divInset },
        end: { x: cx, y: yTop - height + divInset },
        thickness: 0.6,
        color: RULE,
      });
    }
    drawText(page, font, col.label, cx + 7, yTop - 12, FS.metaLabel, MUTE);
    drawText(
      page,
      fontBold,
      truncate(fontBold, col.value, FS.metaValue, colW - 14),
      cx + 7,
      yTop - 26,
      FS.metaValue,
    );
  });
}

function drawContinuationHeader(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  invoiceNumber: string,
  documentNumberLabel = 'Invoice Number',
): void {
  drawText(
    page,
    fontBold,
    'ORDER / PICKING LIST (cont.)',
    MARGIN,
    PAGE_H - MARGIN - 12,
    FS.contTitle,
  );
  drawText(
    page,
    font,
    `${documentNumberLabel}  ${invoiceNumber}`,
    MARGIN,
    PAGE_H - MARGIN - 26,
    FS.contMeta,
    MUTE,
  );
}

function drawTableHeader(
  page: PDFPage,
  fontBold: PDFFont,
  tableLeft: number,
  y: number,
  cols: ReadonlyArray<{ label: string; width: number; align: 'left' | 'right' | 'center' }>,
  headerH: number,
): void {
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  drawRoundedTopRect(page, tableLeft, y - headerH, tableWidth, headerH, BOX_R, {
    fill: HEADER_BG,
  });
  // Side + bottom edge of header so it joins the body rows cleanly
  page.drawLine({
    start: { x: tableLeft, y: y - headerH },
    end: { x: tableLeft + tableWidth, y: y - headerH },
    thickness: 0.45,
    color: RULE,
  });
  let x = tableLeft;
  for (const col of cols) {
    const pad = 5;
    const text = col.label;
    const size = FS.tableHeader;
    const tw = fontBold.widthOfTextAtSize(text, size);
    let tx = x + pad;
    if (col.align === 'right') tx = x + col.width - pad - tw;
    if (col.align === 'center') tx = x + (col.width - tw) / 2;
    drawText(page, fontBold, text, tx, y - 14, size, rgb(1, 1, 1));
    x += col.width;
  }
}

function drawItemTableRow(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  tableLeft: number,
  y: number,
  cols: ReadonlyArray<{ width: number; align: 'left' | 'right' | 'center' }>,
  rowH: number,
  row: {
    index: string;
    name: string;
    sku: string;
    availableQtyLabel: string;
    orderQtyLabel: string;
    unitPriceLabel: string;
    location: string;
    muted: boolean;
  },
  options: { last?: boolean } = {},
): void {
  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  const yBottom = y - rowH;
  if (options.last) {
    drawRoundedBottomRect(page, tableLeft, yBottom, tableWidth, rowH, BOX_R, {
      stroke: RULE,
      strokeWidth: 0.55,
    });
  } else {
    // Square body rows: left / right / bottom (top shared with row above)
    page.drawLine({
      start: { x: tableLeft, y },
      end: { x: tableLeft, y: yBottom },
      thickness: 0.45,
      color: RULE,
    });
    page.drawLine({
      start: { x: tableLeft + tableWidth, y },
      end: { x: tableLeft + tableWidth, y: yBottom },
      thickness: 0.45,
      color: RULE,
    });
    page.drawLine({
      start: { x: tableLeft, y: yBottom },
      end: { x: tableLeft + tableWidth, y: yBottom },
      thickness: 0.45,
      color: RULE,
    });
  }

  let x = tableLeft;
  cols.forEach((col, i) => {
    if (i > 0) {
      page.drawLine({
        start: { x, y },
        end: { x, y: yBottom },
        thickness: 0.35,
        color: RULE,
      });
    }
    x += col.width;
  });

  const pad = 5;
  const midY = y - rowH / 2 - 2;
  const color = row.muted ? MUTE : INK;

  // #
  {
    const col = cols[0]!;
    const text = truncate(font, row.index, FS.cell, col.width - pad * 2);
    const tw = font.widthOfTextAtSize(winAnsiSafe(text), FS.cell);
    drawText(page, font, text, tableLeft + (col.width - tw) / 2, midY, FS.cell, color);
  }

  // ITEM — 3 lines: name / sku / available qty
  {
    const col = cols[1]!;
    const itemX = tableLeft + cols[0]!.width + pad;
    const maxW = col.width - pad * 2;
    const line1 = truncate(fontBold, row.name, FS.itemName, maxW);
    const line2 = truncate(font, row.sku ? `SKU: ${row.sku}` : 'SKU: —', FS.itemMeta, maxW);
    const line3 = truncate(
      font,
      row.availableQtyLabel ? `Avail: ${row.availableQtyLabel}` : 'Avail: —',
      FS.itemMeta,
      maxW,
    );
    drawText(page, fontBold, line1, itemX, y - 13, FS.itemName, color);
    drawText(page, font, line2, itemX, y - 26, FS.itemMeta, MUTE);
    drawText(page, font, line3, itemX, y - 38, FS.itemMeta, MUTE);
  }

  // ORDER QTY / UNIT PRICE — vertically centered
  const qtyPrice = [row.orderQtyLabel, row.unitPriceLabel];
  let colX = tableLeft + cols[0]!.width + cols[1]!.width;
  for (let i = 0; i < 2; i += 1) {
    const col = cols[i + 2]!;
    const size = FS.cell;
    const text = truncate(font, qtyPrice[i] ?? '', size, col.width - pad * 2);
    const tw = font.widthOfTextAtSize(winAnsiSafe(text), size);
    let tx = colX + pad;
    if (col.align === 'right') tx = colX + col.width - pad - tw;
    if (col.align === 'center') tx = colX + (col.width - tw) / 2;
    drawText(page, font, text, tx, midY, size, color);
    colX += col.width;
  }

  // LOCATION — larger bold for warehouse picking
  {
    const col = cols[4]!;
    const size = FS.location;
    const text = truncate(fontBold, row.location || '—', size, col.width - pad * 2);
    const tw = fontBold.widthOfTextAtSize(winAnsiSafe(text), size);
    let tx = colX + pad;
    if (col.align === 'right') tx = colX + col.width - pad - tw;
    if (col.align === 'center') tx = colX + (col.width - tw) / 2;
    drawText(page, fontBold, text, tx, midY - 1, size, color);
  }
}

function buildSectionLines(
  font: PDFFont,
  fontBold: PDFFont,
  w: number,
  rows: Array<[string, string]>,
): Array<{ text: string; bold: boolean }> {
  const lines: Array<{ text: string; bold: boolean }> = [];
  const pad = 14;
  for (const [label, value] of rows) {
    if (label) {
      const labelText = `${label}: `;
      const labelW = font.widthOfTextAtSize(labelText, FS.sectionLabel);
      const firstMax = Math.max(40, w - pad - labelW);
      const wrapped = wrapLines(fontBold, value || '—', FS.sectionValue, firstMax);
      const restMax = Math.max(40, w - pad);
      if (wrapped.length === 0) {
        lines.push({ text: `${labelText}—`, bold: false });
        continue;
      }
      lines.push({ text: `${labelText}${wrapped[0]}`, bold: false });
      for (let i = 1; i < wrapped.length; i += 1) {
        // Continuation lines indent under the value
        const cont = wrapLines(fontBold, wrapped[i]!, FS.sectionValue, restMax);
        for (const part of cont) lines.push({ text: part, bold: true });
      }
    } else {
      for (const part of wrapLines(font, value || '—', FS.sectionValue, Math.max(40, w - pad))) {
        lines.push({ text: part, bold: false });
      }
    }
  }
  return lines;
}

function measureSectionBoxHeight(
  font: PDFFont,
  fontBold: PDFFont,
  w: number,
  rows: Array<[string, string]>,
): number {
  const titleH = 18;
  const lines = buildSectionLines(font, fontBold, w, rows);
  const body = 12 + lines.length * 12 + 8;
  return titleH + body;
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
  rows: Array<[string, string]>,
): void {
  const titleH = 18;
  drawRoundedRect(page, x, y, w, h, BOX_R, {
    stroke: RULE,
    strokeWidth: 0.9,
  });
  drawRoundedTopRect(page, x, y + h - titleH, w, titleH, BOX_R, {
    fill: HEADER_BG,
  });
  drawText(page, fontBold, title, x + 7, y + h - 12, FS.sectionTitle, rgb(1, 1, 1));

  const lines = buildSectionLines(font, fontBold, w, rows);
  const bodyTop = y + h - titleH - 14;
  const maxLines = Math.max(1, Math.floor((h - titleH - 16) / 12));
  lines.slice(0, maxLines).forEach((line, i) => {
    const rowY = bodyTop - i * 12;
    // First segment of a labeled row mixes mute label + bold value; draw as one bold line for wrap safety
    if (line.text.includes(': ')) {
      const idx = line.text.indexOf(': ');
      const labelPart = line.text.slice(0, idx + 2);
      const valuePart = line.text.slice(idx + 2);
      drawText(page, font, labelPart, x + 7, rowY, FS.sectionLabel, MUTE);
      const labelW = font.widthOfTextAtSize(labelPart, FS.sectionLabel);
      drawText(
        page,
        fontBold,
        truncate(fontBold, valuePart, FS.sectionValue, w - labelW - 16),
        x + 7 + labelW,
        rowY,
        FS.sectionValue,
      );
    } else {
      drawText(
        page,
        fontBold,
        truncate(fontBold, line.text, FS.sectionValue, w - 14),
        x + 7,
        rowY,
        FS.sectionValue,
      );
    }
  });
}

function drawSigWriteLine(
  page: PDFPage,
  x1: number,
  x2: number,
  y: number,
  dotted: boolean,
): void {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: dotted ? 0.55 : 0.75,
    color: dotted ? rgb(0.55, 0.55, 0.55) : RULE,
    ...(dotted ? { dashArray: [1.2, 1.8] as number[] } : {}),
  });
}

function drawSigBlock(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  w: number,
  label: string,
  opts: { name?: string; date?: string; rowGap?: number } = {},
): void {
  const rowGap = opts.rowGap ?? 26;
  const labelText = `${label} :`;
  const dateText = 'Date :';
  const labelW = Math.max(
    font.widthOfTextAtSize(labelText, FS.sig),
    font.widthOfTextAtSize(dateText, FS.sig),
  ) + 8;
  const lineStart = x + labelW;
  const lineEnd = x + w;
  const maxFillW = Math.max(8, lineEnd - lineStart - 4);

  const name = winAnsiSafe((opts.name || '').trim());
  const dateFill = winAnsiSafe((opts.date || '').trim());
  const hasName = Boolean(name);
  const hasDate = Boolean(dateFill && dateFill !== '—');

  drawText(page, font, labelText, x, y, FS.sig, INK);
  if (hasName) {
    drawText(
      page,
      font,
      truncate(font, name, FS.sig, maxFillW),
      lineStart + 2,
      y,
      FS.sig,
      INK,
    );
  } else {
    // Dotted write-in line only when the field is empty
    drawSigWriteLine(page, lineStart, lineEnd, y + 1, true);
  }

  const dateY = y - rowGap;
  drawText(page, font, dateText, x, dateY, FS.sig, INK);
  if (hasDate) {
    drawText(
      page,
      font,
      truncate(font, dateFill, FS.sig, maxFillW),
      lineStart + 2,
      dateY,
      FS.sig,
      INK,
    );
  } else {
    drawSigWriteLine(page, lineStart, lineEnd, dateY + 1, true);
  }
}

function drawFooter(
  page: PDFPage,
  font: PDFFont,
  pageNo: number,
  pageCount: number,
): void {
  drawCentered(
    page,
    font,
    `Page ${pageNo} of ${pageCount}`,
    PAGE_W / 2,
    MARGIN + 6,
    FS.page,
    MUTE,
  );
}
