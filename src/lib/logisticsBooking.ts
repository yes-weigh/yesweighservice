import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsBookingStatus,
  LogisticsDocumentType,
  ShipmentBox,
  ShipmentBoxDraft,
  ShipmentMode,
} from '../types/logistics-dispatch';

/** Partners that support the full booking pipeline today. */
export const ENABLED_LOGISTICS_PARTNER_IDS: ReadonlyArray<LogisticsPartnerId> = [
  'st_courier',
  'trackon',
];

export function isPipelineEnabledPartner(id: string): boolean {
  return ENABLED_LOGISTICS_PARTNER_IDS.includes(id as LogisticsPartnerId);
}

export const LOGISTICS_BOOKING_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'booked', label: 'Booked' },
  { id: 'label_generated', label: 'Label Generated' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const SHIPMENT_MODES: ReadonlyArray<{ id: ShipmentMode; label: string }> = [
  { id: 'box', label: 'Box' },
  { id: 'envelope', label: 'Envelope' },
];

export function shipmentModeLabel(id: ShipmentMode): string {
  return SHIPMENT_MODES.find(item => item.id === id)?.label ?? id;
}

let boxCounter = 0;

export function emptyShipmentBoxDraft(): ShipmentBoxDraft {
  boxCounter += 1;
  return {
    id: `box-${Date.now()}-${boxCounter}`,
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    weightKg: '',
    photos: [],
  };
}

/** Per-box chargeable weight = max(actual, volumetric). */
export function boxChargeableWeight(box: Pick<ShipmentBox, 'weightKg' | 'volumetricWeightKg'>): number {
  return Math.max(box.weightKg || 0, box.volumetricWeightKg || 0);
}

/**
 * Resolve the status a booking should have after a document is generated.
 * Courier Slip ⇒ at least "Booked"; Shipping Label ⇒ at least "Label Generated".
 * Never regresses a booking that is already further along (or terminal).
 */
export function statusForDocument(
  current: LogisticsBookingStatus,
  document: LogisticsDocumentType,
): LogisticsBookingStatus {
  if (current === 'cancelled' || current === 'delivered' || current === 'in_transit') {
    return current;
  }
  const target: LogisticsBookingStatus = document === 'shipping_label' ? 'label_generated' : 'booked';
  return bookingStatusIndex(current) >= bookingStatusIndex(target) ? current : target;
}

export const VOLUMETRIC_WEIGHT_DIVISOR = 5000;

export function computeVolumetricWeight(
  lengthCm: number | null,
  widthCm: number | null,
  heightCm: number | null,
): number {
  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / VOLUMETRIC_WEIGHT_DIVISOR;
}

export type BookCourierStep =
  | 'scan'
  | 'address'
  | 'box'
  | 'review'
  | 'label'
  | 'final_photo'
  | 'complete';

export const BOOK_COURIER_STEPS: ReadonlyArray<{ id: BookCourierStep; label: string }> = [
  { id: 'scan', label: 'Scan Code' },
  { id: 'address', label: 'Address' },
  { id: 'box', label: 'Box Details' },
  { id: 'review', label: 'Review' },
];

export function bookStepProgressIndex(step: BookCourierStep): number {
  const idx = BOOK_COURIER_STEPS.findIndex(item => item.id === step);
  if (idx >= 0) return idx;
  return BOOK_COURIER_STEPS.length;
}

const PARTNER_BRANCH: Record<LogisticsPartnerId, string> = {
  st_courier: 'Kochi Main Branch',
  trackon: 'Coimbatore Hub',
  delhivery: 'Bangalore DC',
  bluedart: 'Kochi Airport Road',
  dtdc: 'Ernakulam Branch',
  ecosafe: 'Bangalore Hub',
  aps: 'Alleppey Branch',
  personal_collection: 'Counter Pickup',
  own_vehicle: 'Head Office',
};

const PARTNER_SERVICE: Record<LogisticsPartnerId, string> = {
  st_courier: 'Surface',
  trackon: 'Standard',
  delhivery: 'Express',
  bluedart: 'Dart Apex',
  dtdc: 'Premium',
  ecosafe: 'Eco Express',
  aps: 'Parcel',
  personal_collection: 'Self pickup',
  own_vehicle: 'Direct',
};

export function emptyBookingDraft(partnerId: LogisticsPartnerId): LogisticsBookingDraft {
  return {
    partnerId,
    source: 'manual',
    invoiceId: null,
    invoiceNumber: null,
    supportRequestId: null,
    supportRequestNumber: null,
    barcodeRaw: '',
    consignmentNo: '',
    branch: PARTNER_BRANCH[partnerId],
    serviceType: PARTNER_SERVICE[partnerId],
    bookingDate: new Date().toISOString().slice(0, 10),
    zohoCustomerId: '',
    dealerId: '',
    deliveryAddressKind: 'shipping',
    shipFromSite: 'head_office',
    shipmentMode: 'box',
    boxes: [emptyShipmentBoxDraft()],
    finalPackagePhoto: null,
    labelGenerated: false,
  };
}

export function parseCourierBarcode(
  raw: string,
  partnerId: LogisticsPartnerId,
): Partial<LogisticsBookingDraft> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map(part => part.trim());
    return {
      consignmentNo: parts[1] || parts[0] || '',
      branch: parts[2] || PARTNER_BRANCH[partnerId],
      serviceType: parts[3] || PARTNER_SERVICE[partnerId],
      bookingDate: parts[4]?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    };
  }

  const consignmentNo = trimmed.replace(/\s+/g, '').toUpperCase();
  return {
    consignmentNo,
    branch: PARTNER_BRANCH[partnerId],
    serviceType: PARTNER_SERVICE[partnerId],
    bookingDate: new Date().toISOString().slice(0, 10),
  };
}

export function bookingStatusIndex(status: LogisticsBookingStatus): number {
  const visible = LOGISTICS_BOOKING_STATUSES.filter(item => item.id !== 'cancelled');
  const idx = visible.findIndex(item => item.id === status);
  if (idx >= 0) return idx;
  if (status === 'cancelled') return -1;
  return 0;
}

export function courierSlipFileName(booking: LogisticsBooking): string {
  return `courier-slip-${booking.orderRef}.pdf`;
}

export function shippingLabelFileName(booking: LogisticsBooking): string {
  return `shipping-label-${booking.consignmentNo}.pdf`;
}

/** @deprecated packing slip is no longer generated */
export function packingSlipFileName(booking: LogisticsBooking): string {
  return `packing-slip-${booking.orderRef}.pdf`;
}

export function chargeableWeight(booking: LogisticsBooking): number {
  if (booking.boxes.length) {
    return booking.boxes.reduce((total, box) => total + boxChargeableWeight(box), 0);
  }
  return Math.max(booking.actualWeightKg, booking.volumetricWeightKg);
}

export function boxDimensionsLabel(box: ShipmentBox): string {
  return box.lengthCm && box.widthCm && box.heightCm
    ? `${box.lengthCm} × ${box.widthCm} × ${box.heightCm} cm`
    : '—';
}

export function bookingSummaryLines(booking: LogisticsBooking): Array<{ label: string; value: string }> {
  const isEnvelope = booking.shipmentMode === 'envelope';
  const lines: Array<{ label: string; value: string }> = [
    { label: 'Logistics partner', value: logisticsPartnerLabel(booking.partnerId) },
    { label: 'Tracking no.', value: booking.trackingNo },
    { label: 'Service type', value: booking.serviceType },
    { label: 'Branch', value: booking.branch },
    { label: 'Booking date', value: booking.bookingDate },
    { label: 'Dealer', value: `${booking.dealer.name} (${booking.dealer.code})` },
    { label: 'Deliver to', value: booking.deliveryAddress },
    { label: 'Ship from', value: booking.shipFromAddress || '—' },
    { label: 'Shipment type', value: shipmentModeLabel(booking.shipmentMode) },
  ];

  if (!isEnvelope) {
    lines.push(
      { label: 'Boxes', value: String(booking.numberOfBoxes) },
      { label: 'Actual weight', value: `${booking.actualWeightKg.toFixed(2)} kg` },
      { label: 'Volumetric weight', value: `${booking.volumetricWeightKg.toFixed(2)} kg` },
      { label: 'Chargeable weight', value: `${chargeableWeight(booking).toFixed(2)} kg` },
    );
  }

  return lines;
}
