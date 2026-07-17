import { DELIVERY_METHODS } from '../constants/deliveryMethods';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsDealerSnapshot,
  ShipmentMode,
} from '../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../types/staff-logistics';
import { boxChargeableWeight, chargeableWeight } from './logisticsBooking';

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

export interface ShippingLabelViewModel {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  destinationCity: string;
  numberOfBoxes: number;
  boxIndex: number;
  boxTotal: number;
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
}

export function shippingLabelBarcodeBars(seed: string): number[] {
  const chars = seed || 'YESWEIGH';
  const bars: number[] = [];
  for (let i = 0; i < 48; i += 1) {
    const code = chars.charCodeAt(i % chars.length) + i;
    bars.push(1 + (code % 3));
  }
  return bars;
}

export function buildShippingLabelViewModel(input: {
  fromName: string;
  fromAddress: string;
  dealer: LogisticsDealerSnapshot;
  deliveryAddress: string;
  numberOfBoxes: number;
  boxIndex: number;
  grossWeightKg: number;
  chargeableWeightKg: number;
  partnerId: LogisticsPartnerId | string;
  consignmentNo: string;
  bookingBranch: string;
  bookingDate: string;
  bookingTime?: string;
  bookedBy?: string;
  shipmentMode: ShipmentMode;
}): ShippingLabelViewModel {
  const boxTotal = Math.max(1, input.numberOfBoxes);
  return {
    fromName: input.fromName.trim() || 'YESWEIGH',
    fromAddress: input.fromAddress.trim() || '—',
    toName: input.dealer.name.trim() || '—',
    toAddress: input.deliveryAddress.trim() || '—',
    destinationCity: resolveDestinationCity(input.dealer, input.deliveryAddress),
    numberOfBoxes: boxTotal,
    boxIndex: input.boxIndex,
    boxTotal,
    grossWeightKg: input.grossWeightKg,
    chargeableWeightKg: input.chargeableWeightKg,
    partnerId: input.partnerId,
    partnerLabel: logisticsPartnerLabel(input.partnerId),
    partnerImage: logisticsPartnerImage(input.partnerId),
    consignmentNo: input.consignmentNo.trim() || '—',
    bookingBranch: input.bookingBranch.trim() || '—',
    bookingDate: formatShippingBookingDate(input.bookingDate),
    bookingTime: input.bookingTime?.trim() || formatShippingBookingTime(),
    bookedBy: (input.bookedBy ?? 'YESWEIGH').trim() || 'YESWEIGH',
    shipmentMode: input.shipmentMode,
  };
}

/** Build one 100×150 mm shipping-label view model per box (or one for envelope). */
export function buildShippingLabelsFromBooking(booking: LogisticsBooking): ShippingLabelViewModel[] {
  const count = booking.shipmentMode === 'envelope'
    ? 1
    : Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1);
  const bookingTime = booking.createdAt
    ? formatShippingBookingTime(new Date(booking.createdAt))
    : formatShippingBookingTime();
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
      grossWeightKg: booking.shipmentMode === 'envelope' ? booking.actualWeightKg : boxActual,
      chargeableWeightKg: booking.shipmentMode === 'envelope' ? chargeable : boxChargeable,
      partnerId: booking.partnerId,
      consignmentNo: booking.consignmentNo || booking.trackingNo,
      bookingBranch: booking.branch,
      bookingDate: booking.bookingDate,
      bookingTime,
      bookedBy: booking.createdByName?.trim() || 'YESWEIGH',
      shipmentMode: booking.shipmentMode,
    });
  });
}
