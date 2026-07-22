import { Capacitor } from '@capacitor/core';
import { WhatsAppShare } from 'whatsapp-share';
import { FIRM_NAME } from '../constants/brand';
import { DEFAULT_SUPPORT_COURIER } from '../constants/supportCourier';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsDealerSnapshot,
  ShipmentBox,
  ShipmentBoxDraft,
  ShipmentMode,
} from '../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../types/staff-logistics';
import { chargeableWeight, shipmentModeLabel } from './logisticsBooking';
import { resolveReceiverPhoneFromSnapshot } from './logisticsDealers';
import { pdfjs } from './pdfjsSetup';
import {
  collapseRepeatedAddressPhrases,
  formatShippingAddressLines,
  SHIPPING_LABEL_CONTENTS,
  SHIPPING_LABEL_FIRM,
  stripDuplicateAddressPhrases,
} from './shippingLabel';
import {
  buildCourierSlipPdfBlob,
  courierSlipPdfFileName,
} from './courierSlipPdf';
import { openWhatsAppWithText, uploadWhatsAppShareCard } from './whatsappShareCard';

export type CourierSlipViewModel = {
  partnerId: LogisticsPartnerId | string;
  partnerLabel: string;
  consignmentNo: string;
  orderRef: string;
  dealerName: string;
  dealerCode: string;
  contactPerson: string;
  contactLine: string;
  deliveryAddress: string;
  /** Optimised multiline To address (shipping-label style). */
  toAddress: string;
  toMobile: string;
  fromName: string;
  fromAddress: string;
  fromMobile: string;
  /** Staff who generated the slip (shown above Consignor's Signature). */
  generatedBy: string;
  serviceType: string;
  branch: string;
  /** Always "Cochin" in BRANCH / CUSTOMER CODE. */
  branchCustomerCode: string;
  /** Box L×B×H shown bottom-right in BRANCH / CUSTOMER CODE (empty for envelope). */
  boxDimensions: string;
  shipmentType: string;
  shipmentMode: ShipmentMode;
  pieces: string;
  weightLabel: string;
  bookingDate: string;
  contents: string;
  isDox: boolean;
  isAir: boolean;
  /** @deprecated use fromAddress */
  shipFrom: string;
};

/** Format as L×B×H cm (breadth = width). */
function formatLbh(lengthCm: number, breadthCm: number, heightCm: number): string {
  if (!lengthCm || !breadthCm || !heightCm) return '';
  const l = Number.isInteger(lengthCm) ? String(lengthCm) : lengthCm.toFixed(1);
  const b = Number.isInteger(breadthCm) ? String(breadthCm) : breadthCm.toFixed(1);
  const h = Number.isInteger(heightCm) ? String(heightCm) : heightCm.toFixed(1);
  return `${l}×${b}×${h} cm`;
}

function boxLbhLinesFromDraftBoxes(boxes: ShipmentBoxDraft[]): string {
  const total = Math.max(1, boxes.length);
  return boxes
    .map((box, index) => {
      const l = Number.parseFloat(box.lengthCm);
      const b = Number.parseFloat(box.widthCm);
      const h = Number.parseFloat(box.heightCm);
      const dims = formatLbh(l, b, h);
      const label = `box ${index + 1}/${total}`;
      return dims ? `${label}  ${dims}` : label;
    })
    .join('\n');
}

function boxLbhLinesFromBoxes(boxes: ShipmentBox[]): string {
  const total = Math.max(1, boxes.length);
  return boxes
    .map((box, index) => {
      const dims = box.lengthCm && box.widthCm && box.heightCm
        ? formatLbh(box.lengthCm, box.widthCm, box.heightCm)
        : '';
      const label = `box ${index + 1}/${total}`;
      return dims ? `${label}  ${dims}` : label;
    })
    .join('\n');
}

/** BRANCH / CUSTOMER CODE label is always Cochin (box lines drawn separately). */
function buildBranchCustomerCode(): string {
  return 'Cochin';
}

/** Same cleanup as shipping labels — drop repeats / phone, then line-wrap on commas. */
function optimizeCourierFromAddress(address: string, fromName: string): string {
  return formatShippingAddressLines(
    collapseRepeatedAddressPhrases(
      stripDuplicateAddressPhrases(address.trim() || '—', [
        fromName,
        SHIPPING_LABEL_FIRM,
        FIRM_NAME,
        'Interweighing',
        'YesWeigh',
        'YESWEIGH',
        'Cochin',
        'Head Office',
      ]),
    ),
    4,
  );
}

function optimizeCourierToAddress(input: {
  deliveryAddress: string;
  dealerName: string;
  contactPerson: string;
  toMobile: string;
}): string {
  let delivery = input.deliveryAddress.replace(/\r\n/g, '\n').trim() || '—';
  const phone = input.toMobile.trim();
  if (phone && phone !== '—') {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 8) {
      delivery = delivery
        .replace(new RegExp(digits.split('').join('\\D*'), 'g'), ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .replace(/\s{2,}/g, ' ')
        .trim() || '—';
    }
  }
  delivery = stripDuplicateAddressPhrases(delivery, [
    input.dealerName,
    input.contactPerson,
  ]);
  delivery = collapseRepeatedAddressPhrases(delivery);
  // Street/city only — contact person is not printed in the To address block.
  return formatShippingAddressLines(delivery, 4);
}

function isAirService(serviceType: string): boolean {
  return /\bair\b/i.test(serviceType.trim());
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode file.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not encode file.'));
    reader.readAsDataURL(blob);
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 6,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['—'];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${last.replace(/\s+\S*$/, '')}…`;
  }
  return lines.length ? lines : ['—'];
}

function drawRoundedRect(
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

/** Decorative barcode bars from a seed (visual only — not for scanning). */
function barcodeBars(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < 48; i += 1) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    bars.push((hash % 3) + 1);
  }
  return bars;
}

function buildContents(input: {
  pieces: string;
  shipmentMode: ShipmentMode;
}): string {
  // Narrow "Contents & Quantity" cell on the ST form — keep it short.
  const short = SHIPPING_LABEL_CONTENTS.replace(/^Genuine\s+/i, '').trim();
  const parts = [short || SHIPPING_LABEL_CONTENTS, input.pieces].filter(v => v && v !== '—');
  return parts.join('\n') || short;
}

export function buildCourierSlipFromBooking(booking: LogisticsBooking): CourierSlipViewModel {
  const isEnvelope = booking.shipmentMode === 'envelope';
  const weight = isEnvelope
    ? '—'
    : `${chargeableWeight(booking).toFixed(2)} kg`;
  const pieces = isEnvelope
    ? '1 envelope'
    : `${booking.numberOfBoxes || booking.boxes.length || 1} box(es)`;
  const siteLabel = STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || FIRM_NAME;
  const boxDimensions = booking.shipmentMode === 'box' ? boxLbhLinesFromBoxes(booking.boxes) : '';
  const toMobile = resolveReceiverPhoneFromSnapshot(booking.dealer);
  const fromAddress = optimizeCourierFromAddress(
    booking.shipFromAddress || FIRM_NAME,
    siteLabel,
  );
  const toAddress = optimizeCourierToAddress({
    deliveryAddress: booking.deliveryAddress,
    dealerName: booking.dealer.name,
    contactPerson: booking.dealer.contactPerson || '',
    toMobile,
  });
  return {
    partnerId: booking.partnerId,
    partnerLabel: logisticsPartnerLabel(booking.partnerId),
    consignmentNo: booking.consignmentNo.trim() || '—',
    orderRef: booking.orderRef.trim() || '—',
    dealerName: booking.dealer.name,
    dealerCode: booking.dealer.code,
    contactPerson: booking.dealer.contactPerson || '',
    contactLine: [booking.dealer.contactPerson, booking.dealer.mobile].filter(Boolean).join(' · '),
    deliveryAddress: booking.deliveryAddress,
    toAddress,
    toMobile,
    fromName: FIRM_NAME,
    fromAddress,
    fromMobile: DEFAULT_SUPPORT_COURIER.phone,
    generatedBy: (booking.createdByName || '').trim() || '—',
    serviceType: booking.serviceType || '—',
    branch: booking.branch || '—',
    branchCustomerCode: buildBranchCustomerCode(),
    boxDimensions,
    shipmentType: shipmentModeLabel(booking.shipmentMode),
    shipmentMode: booking.shipmentMode,
    pieces,
    weightLabel: weight,
    bookingDate: booking.bookingDate || '—',
    contents: buildContents({
      pieces,
      shipmentMode: booking.shipmentMode,
    }),
    isDox: isEnvelope,
    isAir: isAirService(booking.serviceType),
    shipFrom: fromAddress || '—',
  };
}

export function buildCourierSlipFromDraft(input: {
  partnerId: LogisticsPartnerId;
  draft: LogisticsBookingDraft;
  dealer: LogisticsDealerSnapshot;
  deliveryAddress: string;
  piecesLabel: string;
  weightKg: number;
  fromName?: string;
  fromAddress?: string;
  fromMobile?: string;
  /** Display name of the staff user generating the slip. */
  generatedBy?: string;
}): CourierSlipViewModel {
  const isEnvelope = input.draft.shipmentMode === 'envelope';
  const siteLabel = (
    input.fromName
    || STAFF_LOGISTICS_SITE_LABELS[input.draft.shipFromSite]
    || FIRM_NAME
  ).trim();
  const rawFromAddress = (input.fromAddress || FIRM_NAME).trim();
  const boxDimensions = input.draft.shipmentMode === 'box'
    ? boxLbhLinesFromDraftBoxes(input.draft.boxes)
    : '';
  const toMobile = resolveReceiverPhoneFromSnapshot(input.dealer);
  const fromAddress = optimizeCourierFromAddress(rawFromAddress, siteLabel);
  const toAddress = optimizeCourierToAddress({
    deliveryAddress: input.deliveryAddress,
    dealerName: input.dealer.name,
    contactPerson: input.dealer.contactPerson || '',
    toMobile,
  });
  return {
    partnerId: input.partnerId,
    partnerLabel: logisticsPartnerLabel(input.partnerId),
    consignmentNo: input.draft.consignmentNo.trim() || '—',
    orderRef: input.draft.consignmentNo.trim() || '—',
    dealerName: input.dealer.name,
    dealerCode: input.dealer.code,
    contactPerson: input.dealer.contactPerson || '',
    contactLine: [input.dealer.contactPerson, input.dealer.mobile].filter(Boolean).join(' · '),
    deliveryAddress: input.deliveryAddress,
    toAddress,
    toMobile,
    fromName: FIRM_NAME,
    fromAddress,
    fromMobile: (input.fromMobile || DEFAULT_SUPPORT_COURIER.phone).trim(),
    generatedBy: (input.generatedBy || '').trim() || '—',
    serviceType: input.draft.serviceType || '—',
    branch: input.draft.branch || '—',
    branchCustomerCode: buildBranchCustomerCode(),
    boxDimensions,
    shipmentType: shipmentModeLabel(input.draft.shipmentMode),
    shipmentMode: input.draft.shipmentMode,
    pieces: input.piecesLabel,
    weightLabel: isEnvelope ? '—' : `${input.weightKg.toFixed(2)} kg`,
    bookingDate: input.draft.bookingDate || '—',
    contents: buildContents({
      pieces: input.piecesLabel,
      shipmentMode: input.draft.shipmentMode,
    }),
    isDox: isEnvelope,
    isAir: isAirService(input.draft.serviceType),
    shipFrom: fromAddress || '—',
  };
}

export function usesStCourierSlipTemplate(slip: CourierSlipViewModel): boolean {
  return slip.partnerId === 'st_courier';
}

/** Generic shareable PNG for non–ST Courier partners. */
async function buildGenericCourierSlipPngBlob(slip: CourierSlipViewModel): Promise<Blob> {
  const W = 900;
  const pad = 36;
  const contentW = W - pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create courier slip image.');

  const addressLines = (() => {
    ctx.font = '28px Arial, Helvetica, sans-serif';
    return wrapText(ctx, slip.toAddress || slip.deliveryAddress, contentW, 5);
  })();

  const metaRows: Array<[string, string]> = [
    ['Order ref', slip.orderRef],
    ['Service', slip.serviceType],
    ['Branch', slip.branch],
    ['Shipment', slip.shipmentType],
    ['Pieces', slip.pieces],
    ['Weight', slip.weightLabel],
    ['Booking date', slip.bookingDate],
  ].filter(([, v]) => v && v !== '—') as Array<[string, string]>;

  const H = Math.max(
    980,
    pad
      + 56
      + 28
      + 28
      + 150
      + 28
      + 36
      + 28
      + addressLines.length * 34
      + 28
      + metaRows.length * 42
      + (slip.shipFrom && slip.shipFrom !== '—' ? 90 : 0)
      + 56
      + pad,
  );
  canvas.height = H;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f97316';
  ctx.fillRect(0, 0, 12, H);

  let y = pad;

  ctx.fillStyle = '#111827';
  ctx.font = '800 40px Arial, Helvetica, sans-serif';
  ctx.fillText(slip.partnerLabel.toUpperCase(), pad, y + 36);
  y += 56;

  ctx.fillStyle = '#64748b';
  ctx.font = '700 18px Arial, Helvetica, sans-serif';
  ctx.fillText('COURIER SLIP', pad, y + 18);
  y += 40;

  drawRoundedRect(ctx, pad, y, contentW, 140, 14);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#64748b';
  ctx.font = '700 14px Arial, Helvetica, sans-serif';
  ctx.fillText('CONSIGNMENT NO.', pad + 24, y + 28);

  ctx.fillStyle = '#111827';
  ctx.font = '800 36px Arial, Helvetica, sans-serif';
  ctx.fillText(slip.consignmentNo, pad + 24, y + 68);

  const bars = barcodeBars(`${slip.partnerLabel}-${slip.consignmentNo}`);
  let bx = pad + 24;
  const barY = y + 86;
  const barH = 36;
  ctx.fillStyle = '#111827';
  for (const w of bars) {
    if (bx + w > pad + contentW - 24) break;
    ctx.fillRect(bx, barY, w, barH);
    bx += w + 2;
  }
  y += 164;

  ctx.fillStyle = '#64748b';
  ctx.font = '700 14px Arial, Helvetica, sans-serif';
  ctx.fillText('CONSIGN TO', pad, y + 14);
  y += 36;

  ctx.fillStyle = '#111827';
  ctx.font = '800 30px Arial, Helvetica, sans-serif';
  const nameLine = slip.dealerCode
    ? `${slip.dealerName} (${slip.dealerCode})`
    : slip.dealerName;
  for (const line of wrapText(ctx, nameLine, contentW, 2)) {
    ctx.fillText(line, pad, y);
    y += 34;
  }

  if (slip.contactLine) {
    ctx.fillStyle = '#475569';
    ctx.font = '500 22px Arial, Helvetica, sans-serif';
    ctx.fillText(slip.contactLine, pad, y);
    y += 30;
  }

  ctx.fillStyle = '#334155';
  ctx.font = '28px Arial, Helvetica, sans-serif';
  for (const line of addressLines) {
    ctx.fillText(line, pad, y);
    y += 34;
  }
  y += 16;

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(pad + contentW, y);
  ctx.stroke();
  y += 24;

  for (const [label, value] of metaRows) {
    ctx.fillStyle = '#64748b';
    ctx.font = '600 22px Arial, Helvetica, sans-serif';
    ctx.fillText(label, pad, y + 20);
    ctx.fillStyle = '#111827';
    ctx.font = '700 22px Arial, Helvetica, sans-serif';
    const valueLines = wrapText(ctx, value, contentW * 0.55, 2);
    const vx = pad + contentW * 0.42;
    for (let i = 0; i < valueLines.length; i += 1) {
      ctx.fillText(valueLines[i]!, vx, y + 20 + i * 26);
    }
    y += 24 + Math.max(0, valueLines.length - 1) * 26 + 12;
  }

  if (slip.shipFrom && slip.shipFrom !== '—') {
    y += 8;
    ctx.fillStyle = '#64748b';
    ctx.font = '700 14px Arial, Helvetica, sans-serif';
    ctx.fillText('SHIP FROM', pad, y);
    y += 28;
    ctx.fillStyle = '#334155';
    ctx.font = '24px Arial, Helvetica, sans-serif';
    for (const line of wrapText(ctx, slip.shipFrom, contentW, 3)) {
      ctx.fillText(line, pad, y);
      y += 30;
    }
  }

  y = H - pad - 8;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px Arial, Helvetica, sans-serif';
  ctx.fillText(FIRM_NAME, pad, y);
  ctx.textAlign = 'right';
  ctx.fillText('Share only · not a shipping label', pad + contentW, y);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('Could not create courier slip image.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** Render the filled ST Courier PDF page to a PNG for on-screen preview. */
async function renderPdfBlobToPng(pdfBlob: Blob): Promise<Blob> {
  const data = new Uint8Array(await pdfBlob.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: data.slice() }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not render courier slip preview.');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('Could not create courier slip preview.'));
      else resolve(blob);
    }, 'image/png');
  });
}

function buildPdfReadyPlaceholderPng(slip: CourierSlipViewModel): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not create courier slip preview.'));
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f97316';
  ctx.fillRect(0, 0, 10, canvas.height);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 28px Arial, Helvetica, sans-serif';
  ctx.fillText('ST Courier POD PDF ready', 36, 80);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 18px Arial, Helvetica, sans-serif';
  ctx.fillText(`Consignment: ${slip.consignmentNo}`, 36, 130);
  ctx.fillText('Preview unavailable on this device.', 36, 170);
  ctx.fillText('Tap Share to send the filled PDF.', 36, 200);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('Could not create courier slip preview.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/**
 * Preview blob for the Label step UI (always an image so `<img>` works).
 * ST Courier → filled OG.pdf rendered to PNG; others → generic PNG slip.
 */
export async function buildCourierSlipPngBlob(slip: CourierSlipViewModel): Promise<Blob> {
  if (usesStCourierSlipTemplate(slip)) {
    const pdfBlob = await buildCourierSlipPdfBlob(slip);
    try {
      return await renderPdfBlobToPng(pdfBlob);
    } catch {
      // WebView may still choke on pdf.js; PDF share path does not need a preview.
      return buildPdfReadyPlaceholderPng(slip);
    }
  }
  return buildGenericCourierSlipPngBlob(slip);
}

/** Shareable document blob (PDF for ST Courier, PNG otherwise). */
export async function buildCourierSlipShareBlob(slip: CourierSlipViewModel): Promise<{
  blob: Blob;
  fileName: string;
  mimeType: string;
}> {
  if (usesStCourierSlipTemplate(slip)) {
    const blob = await buildCourierSlipPdfBlob(slip);
    return {
      blob,
      fileName: courierSlipPdfFileName(slip),
      mimeType: 'application/pdf',
    };
  }
  const blob = await buildGenericCourierSlipPngBlob(slip);
  return {
    blob,
    fileName: courierSlipImageFileName(slip),
    mimeType: 'image/png',
  };
}

export function courierSlipImageFileName(slip: CourierSlipViewModel): string {
  const safe = (slip.consignmentNo || slip.orderRef || 'slip')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40);
  return `courier-slip-${safe}.png`;
}

/** Share the courier slip (ST Courier PDF / other partners PNG). Never sends to label printer. */
export async function shareCourierSlipImage(slip: CourierSlipViewModel): Promise<void> {
  const { blob, fileName, mimeType } = await buildCourierSlipShareBlob(slip);

  if (Capacitor.isNativePlatform()) {
    const dataBase64 = await blobToBase64(blob);
    await WhatsAppShare.shareImage({
      dataBase64,
      fileName,
      mimeType,
    });
    return;
  }

  const file = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = {
    files: [file],
    title: `Courier slip · ${slip.consignmentNo}`,
  };
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  if (mimeType.startsWith('image/')) {
    try {
      const imageUrl = await uploadWhatsAppShareCard(blob, fileName);
      const shareText = [
        `Courier slip · ${slip.partnerLabel}`,
        `Consignment: ${slip.consignmentNo}`,
        `${slip.dealerName}${slip.dealerCode ? ` (${slip.dealerCode})` : ''}`,
        imageUrl,
        FIRM_NAME,
      ].filter(Boolean).join('\n');
      openWhatsAppWithText(shareText);
      return;
    } catch {
      // fall through
    }
  }

  downloadBlob(blob, fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
