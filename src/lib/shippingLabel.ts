import { FIRM_NAME } from '../constants/brand';
import { DELIVERY_METHODS } from '../constants/deliveryMethods';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsDealerSnapshot,
  ShipmentBox,
  ShipmentMode,
} from '../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../types/staff-logistics';
import { encodeCode128 } from './code128';
import {
  boxChargeableWeight,
  boxDimensionsLabel,
  chargeableWeight,
} from './logisticsBooking';
import { resolveReceiverPhoneFromSnapshot } from './logisticsDealers';

export const SHIPPING_LABEL_CONTENTS = 'Genuine Spare Part';
export const SHIPPING_LABEL_PAYMENT_MODE = 'PREPAID';
export const SHIPPING_LABEL_FIRM = FIRM_NAME;

/** Short metric titles that fit one line in a 4-column label grid. */
export const SHIPPING_LABEL_METRIC_TITLES = {
  boxes: 'BOXES',
  boxNumber: 'BOX NO.',
  dimensions: 'DIMENSIONS',
  contents: 'CONTENTS',
  grossWeight: 'GROSS WT',
  chargeableWeight: 'CHG. WT',
  transport: 'TRANSPORT',
  payment: 'PAYMENT',
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove repeated company / contact phrases from an address body when they
 * already appear as the party name (or elsewhere on the label).
 */
export function stripDuplicateAddressPhrases(
  address: string,
  phrases: Array<string | null | undefined>,
): string {
  const cleaned = address.replace(/\r\n/g, '\n').trim();
  if (!cleaned || cleaned === '—') return '—';

  const uniquePhrases = [...new Set(
    phrases
      .map(p => (p ?? '').replace(/\s+/g, ' ').trim())
      .filter(p => p.length >= 3 && p !== '—'),
  )].sort((a, b) => b.length - a.length);

  if (!uniquePhrases.length) return cleaned;

  const stripFromChunk = (chunk: string): string => {
    let working = chunk;
    for (const phrase of uniquePhrases) {
      const pattern = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
      working = working.replace(new RegExp(pattern, 'gi'), ' ');
    }
    return working
      .replace(/\s*,\s*,+/g, ',')
      .replace(/^[\s,;.\-/]+|[\s,;.\-/]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const isRedundant = (chunk: string): boolean => {
    const norm = normalizePhrase(chunk);
    if (!norm) return true;
    return uniquePhrases.some(phrase => {
      const np = normalizePhrase(phrase);
      if (!np) return false;
      // Exact / near-exact match, or one fully contains the other.
      if (norm === np) return true;
      if (np.length >= 6 && (norm.includes(np) || np.includes(norm))) return true;
      // Contact first-token match ("Riyas" vs "Mr. Riyas K")
      const phraseTokens = np.split(' ').filter(t => t.length >= 3);
      const chunkTokens = norm.split(' ').filter(t => t.length >= 3);
      if (
        phraseTokens.length &&
        chunkTokens.length <= 3
        && phraseTokens.some(t => chunkTokens.includes(t))
        && chunkTokens.every(t => phraseTokens.includes(t) || ['mr', 'mrs', 'ms', 'dr'].includes(t))
      ) {
        return true;
      }
      return false;
    });
  };

  const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    // Prefer comma-aware cleanup so "Name, COMPANY, Street" drops COMPANY.
    const parts = line.includes(',')
      ? line.split(',').map(part => stripFromChunk(part)).filter(part => part && !isRedundant(part))
      : [];
    if (parts.length) {
      kept.push(parts.join(', '));
      continue;
    }
    const stripped = stripFromChunk(line);
    if (stripped && !isRedundant(stripped)) kept.push(stripped);
  }

  const result = kept.join('\n').replace(/\n{2,}/g, '\n').trim();
  return result || '—';
}

/** Normalize address for label columns (prefer existing newlines; else wrap on commas). */
export function formatShippingAddressLines(address: string, maxLines = 5): string {
  const trimmed = address.replace(/\r\n/g, '\n').trim();
  if (!trimmed || trimmed === '—') return '—';
  if (trimmed.includes('\n')) {
    return trimmed
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, maxLines)
      .join('\n');
  }
  const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    const next = current ? `${current}, ${part}` : part;
    if (current && next.length > 34) {
      lines.push(current);
      current = part;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.join('\n') || trimmed;
}

/** Best-effort city from a multiline address when Zoho city is missing. */
export function extractDestinationCity(address: string): string {
  const lines = address
    .split(/\n|,/)
    .map(part => part.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^\d{5,6}$/.test(line)) continue;
    if (/india/i.test(line)) continue;
    if (/^(street|road|rd|lane|ln|plot|near|opp)/i.test(line)) continue;
    if (line.length >= 2 && line.length <= 40 && !/\d{3,}/.test(line)) {
      return line;
    }
  }
  return lines.find(line => line.length <= 40) || '—';
}

/**
 * Best-effort "City, State" from a multiline / comma address
 * (e.g. "Manjeri, Kerala, 676121" or separate lines).
 */
export function extractCityState(address: string): string | null {
  const lines = address
    .split(/\n/)
    .map(part => part.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^india$/i.test(line)) continue;
    const match = line.match(/^([^,]+),\s*([^,]+?)(?:,\s*\d{5,6})?$/);
    if (!match) continue;
    const city = match[1].trim();
    const state = match[2].trim();
    if (!city || !state || /^\d+$/.test(state)) continue;
    if (city.length > 40 || state.length > 40) continue;
    if (/^(street|road|rd|lane|ln|plot|near|opp)/i.test(city)) continue;
    if (city.toLowerCase() === state.toLowerCase()) return city;
    return `${city}, ${state}`;
  }
  return null;
}

export function resolveDestinationCity(
  dealer: Pick<LogisticsDealerSnapshot, 'destinationCity' | 'shippingAddress' | 'billingAddress'>,
  deliveryAddress: string,
): string {
  const stored = dealer.destinationCity?.trim();
  if (stored) return stored;
  return extractDestinationCity(deliveryAddress || dealer.shippingAddress || dealer.billingAddress || '');
}

/** Card / list label: prefer "City, State", else city only. */
export function resolveDestinationPlace(
  dealer: Pick<LogisticsDealerSnapshot, 'destinationCity' | 'shippingAddress' | 'billingAddress'>,
  deliveryAddress: string,
): string {
  const address = deliveryAddress || dealer.shippingAddress || dealer.billingAddress || '';
  const cityState = extractCityState(address);
  if (cityState) return cityState;
  const city = resolveDestinationCity(dealer, deliveryAddress);
  if (!city || city === '—') return '—';
  if (city.includes(',')) {
    const [left, right] = city.split(',').map(part => part.trim());
    if (left && right && left.toLowerCase() === right.toLowerCase()) return left;
    return city;
  }
  const stateFromAddress = address.match(
    new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]+([A-Za-z][A-Za-z .]{1,40})`, 'i'),
  );
  const state = stateFromAddress?.[1]?.trim();
  if (state && !/^\d+$/.test(state) && state.toLowerCase() !== city.toLowerCase()) {
    return `${city}, ${state}`;
  }
  return city;
}

export function logisticsPartnerImage(partnerId: LogisticsPartnerId | string): string | null {
  return DELIVERY_METHODS.find(method => method.id === partnerId)?.image ?? null;
}

export function formatShippingBookingTime(date = new Date()): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatShippingBookingDate(isoDate: string, fallback = new Date()): string {
  const trimmed = isoDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
  }
  if (trimmed) return trimmed;
  return fallback.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Combined booking date + time for the label footer (e.g. "20 Jul 2026, 11:09 am"). */
export function formatShippingBookingDateTime(
  isoDate: string,
  timeSource: Date | string = new Date(),
): string {
  const datePart = formatShippingBookingDate(
    isoDate,
    timeSource instanceof Date ? timeSource : new Date(),
  );
  const timePart = typeof timeSource === 'string' && timeSource.trim()
    ? timeSource.trim()
    : formatShippingBookingTime(timeSource instanceof Date ? timeSource : new Date());
  return `${datePart}, ${timePart}`;
}

/** Always printed on shipping labels. */
export const SHIPPING_LABEL_BOOKED_BY = 'YESWEIGH';

export interface ShippingLabelViewModel {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  /** Receiver phone (shipping → billing → contact → any). Empty when unknown. */
  toPhone: string;
  destinationCity: string;
  numberOfBoxes: number;
  boxIndex: number;
  boxTotal: number;
  boxDimensions: string;
  contents: string;
  transportMode: string;
  paymentMode: string;
  grossWeightKg: number;
  chargeableWeightKg: number;
  partnerId: LogisticsPartnerId | string;
  partnerLabel: string;
  partnerImage: string | null;
  consignmentNo: string;
  bookingBranch: string;
  bookingDate: string;
  bookingTime: string;
  bookedBy: string;
  shipmentMode: ShipmentMode;
  firmName: string;
  /**
   * Public HTTPS URL for this box's inside photo (QR under FROM).
   * Prefer a durable Firebase Storage token URL when available.
   */
  insidePhotoUrl: string | null;
  /** Storage path for resolving a durable public URL at print time. */
  insidePhotoStoragePath: string | null;
}

/** Prefer an https URL suitable for a scannable QR (skip data:/blob: previews). */
export function publicInsidePhotoUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() || '';
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** Inside photo (`photos[0]`) fields for a shipping-label view model. */
export function shippingLabelInsidePhoto(
  box?: Pick<ShipmentBox, 'photos'> | null,
): { insidePhotoUrl: string | null; insidePhotoStoragePath: string | null } {
  const photo = box?.photos?.[0];
  return {
    insidePhotoUrl: publicInsidePhotoUrl(photo?.url),
    insidePhotoStoragePath: photo?.storagePath?.trim() || null,
  };
}

/** Compact L×B×H for narrow metric cells, with cm unit. */
function compactBoxDimensions(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '—') return '—';
  if (/^envelope$/i.test(trimmed)) return 'Envelope';
  const dims = trimmed
    .replace(/\s*[×x]\s*/gi, '×')
    .replace(/\s*cm\s*$/i, '')
    .trim();
  if (!dims) return '—';
  return `${dims} cm`;
}

function resolveBoxDimensions(
  shipmentMode: ShipmentMode,
  box: ShipmentBox | undefined,
  lengthCm?: string | number | null,
  widthCm?: string | number | null,
  heightCm?: string | number | null,
): string {
  if (shipmentMode === 'envelope') return 'Envelope';
  if (box) return compactBoxDimensions(boxDimensionsLabel(box));
  const l = lengthCm == null || lengthCm === '' ? null : Number(lengthCm);
  const w = widthCm == null || widthCm === '' ? null : Number(widthCm);
  const h = heightCm == null || heightCm === '' ? null : Number(heightCm);
  if (l && w && h) return compactBoxDimensions(`${l}×${w}×${h}`);
  return '—';
}

export type ShippingLabelMetricIcon =
  | 'boxes'
  | 'boxNumber'
  | 'dimensions'
  | 'contents'
  | 'weight'
  | 'transport'
  | 'payment';

export type ShippingLabelMetricCell = {
  title: string;
  value: string;
  icon: ShippingLabelMetricIcon;
};

/**
 * Metric grid rows (CONTENTS column removed).
 * Top: 3 cells · Bottom: 4 cells.
 */
export function shippingLabelMetricRows(label: ShippingLabelViewModel): ShippingLabelMetricCell[][] {
  const t = SHIPPING_LABEL_METRIC_TITLES;
  const boxLabel = label.shipmentMode === 'envelope'
    ? '1/1'
    : `${label.boxIndex}/${label.boxTotal}`;
  const boxCount = label.shipmentMode === 'envelope'
    ? 'Envelope'
    : String(label.numberOfBoxes);
  return [
    [
      { title: t.boxes, value: boxCount, icon: 'boxes' },
      { title: t.boxNumber, value: boxLabel, icon: 'boxNumber' },
      { title: t.dimensions, value: label.boxDimensions, icon: 'dimensions' },
    ],
    [
      { title: t.grossWeight, value: `${label.grossWeightKg.toFixed(2)} kg`, icon: 'weight' },
      { title: t.chargeableWeight, value: `${label.chargeableWeightKg.toFixed(2)} kg`, icon: 'weight' },
      { title: t.transport, value: label.transportMode, icon: 'transport' },
      { title: t.payment, value: label.paymentMode, icon: 'payment' },
    ],
  ];
}

/** Flat list of metric cells (row-major). */
export function shippingLabelMetricCells(label: ShippingLabelViewModel): ShippingLabelMetricCell[] {
  return shippingLabelMetricRows(label).flat();
}

/**
 * Code 128 module runs for the AWB / consignment number.
 * Alternating bar, space, bar, space… widths in modules (starts with a bar).
 */
export function shippingLabelBarcodeBars(value: string): number[] {
  return encodeCode128(value || '0');
}

/** ST Courier public AWB tracking page (keyword = consignment / AWB). */
export function stCourierTrackingUrl(consignmentNo: string): string {
  const keyword = consignmentNo.trim();
  return `http://www.erpstcourier.com/awb_tracking2.php?keyword=${encodeURIComponent(keyword || '0')}`;
}

/**
 * Partner tracking URL encoded in the TO-column QR (null when not applicable).
 * ST Courier → http://www.erpstcourier.com/awb_tracking2.php?keyword={AWB}
 */
export function buildShippingLabelTrackingUrl(
  label: Pick<ShippingLabelViewModel, 'partnerId' | 'consignmentNo'>,
): string | null {
  const awb = label.consignmentNo?.trim();
  if (!awb || awb === '—') return null;
  if (label.partnerId === 'st_courier') return stCourierTrackingUrl(awb);
  return null;
}

export function buildShippingLabelViewModel(input: {
  fromName: string;
  fromAddress: string;
  dealer: LogisticsDealerSnapshot;
  deliveryAddress: string;
  numberOfBoxes: number;
  boxIndex: number;
  box?: ShipmentBox;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
  serviceType?: string;
  paymentMode?: string;
  contents?: string;
  grossWeightKg: number;
  chargeableWeightKg: number;
  partnerId: LogisticsPartnerId | string;
  consignmentNo: string;
  bookingBranch: string;
  bookingDate: string;
  bookingTime?: string;
  bookedBy?: string;
  shipmentMode: ShipmentMode;
  insidePhotoUrl?: string | null;
  insidePhotoStoragePath?: string | null;
}): ShippingLabelViewModel {
  const boxTotal = Math.max(1, input.numberOfBoxes);
  const fromBoxPhoto = shippingLabelInsidePhoto(input.box);
  const insidePhotoUrl = publicInsidePhotoUrl(input.insidePhotoUrl) ?? fromBoxPhoto.insidePhotoUrl;
  const insidePhotoStoragePath = (
    input.insidePhotoStoragePath?.trim()
    || fromBoxPhoto.insidePhotoStoragePath
    || null
  );
  const transport = (input.serviceType || 'SURFACE').trim().toUpperCase() || 'SURFACE';
  const resolvedPhone = resolveReceiverPhoneFromSnapshot(input.dealer);
  const toPhone = resolvedPhone === '—' ? '' : resolvedPhone;
  const contact = input.dealer.contactPerson?.trim() || '';
  const toName = input.dealer.name.trim() || '—';
  const fromName = input.fromName.trim() || 'YESWEIGH';
  let delivery = input.deliveryAddress.trim() || '—';
  // Avoid repeating the phone inside the address body when we print Ph: below.
  if (toPhone) {
    const phonePattern = escapeRegExp(toPhone).replace(/\s+/g, '\\s*');
    delivery = delivery.replace(new RegExp(phonePattern, 'gi'), ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim() || '—';
  }
  // Drop company / contact phrases from the address body (contact person is not printed).
  delivery = stripDuplicateAddressPhrases(delivery, [toName, contact, input.dealer.name]);
  const toAddress = delivery && delivery !== '—' ? delivery : '—';

  // FROM: site name is the heading — strip firm / site repeats from the address body.
  const fromAddress = stripDuplicateAddressPhrases(input.fromAddress.trim() || '—', [
    fromName,
    SHIPPING_LABEL_FIRM,
    FIRM_NAME,
    'Interweighing',
    'YesWeigh',
    'YESWEIGH',
  ]);

  return {
    fromName,
    fromAddress,
    toName,
    toAddress,
    toPhone,
    destinationCity: resolveDestinationCity(input.dealer, input.deliveryAddress),
    numberOfBoxes: boxTotal,
    boxIndex: input.boxIndex,
    boxTotal,
    boxDimensions: resolveBoxDimensions(
      input.shipmentMode,
      input.box,
      input.lengthCm,
      input.widthCm,
      input.heightCm,
    ),
    contents: (input.contents || SHIPPING_LABEL_CONTENTS).trim() || SHIPPING_LABEL_CONTENTS,
    transportMode: transport,
    paymentMode: (input.paymentMode || SHIPPING_LABEL_PAYMENT_MODE).trim().toUpperCase()
      || SHIPPING_LABEL_PAYMENT_MODE,
    grossWeightKg: input.grossWeightKg,
    chargeableWeightKg: input.chargeableWeightKg,
    partnerId: input.partnerId,
    partnerLabel: logisticsPartnerLabel(input.partnerId),
    partnerImage: logisticsPartnerImage(input.partnerId),
    consignmentNo: input.consignmentNo.trim() || '—',
    bookingBranch: input.bookingBranch.trim() || '—',
    bookingDate: formatShippingBookingDate(input.bookingDate),
    bookingTime: formatShippingBookingDateTime(
      input.bookingDate,
      input.bookingTime?.trim() || formatShippingBookingTime(),
    ),
    bookedBy: SHIPPING_LABEL_BOOKED_BY,
    shipmentMode: input.shipmentMode,
    firmName: SHIPPING_LABEL_FIRM,
    insidePhotoUrl,
    insidePhotoStoragePath,
  };
}

/** Build one 100×150 mm shipping-label view model per box (or one for envelope). */
export function buildShippingLabelsFromBooking(booking: LogisticsBooking): ShippingLabelViewModel[] {
  const count = booking.shipmentMode === 'envelope'
    ? 1
    : Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1);
  const timeSource = booking.createdAt ? new Date(booking.createdAt) : new Date();
  const chargeable = chargeableWeight(booking);

  return Array.from({ length: count }, (_, index) => {
    const box = booking.boxes[index];
    const boxActual = box?.weightKg ?? booking.actualWeightKg;
    const boxChargeable = box ? boxChargeableWeight(box) : chargeable;
    return buildShippingLabelViewModel({
      fromName: STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'YESWEIGH',
      fromAddress: booking.shipFromAddress || '—',
      dealer: booking.dealer,
      deliveryAddress: booking.deliveryAddress,
      numberOfBoxes: count,
      boxIndex: index + 1,
      box,
      serviceType: booking.serviceType,
      grossWeightKg: booking.shipmentMode === 'envelope' ? booking.actualWeightKg : boxActual,
      chargeableWeightKg: booking.shipmentMode === 'envelope' ? chargeable : boxChargeable,
      partnerId: booking.partnerId,
      consignmentNo: booking.consignmentNo || booking.trackingNo,
      bookingBranch: booking.branch,
      bookingDate: booking.bookingDate,
      bookingTime: formatShippingBookingTime(timeSource),
      shipmentMode: booking.shipmentMode,
    });
  });
}
