import { Capacitor } from '@capacitor/core';
import { WhatsAppShare } from 'whatsapp-share';
import { FIRM_NAME } from '../constants/brand';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { LogisticsBooking, LogisticsBookingDraft, LogisticsDealerSnapshot } from '../types/logistics-dispatch';
import { chargeableWeight, shipmentModeLabel } from './logisticsBooking';
import { openWhatsAppWithText, uploadWhatsAppShareCard } from './whatsappShareCard';

export type CourierSlipViewModel = {
  partnerLabel: string;
  consignmentNo: string;
  orderRef: string;
  dealerName: string;
  dealerCode: string;
  contactLine: string;
  deliveryAddress: string;
  serviceType: string;
  branch: string;
  shipmentType: string;
  pieces: string;
  weightLabel: string;
  bookingDate: string;
  shipFrom: string;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode image.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not encode image.'));
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

export function buildCourierSlipFromBooking(booking: LogisticsBooking): CourierSlipViewModel {
  const isEnvelope = booking.shipmentMode === 'envelope';
  const weight = isEnvelope
    ? '—'
    : `${chargeableWeight(booking).toFixed(2)} kg`;
  return {
    partnerLabel: logisticsPartnerLabel(booking.partnerId),
    consignmentNo: booking.consignmentNo.trim() || '—',
    orderRef: booking.orderRef.trim() || '—',
    dealerName: booking.dealer.name,
    dealerCode: booking.dealer.code,
    contactLine: [booking.dealer.contactPerson, booking.dealer.mobile].filter(Boolean).join(' · '),
    deliveryAddress: booking.deliveryAddress,
    serviceType: booking.serviceType || '—',
    branch: booking.branch || '—',
    shipmentType: shipmentModeLabel(booking.shipmentMode),
    pieces: isEnvelope ? '1 envelope' : `${booking.numberOfBoxes || booking.boxes.length || 1} box(es)`,
    weightLabel: weight,
    bookingDate: booking.bookingDate || '—',
    shipFrom: booking.shipFromAddress || '—',
  };
}

export function buildCourierSlipFromDraft(input: {
  partnerId: LogisticsPartnerId;
  draft: LogisticsBookingDraft;
  dealer: LogisticsDealerSnapshot;
  deliveryAddress: string;
  piecesLabel: string;
  weightKg: number;
}): CourierSlipViewModel {
  const isEnvelope = input.draft.shipmentMode === 'envelope';
  return {
    partnerLabel: logisticsPartnerLabel(input.partnerId),
    consignmentNo: input.draft.consignmentNo.trim() || '—',
    orderRef: input.draft.consignmentNo.trim() || '—',
    dealerName: input.dealer.name,
    dealerCode: input.dealer.code,
    contactLine: [input.dealer.contactPerson, input.dealer.mobile].filter(Boolean).join(' · '),
    deliveryAddress: input.deliveryAddress,
    serviceType: input.draft.serviceType || '—',
    branch: input.draft.branch || '—',
    shipmentType: shipmentModeLabel(input.draft.shipmentMode),
    pieces: input.piecesLabel,
    weightLabel: isEnvelope ? '—' : `${input.weightKg.toFixed(2)} kg`,
    bookingDate: input.draft.bookingDate || '—',
    shipFrom: '—',
  };
}

/** Renders a shareable courier-slip PNG (not a thermal label). */
export async function buildCourierSlipPngBlob(slip: CourierSlipViewModel): Promise<Blob> {
  const W = 900;
  const pad = 36;
  const contentW = W - pad * 2;

  // Measure height dynamically via a throwaway pass.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create courier slip image.');

  const addressLines = (() => {
    ctx.font = '28px Arial, Helvetica, sans-serif';
    return wrapText(ctx, slip.deliveryAddress, contentW, 5);
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
      + 56 // partner
      + 28 // title
      + 28
      + 150 // track block
      + 28
      + 36 // consign label + name
      + 28 // contact
      + addressLines.length * 34
      + 28
      + metaRows.length * 42
      + (slip.shipFrom && slip.shipFrom !== '—' ? 90 : 0)
      + 56 // footer
      + pad,
  );
  canvas.height = H;

  // Card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Orange accent bar
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

  // Consignment / barcode block
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

  // Decorative bars
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

  // Consignee
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

  // Divider
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
    let vx = pad + contentW * 0.42;
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

  // Footer
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

export function courierSlipImageFileName(slip: CourierSlipViewModel): string {
  const safe = (slip.consignmentNo || slip.orderRef || 'slip')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 40);
  return `courier-slip-${safe}.png`;
}

/** Share the courier slip as an image (system share / WhatsApp). Never sends to label printer. */
export async function shareCourierSlipImage(slip: CourierSlipViewModel): Promise<void> {
  const blob = await buildCourierSlipPngBlob(slip);
  const fileName = courierSlipImageFileName(slip);

  if (Capacitor.isNativePlatform()) {
    const dataBase64 = await blobToBase64(blob);
    await WhatsAppShare.shareImage({
      dataBase64,
      fileName,
      mimeType: 'image/png',
    });
    return;
  }

  const file = new File([blob], fileName, { type: 'image/png' });
  const shareData: ShareData = {
    files: [file],
    title: `Courier slip · ${slip.consignmentNo}`,
  };
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    await navigator.share(shareData);
    return;
  }

  const imageUrl = await uploadWhatsAppShareCard(blob, fileName);
  const shareText = [
    `Courier slip · ${slip.partnerLabel}`,
    `Consignment: ${slip.consignmentNo}`,
    `${slip.dealerName}${slip.dealerCode ? ` (${slip.dealerCode})` : ''}`,
    imageUrl,
    FIRM_NAME,
  ].filter(Boolean).join('\n');
  openWhatsAppWithText(shareText);
}
