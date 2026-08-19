/**
 * Professional Blue Dart shipping label — readable type, booking service,
 * no decorative icons. Filled from the same data as the official waybill.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { isBlueDartLogisticsPartnerId } from '../constants/logisticsPartners';
import type { BlueDartPublicConfig } from '../types/blue-dart-api';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import {
  buildBlueDartAwbInput,
  fillBlueDartDestinationFromSlip,
  type BlueDartAwbPdfInput,
} from './blueDartAwbPdf';
import { encodeCode39 } from './code39';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 14;
const INK = rgb(0.07, 0.07, 0.07);
const WHITE = rgb(1, 1, 1);
const RULE = rgb(0.1, 0.1, 0.1);

export const BLUE_DART_WORDMARK_BLACK_URL = '/logistics/bluedart-wordmark-black.png?v=2';

/** A4 design sizes; label is shrink-to-fit 100×150 mm (~0.48×). Keep these large. */
const LABEL = 14;
const VALUE = 20;
const HEAD = 14;
const ADDR_LEAD = 22;

type Fonts = { regular: PDFFont; bold: PDFFont };

type LabelExtra = {
  pur: string;
  collectable: string;
  packType: string;
  commodity: string;
  pickupTime: string;
  pieceIndex: number;
  pieceTotal: number;
};

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

function strokeRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  thickness = 1.1,
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

function lineH(page: PDFPage, x1: number, x2: number, y: number, thickness = 0.95): void {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness,
    color: RULE,
  });
}

function lineV(page: PDFPage, x: number, y1: number, y2: number, thickness = 0.95): void {
  page.drawLine({
    start: { x, y: y1 },
    end: { x, y: y2 },
    thickness,
    color: RULE,
  });
}

function fillBar(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  font: PDFFont,
  size = HEAD,
): void {
  page.drawRectangle({ x, y, width: w, height: h, color: INK });
  const tw = font.widthOfTextAtSize(label, size);
  text(page, font, label, x + Math.max(6, (w - tw) / 2), y + (h - size) / 2 + 0.6, size, WHITE);
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
  const quiet = 8;
  const total = modules + quiet * 2;
  const moduleW = Math.max(0.75, width / total);
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

function formatHhMm(raw: string): string {
  const d = raw.replace(/\D/g, '').padStart(4, '0').slice(0, 4);
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

async function embedBlackWordmark(pdf: PDFDocument): Promise<PDFImage | undefined> {
  try {
    const res = await fetch(BLUE_DART_WORDMARK_BLACK_URL);
    if (!res.ok) return undefined;
    return pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return undefined;
  }
}

function field(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  labelW: number,
  valueMaxW: number,
): void {
  text(page, fonts.bold, label, x, y, LABEL, INK);
  const clipped = wrapLines(fonts.bold, value, VALUE, valueMaxW, 1)[0] || value;
  text(page, fonts.bold, clipped, x + labelW, y - 0.8, VALUE);
}

function kvLine(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  labelW: number,
): void {
  text(page, fonts.bold, label, x, y, LABEL, INK);
  text(page, fonts.bold, value, x + labelW, y - 0.6, VALUE);
}

function drawLabel(
  page: PDFPage,
  fonts: Fonts,
  input: BlueDartAwbPdfInput,
  extra: LabelExtra,
  wordmark?: PDFImage,
): void {
  const { bold } = fonts;
  const x = M;
  const w = PAGE_W - M * 2;
  const top = PAGE_H - M;
  const bottom = M;
  strokeRect(page, x, bottom, w, top - bottom, 1.35);

  const headerH = 56;
  const headerBottom = top - headerH;
  lineH(page, x, x + w, headerBottom, 1.1);

  const express = 'EXPRESS';
  const expressSize = 18;
  const expressW = bold.widthOfTextAtSize(express, expressSize);
  const brandMaxW = w - expressW - 36;
  const brandX = x + 10;

  if (wordmark) {
    const maxH = 32;
    const scale = Math.min(brandMaxW / wordmark.width, maxH / wordmark.height);
    const lw = wordmark.width * scale;
    const lh = wordmark.height * scale;
    page.drawImage(wordmark, {
      x: brandX,
      y: headerBottom + (headerH - lh) / 2,
      width: lw,
      height: lh,
    });
  } else {
    text(page, bold, 'BLUE DART', brandX, headerBottom + 18, 22);
  }
  text(
    page,
    bold,
    express,
    x + w - expressW - 14,
    headerBottom + (headerH - expressSize) / 2,
    expressSize,
  );

  const originH = 36;
  const originBottom = headerBottom - originH;
  const mid = x + w / 2;
  lineH(page, x, x + w, originBottom, 1.1);
  lineV(page, mid, originBottom, headerBottom, 1.1);
  text(page, bold, 'Origin', x + 10, originBottom + 20, LABEL, INK);
  text(
    page,
    bold,
    [input.originArea, input.originLocation].filter(Boolean).join(' / ') || '—',
    x + 72,
    originBottom + 18,
    18,
  );
  text(page, bold, 'Destination', mid + 10, originBottom + 20, LABEL, INK);
  text(
    page,
    bold,
    [input.destinationArea, input.destinationLocation].filter(Boolean).join(' / ') || '—',
    mid + 104,
    originBottom + 18,
    18,
  );

  const partyH = 228;
  const partyBottom = originBottom - partyH;
  lineH(page, x, x + w, partyBottom, 1.1);
  lineV(page, mid, partyBottom, originBottom, 1.1);

  fillBar(page, x, originBottom - 24, mid - x, 24, 'FROM (SHIPPER)', bold, 13);
  fillBar(page, mid, originBottom - 24, x + w - mid, 24, 'TO (CONSIGNEE)', bold, 13);

  const pinY = partyBottom + 42;
  const telY = partyBottom + 18;
  const addrStartY = originBottom - 88;
  const maxAddrLines = Math.max(2, Math.floor((addrStartY - pinY - 18) / ADDR_LEAD));

  const leftW = mid - x - 78;
  text(page, bold, 'Shipper', x + 8, originBottom - 44, LABEL, INK);
  text(page, bold, input.customerCode, x + 78, originBottom - 46, 24);
  field(page, fonts, 'Sender', input.shipperSender, x + 8, originBottom - 68, 70, leftW);
  text(page, bold, 'Address', x + 8, addrStartY, LABEL, INK);
  wrapLines(bold, input.shipperAddress, VALUE, leftW, maxAddrLines).forEach((line, i) => {
    text(page, bold, line, x + 78, addrStartY - i * ADDR_LEAD, VALUE);
  });
  field(page, fonts, 'Pincode', input.shipperPin, x + 8, pinY, 70, 90);
  field(page, fonts, 'Tel/Mob', input.shipperPhone, x + 8, telY, 70, 120);

  const rightW = x + w - mid - 86;
  field(page, fonts, 'TO', input.consigneeCompany, mid + 8, originBottom - 44, 78, rightW);
  field(page, fonts, 'Attention', input.consigneeAttn, mid + 8, originBottom - 68, 78, rightW);
  text(page, bold, 'Address', mid + 8, addrStartY, LABEL, INK);
  wrapLines(bold, input.consigneeAddress, VALUE, rightW, maxAddrLines).forEach((line, i) => {
    text(page, bold, line, mid + 86, addrStartY - i * ADDR_LEAD, VALUE);
  });
  field(page, fonts, 'Pincode', input.consigneePin, mid + 8, pinY, 78, 90);
  field(page, fonts, 'Tel/Mob', input.consigneePhone, mid + 8, telY, 78, 120);

  const deliveryH = 70;
  const deliveryBottom = bottom;
  const deliveryTop = deliveryBottom + deliveryH;
  const trackH = 148;
  const cellH = 56;
  const commH = 40;
  const trackTop = partyBottom - 8;
  const trackBottom = trackTop - trackH;
  const cellBottom = trackBottom - cellH;
  const commBottom = cellBottom - commH;

  const col1 = x + 168;
  const col2 = x + w - 168;
  lineH(page, x, x + w, trackTop, 1.1);
  lineH(page, x, x + w, trackBottom, 1.1);
  lineV(page, col1, trackBottom, trackTop, 1.1);
  lineV(page, col2, trackBottom, trackTop, 1.1);

  kvLine(page, fonts, 'Pickup Date', input.pickupDate, x + 8, trackTop - 22, 96);
  kvLine(page, fonts, 'Time', extra.pickupTime, x + 8, trackTop - 46, 96);
  kvLine(page, fonts, 'Emp#', '', x + 8, trackTop - 70, 96);
  kvLine(page, fonts, 'Sign', '', x + 8, trackTop - 94, 96);
  kvLine(page, fonts, 'Pack type', extra.packType, x + 8, trackTop - 126, 96);

  const piece = `${extra.pieceIndex}/${extra.pieceTotal}`;
  fillBar(page, col1, trackTop - 22, col2 - col1, 22, 'AWB / TRACKING NUMBER', bold, 12);
  const awbMaxW = col2 - col1 - 12;
  let awbSize = 34;
  while (awbSize > 16 && bold.widthOfTextAtSize(input.awb, awbSize) > awbMaxW) {
    awbSize -= 0.5;
  }
  const awbW = bold.widthOfTextAtSize(input.awb, awbSize);
  text(page, bold, input.awb, col1 + (col2 - col1 - awbW) / 2, trackTop - 58, awbSize);
  drawCode39(page, input.awb, col1 + 8, trackBottom + 10, col2 - col1 - 16, 42);

  const specs = [
    { label: 'Dox / Non Dox', value: input.doxNonDox },
    { label: 'No. of Pkg', value: String(extra.pieceTotal) },
    { label: 'Piece', value: piece },
    { label: 'Act Wt (kg)', value: input.actualKg || '0.00' },
    { label: 'Chg Wt (kg)', value: input.chargeableKg || '0.00' },
    { label: 'Dim Wt (kg)', value: input.volumetricKg || '0.00' },
  ];
  specs.forEach((row, i) => {
    const y = trackTop - 22 - i * 20;
    text(page, bold, row.label, col2 + 8, y, 12, INK);
    text(page, bold, row.value, col2 + 108, y - 0.5, 16);
  });

  lineH(page, x, x + w, cellBottom, 1.1);
  const cells = [
    { label: 'Ref #', value: input.creditRef },
    { label: 'Declared Value', value: input.declaredValue || '0.00' },
    { label: 'Collectable Amt', value: extra.collectable },
    { label: 'Transaction', value: input.transaction },
    { label: 'Pack Type', value: extra.packType },
  ];
  const cellW = w / cells.length;
  cells.forEach((cell, i) => {
    const cx = x + i * cellW;
    if (i > 0) lineV(page, cx, cellBottom, trackBottom, 1.1);
    text(page, bold, cell.label, cx + 6, trackBottom - 16, LABEL, INK);
    wrapLines(bold, cell.value || '—', 15, cellW - 12, 2).forEach((line, li) => {
      text(page, bold, line, cx + 6, trackBottom - 36 - li * 16, 15);
    });
  });

  lineH(page, x, x + w, commBottom, 1.1);
  text(page, bold, 'Commodity', x + 8, cellBottom - 16, LABEL, INK);
  text(page, bold, extra.commodity || '—', x + 118, cellBottom - 17, VALUE);

  const gapTop = commBottom;
  const gapBot = deliveryTop;
  const box = Math.min(120, Math.max(72, gapTop - gapBot - 36));
  const boxX = x + 16;
  let boxY = (gapBot + gapTop - box) / 2 + 28;
  boxY = Math.min(gapTop - box - 8, Math.max(gapBot + 8, boxY));
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: box,
    height: box,
    color: INK,
  });
  const pieceSize = 44;
  const pieceLabelW = bold.widthOfTextAtSize(piece, pieceSize);
  text(
    page,
    bold,
    piece,
    boxX + (box - pieceLabelW) / 2,
    boxY + (box - pieceSize) / 2 + 1,
    pieceSize,
    WHITE,
  );

  lineH(page, x, x + w, deliveryTop, 1.1);
  fillBar(page, x, deliveryTop - 24, w, 24, 'DELIVERY DETAILS', bold, 13);
  const d1 = x + w / 3;
  const d2 = x + (2 * w) / 3;
  lineV(page, d1, deliveryBottom, deliveryTop - 24, 1.1);
  lineV(page, d2, deliveryBottom, deliveryTop - 24, 1.1);
  text(page, bold, 'Delivery Date', x + 8, deliveryTop - 42, LABEL, INK);
  text(page, bold, 'Time', d1 + 8, deliveryTop - 42, LABEL, INK);
  text(page, bold, 'Consignee Signature', d2 + 8, deliveryTop - 42, LABEL, INK);
  text(page, bold, 'Name', d2 + 8, deliveryBottom + 14, LABEL, INK);
  page.drawLine({
    start: { x: d2 + 56, y: deliveryBottom + 12 },
    end: { x: x + w - 10, y: deliveryBottom + 12 },
    thickness: 0.7,
    color: RULE,
  });
}

export async function buildBlueDartProfessionalLabelPdfBytes(
  input: BlueDartAwbPdfInput,
  extra: Omit<LabelExtra, 'pieceIndex' | 'pieceTotal'>,
  pieceTotal = 1,
): Promise<Uint8Array> {
  const copies = Math.max(1, Math.round(pieceTotal) || 1);
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await embedBlackWordmark(pdf);
  for (let i = 1; i <= copies; i += 1) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    drawLabel(page, fonts, input, {
      ...extra,
      pieceIndex: i,
      pieceTotal: copies,
    }, logo);
  }
  return pdf.save();
}

export async function buildBlueDartProfessionalLabelPdfFromBooking(
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
  const pieceTotal = Math.max(
    1,
    Math.round(Number(input.pieceCount)) || booking.numberOfBoxes || booking.boxes.length || 1,
  );
  const commodity = booking.shipmentMode === 'envelope'
    ? 'Documents'
    : (input.dimsLabel ? `Non-Dox · ${input.dimsLabel}` : 'Non-Dox');
  const bytes = await buildBlueDartProfessionalLabelPdfBytes(input, {
    pur: (booking.blueDartPickup?.tokenNumber || input.awb).trim(),
    collectable: booking.freightBillingMode === 'fod' ? (input.declaredValue || '0.00') : '0.00',
    packType: booking.shipmentMode === 'envelope' ? 'ENV' : 'BOX',
    commodity,
    pickupTime: formatHhMm(input.pickupTime),
  }, pieceTotal);
  return { bytes, fileName: `${input.awb}-bluedart-label.pdf` };
}
