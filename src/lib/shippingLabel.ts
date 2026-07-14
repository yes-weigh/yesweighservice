import { DELIVERY_METHODS } from '../constants/deliveryMethods';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { LogisticsDealerSnapshot, ShipmentMode } from '../types/logistics-dispatch';

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

export function resolveDestinationCity(
  dealer: Pick<LogisticsDealerSnapshot, 'destinationCity' | 'shippingAddress' | 'billingAddress'>,
  deliveryAddress: string,
): string {
  const stored = dealer.destinationCity?.trim();
  if (stored) return stored;
  return extractDestinationCity(deliveryAddress || dealer.shippingAddress || dealer.billingAddress || '');
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
