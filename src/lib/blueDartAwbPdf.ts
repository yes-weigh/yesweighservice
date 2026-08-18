/**
 * Blue Dart A4T-style waybill (shipper / consignee / accounts copies)
 * filled from a logistics booking when the official GenerateWayBill PDF
 * was not stored.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { FIRM_NAME, FIRM_TRADE_NAME } from '../constants/brand';
import {
  BLUEDART_PARTNER_TO_SERVICE,
  isBlueDartLogisticsPartnerId,
} from '../constants/logisticsPartners';
import { BLUE_DART_SERVICE_META } from '../types/logistics-courier-rates';
import { DEFAULT_SUPPORT_COURIER } from '../constants/supportCourier';
import type { BlueDartPublicConfig } from '../types/blue-dart-api';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import { loadBlueDartPincode, blueDartCityNameFromPincodeDoc } from './blueDartPincodes';
import { encodeCode39 } from './code39';
import { boxDimensionsLabel, chargeableWeight } from './logisticsBooking';
import { resolveReceiverPhoneFromSnapshot } from './logisticsDealers';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 12;
const COPY_H = 392;
const INK = rgb(0.08, 0.08, 0.08);
const RULE = rgb(0.12, 0.12, 0.12);
const RED = rgb(0.72, 0.08, 0.1);
const MUTED = rgb(0.28, 0.28, 0.28);

export const BLUE_DART_LOGO_URL = '/logistics/bluedart-logo.png?v=2';
/** Official Blue Dart wordmark — A4 AWB header only (yellow square stays on the card). */
export const BLUE_DART_AWB_WORDMARK_URL = '/logistics/bluedart-wordmark.png?v=1';

export type BlueDartAwbPdfInput = {
  awb: string;
  originArea: string;
  originLocation: string;
  destinationArea: string;
  destinationLocation: string;
  productLabel: string;
  customerCode: string;
  shipperCompany: string;
  shipperSender: string;
  shipperAddress: string;
  shipperPin: string;
  shipperPhone: string;
  consigneeCompany: string;
  consigneeAttn: string;
  consigneeAddress: string;
  consigneePin: string;
  consigneePhone: string;
  pickupDate: string;
  pickupTime: string;
  shipDate: string;
  doxNonDox: string;
  pieceCount: string;
  dimsLabel: string;
  actualKg: string;
  volumetricKg: string;
  chargeableKg: string;
  declaredValue: string;
  transaction: string;
  creditRef: string;
};

const COPY_LABELS = ['SHIPPER COPY', "CONSIGNEE'S COPY", 'EDP/ACCOUNTS COPY'] as const;

function pin6(raw: string | null | undefined): string {
  return /\b(\d{6})\b/.exec(String(raw ?? ''))?.[1] || '';
}

function maskPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function formatInr(value: number): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPickupDate(isoDate: string | null | undefined, fallbackIso: string): string {
  const raw = String(isoDate || fallbackIso || '').trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (ymd) return `${Number(ymd[3])}/${Number(ymd[2])}/${ymd[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatShipDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${hr}:${m}:00 ${ampm}`;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
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
  return lines;
}

function strokeRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  thickness = 0.7,
): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: RULE,
    borderWidth: thickness,
  });
}

function lineH(page: PDFPage, x1: number, x2: number, y: number): void {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.6,
    color: RULE,
  });
}

function lineV(page: PDFPage, x: number, y1: number, y2: number): void {
  page.drawLine({
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness: 0.6,
    color: RULE,
  });
}

function text(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  color = INK,
): void {
  const v = value.trim();
  if (!v) return;
  page.drawText(v, { x, y, size, font, color });
}

function drawCode39(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const runs = encodeCode39(value || '0');
  const modules = runs.reduce((sum, w) => sum + w, 0) || 1;
  const quiet = 10;
  const total = modules + quiet * 2;
  const moduleW = Math.max(0.8, width / total);
  const barW = total * moduleW;
  let bx = x + Math.max(0, (width - barW) / 2) + quiet * moduleW;
  for (let i = 0; i < runs.length; i += 1) {
    const w = runs[i]! * moduleW;
    if (i % 2 === 0) {
      page.drawRectangle({
        x: bx,
        y,
        width: Math.max(0.6, w),
        height,
        color: INK,
      });
    }
    bx += w;
  }
}

async function embedBlueDartLogo(pdf: PDFDocument): Promise<PDFImage | undefined> {
  try {
    const res = await fetch(BLUE_DART_AWB_WORDMARK_URL);
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return pdf.embedPng(bytes);
  } catch {
    return undefined;
  }
}

function drawBlueDartLogo(
  page: PDFPage,
  logo: PDFImage | undefined,
  cellX: number,
  cellBottom: number,
  cellW: number,
  cellH: number,
): void {
  if (!logo) return;
  const padX = 6;
  const padY = 4;
  const maxW = Math.max(12, cellW - padX * 2);
  const maxH = Math.max(12, cellH - padY * 2);
  const scale = Math.min(maxW / logo.width, maxH / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  page.drawImage(logo, {
    x: cellX + (cellW - w) / 2,
    y: cellBottom + (cellH - h) / 2,
    width: w,
    height: h,
  });
}

function productLabelForPartner(partnerId: string): string {
  if (!isBlueDartLogisticsPartnerId(partnerId)) return 'DOMESTIC';
  return BLUE_DART_SERVICE_META[BLUEDART_PARTNER_TO_SERVICE[partnerId]].label.toUpperCase();
}

function locCode(raw: string | null | undefined): string {
  const u = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(u)) return u;
  return /\b([A-Z]{3})\b/.exec(u)?.[1] || '';
}

/** Destination loc code printed on the Blue Dart AWB / label (not the track city name). */
export function blueDartDocumentDestinationCode(
  booking: Pick<LogisticsBooking, 'blueDartPickup'>,
): string {
  return locCode(booking.blueDartPickup?.destinationLocation)
    || locCode(booking.blueDartPickup?.destinationArea);
}

/** City name from BdService CAREADESC for the destination pin / loc (e.g. WAI → Wai). */
export async function resolveBlueDartTrackingDestination(
  booking: LogisticsBooking,
): Promise<string> {
  let code = blueDartDocumentDestinationCode(booking);
  if (!code) {
    const input = await fillBlueDartDestinationFromSlip(
      booking,
      buildBlueDartAwbInput(booking, null),
    );
    code = locCode(input.destinationLocation) || locCode(input.destinationArea);
  }
  const pin = pin6(booking.deliveryAddress || booking.dealer.shippingAddress);
  const row = await loadBlueDartPincode(pin);
  return blueDartCityNameFromPincodeDoc(row) || code;
}

/** Fill DestinationArea / DestinationLocation from the booking slip, then pincode master. */
export async function fillBlueDartDestinationFromSlip(
  booking: LogisticsBooking,
  input: BlueDartAwbPdfInput,
): Promise<BlueDartAwbPdfInput> {
  if (locCode(input.destinationArea) && locCode(input.destinationLocation)) return input;
  const pin = pin6(booking.deliveryAddress || booking.dealer.shippingAddress);
  const row = await loadBlueDartPincode(pin);
  const fromPin = locCode(row?.sfcLocIb)
    || locCode(row?.apxLocIb)
    || locCode(row?.area)
    || locCode(row?.hubCode);
  const area = locCode(input.destinationArea) || locCode(row?.area) || fromPin;
  const location = locCode(input.destinationLocation) || fromPin || area;
  return {
    ...input,
    destinationArea: area,
    destinationLocation: location,
  };
}

export function buildBlueDartAwbInput(
  booking: LogisticsBooking,
  settings?: Pick<BlueDartPublicConfig, 'customerCode' | 'customerName' | 'originArea'> | null,
): BlueDartAwbPdfInput {
  const awb = (booking.consignmentNo || booking.trackingNo || '').replace(/\D/g, '');
  const shipFrom = booking.shipFromAddress || '';
  const pickup = booking.blueDartPickup;
  const destAddr = booking.deliveryAddress || booking.dealer.shippingAddress || '';
  const pieces = Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1);
  const actual = Number(booking.actualWeightKg) || 0;
  const volumetric = Number(booking.volumetricWeightKg) || 0;
  const chargeable = chargeableWeight(booking);
  const declared = Number(booking.invoiceValueInr);
  const dims = booking.boxes
    .map(box => boxDimensionsLabel(box))
    .filter(row => row && row !== '—')
    .join(' · ');
  const originArea = (
    pickup?.originArea
    || settings?.originArea
    || ''
  ).trim().toUpperCase();
  const originLocation = originArea === 'COK' ? 'VTL' : originArea;
  const destHint = String(booking.courierTrack?.destination || '').trim().toUpperCase();
  const destCode = destHint.length === 3 ? destHint : '';
  const destinationArea = (pickup?.destinationArea || destCode || '').trim().toUpperCase();
  const destinationLocation = (
    pickup?.destinationLocation
    || destinationArea
  ).trim().toUpperCase();
  const booked = booking.bookingDate || booking.createdAt || '';

  return {
    awb,
    originArea,
    originLocation,
    destinationArea,
    destinationLocation,
    productLabel: productLabelForPartner(booking.partnerId),
    customerCode: (settings?.customerCode || '').trim(),
    shipperCompany: (settings?.customerName || FIRM_NAME).trim().toUpperCase(),
    shipperSender: FIRM_TRADE_NAME.replace(/\s+/g, ''),
    shipperAddress: shipFrom.replace(/\s+/g, ' ').trim(),
    shipperPin: pin6(pickup?.pickupPin || shipFrom),
    shipperPhone: maskPhone(DEFAULT_SUPPORT_COURIER.phone),
    consigneeCompany: (booking.dealer.name || '').trim(),
    consigneeAttn: (booking.dealer.contactPerson || booking.dealer.name || '').trim(),
    consigneeAddress: destAddr.replace(/\s+/g, ' ').trim(),
    consigneePin: pin6(destAddr),
    consigneePhone: maskPhone(
      resolveReceiverPhoneFromSnapshot(booking.dealer) || booking.dealer.mobile,
    ),
    pickupDate: formatPickupDate(pickup?.pickupDate, booked),
    pickupTime: (pickup?.pickupTime || '1600').replace(/\D/g, '').slice(0, 4) || '1600',
    shipDate: formatShipDate(booked),
    doxNonDox: booking.shipmentMode === 'envelope' ? '1' : '2',
    pieceCount: pieces.toFixed(2),
    dimsLabel: dims,
    actualKg: actual > 0 ? actual.toFixed(2) : '',
    volumetricKg: volumetric > 0 ? volumetric.toFixed(2) : '',
    chargeableKg: chargeable > 0 ? chargeable.toFixed(2) : '',
    declaredValue: Number.isFinite(declared) && declared > 0 ? formatInr(declared) : '',
    transaction: booking.freightBillingMode === 'fod' ? '1' : '2',
    creditRef: (booking.orderRef || booking.invoiceNumber || '').trim(),
  };
}

function drawCopy(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  input: BlueDartAwbPdfInput,
  top: number,
  copyLabel: string,
  logo?: PDFImage,
): void {
  const { regular, bold } = fonts;
  const x = MARGIN;
  const w = PAGE_W - MARGIN * 2;
  const bottom = top - COPY_H;
  strokeRect(page, x, bottom, w, COPY_H, 1.1);

  const headerH = 44;
  const headerBottom = top - headerH;
  const originW = w * 0.36;
  const domesticW = w * 0.30;
  const gapW = w * 0.08;
  const logoX = x + originW + domesticW + gapW;
  lineH(page, x, x + w, headerBottom);
  lineV(page, x + originW, headerBottom, top);
  lineV(page, x + originW + domesticW, headerBottom, top);
  lineV(page, logoX, headerBottom, top);

  text(page, regular, 'Origin :', x + 6, top - 16, 7, MUTED);
  text(
    page,
    bold,
    [input.originArea, input.originLocation].filter(Boolean).join(' / '),
    x + 50,
    top - 17,
    10,
  );
  text(page, regular, 'Destination :', x + 6, top - 32, 7, MUTED);
  const dest = [input.destinationArea, input.destinationLocation].filter(Boolean).join(' / ');
  text(page, bold, dest ? `${dest} /` : '', x + 64, top - 33, 10);

  const domesticX = x + originW;
  const domesticLabel = 'DOMESTIC';
  const domesticSize = 16;
  const domesticWidth = bold.widthOfTextAtSize(domesticLabel, domesticSize);
  text(
    page,
    bold,
    domesticLabel,
    domesticX + (domesticW - domesticWidth) / 2,
    top - 20,
    domesticSize,
  );
  const risk = 'NON NEGOTIABLE - AT OWNER\'S RISK';
  const riskW = regular.widthOfTextAtSize(risk, 5.5);
  text(
    page,
    regular,
    risk,
    domesticX + (domesticW - riskW) / 2,
    top - 34,
    5.5,
    MUTED,
  );

  drawBlueDartLogo(page, logo, logoX, headerBottom, x + w - logoX, headerH);

  const partyTop = headerBottom;
  const partyH = 118;
  const partyBottom = partyTop - partyH;
  const mid = x + w / 2;
  lineH(page, x, x + w, partyBottom);
  lineV(page, mid, partyBottom, partyTop);

  text(page, bold, 'SHIPPER', x + 6, partyTop - 11, 8);
  text(page, regular, 'Customer Code', x + 6, partyTop - 22, 6, MUTED);
  text(page, bold, input.customerCode, x + 68, partyTop - 22, 8);
  text(page, regular, 'Company', x + 6, partyTop - 34, 6, MUTED);
  text(page, bold, input.shipperCompany.slice(0, 36), x + 48, partyTop - 34, 8);
  text(page, regular, 'Sender', x + 6, partyTop - 46, 6, MUTED);
  text(page, bold, input.shipperSender, x + 42, partyTop - 46, 8);
  text(page, regular, 'Address', x + 6, partyTop - 58, 6, MUTED);
  const shipLines = wrapLines(regular, input.shipperAddress, 7, mid - x - 52, 4);
  shipLines.forEach((line, i) => {
    text(page, regular, line, x + 48, partyTop - 58 - i * 9, 7);
  });
  text(page, regular, 'Pincode', x + 6, partyBottom + 16, 6, MUTED);
  text(page, bold, input.shipperPin, x + 48, partyBottom + 16, 8);
  text(page, regular, 'Mob. No.', x + 110, partyBottom + 16, 6, MUTED);
  text(page, bold, input.shipperPhone, x + 150, partyBottom + 16, 8);

  text(page, bold, 'CONSIGNEE', mid + 6, partyTop - 11, 8);
  text(page, regular, 'Company', mid + 6, partyTop - 22, 6, MUTED);
  text(page, bold, input.consigneeCompany.slice(0, 34), mid + 48, partyTop - 22, 8);
  text(page, regular, 'Attn', mid + 6, partyTop - 34, 6, MUTED);
  text(page, bold, input.consigneeAttn.slice(0, 34), mid + 32, partyTop - 34, 8);
  text(page, regular, 'Address', mid + 6, partyTop - 46, 6, MUTED);
  const consLines = wrapLines(regular, input.consigneeAddress, 7, x + w - mid - 52, 4);
  consLines.forEach((line, i) => {
    text(page, regular, line, mid + 48, partyTop - 46 - i * 9, 7);
  });
  text(page, regular, 'Pincode', mid + 6, partyBottom + 16, 6, MUTED);
  text(page, bold, input.consigneePin, mid + 48, partyBottom + 16, 8);
  text(page, regular, 'Mob. No.', mid + 110, partyBottom + 16, 6, MUTED);
  text(page, bold, input.consigneePhone, mid + 150, partyBottom + 16, 8);

  const midTop = partyBottom;
  const midH = 92;
  const midBottom = midTop - midH;
  const col1 = x + 150;
  const col2 = x + w - 150;
  lineH(page, x, x + w, midBottom);
  lineV(page, col1, midBottom, midTop);
  lineV(page, col2, midBottom, midTop);

  text(page, regular, 'Pickup Date:', x + 6, midTop - 12, 6, MUTED);
  text(page, bold, input.pickupDate, x + 62, midTop - 12, 8);
  text(page, regular, 'Time :', x + 6, midTop - 24, 6, MUTED);
  text(page, bold, input.pickupTime, x + 36, midTop - 24, 8);
  text(page, regular, 'Ship Date :', x + 6, midTop - 36, 6, MUTED);
  text(page, bold, input.shipDate, x + 56, midTop - 36, 7);
  text(page, regular, 'PU Emp. :', x + 6, midTop - 48, 6, MUTED);
  text(page, regular, 'PUR No. :', x + 6, midTop - 60, 6, MUTED);
  text(page, regular, 'Signature :', x + 6, midTop - 78, 6, MUTED);

  const barcodeW = col2 - col1 - 12;
  drawCode39(page, input.awb, col1 + 6, midTop - 50, barcodeW, 34);
  const awbW = bold.widthOfTextAtSize(input.awb, 12);
  text(page, bold, input.awb, col1 + (col2 - col1 - awbW) / 2, midTop - 66, 12);

  text(page, regular, 'Dox / Non Dox :', col2 + 6, midTop - 12, 6, MUTED);
  text(page, bold, input.doxNonDox, col2 + 78, midTop - 12, 8);
  text(page, regular, 'No. of Pkgs :', col2 + 6, midTop - 24, 6, MUTED);
  text(page, bold, input.pieceCount, col2 + 70, midTop - 24, 8);
  text(page, regular, 'Act. Wt(in Kg):', col2 + 6, midTop - 36, 6, MUTED);
  text(page, bold, input.actualKg, col2 + 78, midTop - 36, 8);
  text(page, regular, 'Dim. Wt(in Kg):', col2 + 6, midTop - 48, 6, MUTED);
  text(page, bold, input.volumetricKg, col2 + 78, midTop - 48, 8);
  text(page, regular, 'Chg. Wt(in Kg):', col2 + 6, midTop - 60, 6, MUTED);
  text(page, bold, input.chargeableKg, col2 + 78, midTop - 60, 8);
  text(page, regular, 'Declared Value :', col2 + 6, midTop - 78, 6, MUTED);
  text(page, bold, input.declaredValue, col2 + 82, midTop - 78, 8);

  const refTop = midBottom;
  const refH = 36;
  const refBottom = refTop - refH;
  lineH(page, x, x + w, refBottom);
  text(page, regular, 'Description (Said to contain)', x + 6, refTop - 10, 6, MUTED);
  text(page, regular, 'Shipper\'s Ref No.', x + 210, refTop - 10, 6, MUTED);
  text(page, bold, input.creditRef, x + 210, refTop - 24, 9);
  text(page, regular, 'Transaction', x + 400, refTop - 10, 6, MUTED);
  text(page, bold, input.transaction, x + 400, refTop - 24, 9);
  if (input.dimsLabel) {
    text(page, regular, `Dim. ${input.dimsLabel}`, x + 6, refTop - 24, 7);
  }

  const terms = [
    'I/We hereby agree to the terms and conditions set forth on the reverse of Shipper\'s copy of this non-negotiable waybill (also available on',
    'www.bluedart.com) and warrant that information contained on this waybill is true and correct. This shipment does not contain any cash or equivalent.',
    'The company\'s liability on this shipment is limited to Rs. 5000/- or cost of reconstruction whichever is lower. Track @ www.bluedart.com OR 1860-233-1234.',
  ];
  terms.forEach((line, i) => {
    text(page, regular, line, x + 6, refBottom - 11 - i * 8, 5.5, RED);
  });

  strokeRect(page, x + 6, bottom + 8, 210, 36, 0.6);
  text(page, regular, 'Received shipment in good condition.', x + 10, bottom + 32, 6);
  text(page, regular, 'Consignee Sign                    Name', x + 10, bottom + 12, 6, MUTED);
  text(page, regular, 'Shipper\'s Sign', x + w - 118, bottom + 32, 6, MUTED);
  strokeRect(page, x + w - 120, bottom + 8, 108, 36, 0.6);

  const label = copyLabel;
  const labelW = 14;
  page.drawRectangle({
    x: x + w - labelW,
    y: bottom + 50,
    width: labelW,
    height: 120,
    color: rgb(0.93, 0.93, 0.93),
    borderColor: RULE,
    borderWidth: 0.5,
  });
  const chars = [...label.replace(/\s+/g, ' ')];
  const step = 118 / Math.max(chars.length, 1);
  chars.forEach((ch, i) => {
    text(page, bold, ch, x + w - 10, bottom + 160 - i * step, 6);
  });
}

export async function buildBlueDartAwbPdfBytes(input: BlueDartAwbPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };
  const logo = await embedBlueDartLogo(pdf);

  const page1 = pdf.addPage([PAGE_W, PAGE_H]);
  drawCopy(page1, fonts, input, PAGE_H - 10, COPY_LABELS[0], logo);

  const page2 = pdf.addPage([PAGE_W, PAGE_H]);
  drawCopy(page2, fonts, input, PAGE_H - 10, COPY_LABELS[1], logo);
  drawCopy(page2, fonts, input, PAGE_H - 10 - COPY_H - 8, COPY_LABELS[2], logo);

  return pdf.save();
}

export async function buildBlueDartAwbPdfFromBooking(
  booking: LogisticsBooking,
  settings?: Pick<BlueDartPublicConfig, 'customerCode' | 'customerName' | 'originArea'> | null,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!isBlueDartLogisticsPartnerId(booking.partnerId)) {
    throw new Error('This booking is not a Blue Dart shipment.');
  }
  const input = await fillBlueDartDestinationFromSlip(
    booking,
    buildBlueDartAwbInput(booking, settings),
  );
  if (!input.awb) throw new Error('Blue Dart AWB number is missing.');
  const bytes = await buildBlueDartAwbPdfBytes(input);
  return { bytes, fileName: `${input.awb}-A4T.pdf` };
}
