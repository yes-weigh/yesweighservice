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
  { id: 'label_generated', label: 'Label Generated' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** Stages shown in dashboard / filters. */
export const LOGISTICS_DASHBOARD_STATUSES = LOGISTICS_BOOKING_STATUSES;

/** Progress timeline after labels are generated. */
export const LOGISTICS_PIPELINE_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'label_generated', label: 'Label Generated' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
];

export function isLogisticsDashboardStatus(
  status: LogisticsBookingStatus,
): boolean {
  return LOGISTICS_DASHBOARD_STATUSES.some(item => item.id === status);
}

/**
 * Early wizard booking (before shipping labels). After labels, wizardStep may be
 * `final_photo` — that counts as Label Generated, not Incomplete.
 */
export function isIncompleteLogisticsBooking(
  booking: Pick<LogisticsBooking, 'wizardStep'>,
): boolean {
  const step = booking.wizardStep?.trim();
  if (!step) return false;
  if (step === 'final_photo') return false;
  return true;
}

/** Label Generated entry still needs the outer package photo before Shipped. */
export function needsFinalPackagePhoto(
  booking: Pick<LogisticsBooking, 'status' | 'wizardStep' | 'finalPackagePhotoStoragePath'>,
): boolean {
  if (booking.status !== 'label_generated') return false;
  if (booking.wizardStep === 'final_photo') return true;
  return !booking.finalPackagePhotoStoragePath?.trim();
}

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

/** True when every package has at least one inside photo (url or stored path). */
export function draftBoxesHaveRequiredPhotos(
  boxes: ReadonlyArray<Pick<ShipmentBoxDraft, 'photos'>>,
): boolean {
  return boxes.length > 0 && boxes.every(box =>
    box.photos.some(photo => Boolean(photo.storagePath?.trim() || photo.url?.trim())),
  );
}

/** Per-box chargeable weight = max(actual, volumetric). */
export function boxChargeableWeight(box: Pick<ShipmentBox, 'weightKg' | 'volumetricWeightKg'>): number {
  return Math.max(box.weightKg || 0, box.volumetricWeightKg || 0);
}

/**
 * Resolve the status a booking should have after a document is generated.
 * Shipping Label ⇒ at least "Label Generated".
 * Never regresses a booking that is already further along (or terminal).
 */
export function statusForDocument(
  current: LogisticsBookingStatus,
  document: LogisticsDocumentType,
): LogisticsBookingStatus {
  if (
    current === 'cancelled'
    || current === 'delivered'
    || current === 'in_transit'
    || current === 'shipped'
  ) {
    return current;
  }
  if (document === 'shipping_label') {
    return 'label_generated';
  }
  return current;
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

/** Visible wizard stages (excludes terminal `complete`). */
export const BOOK_COURIER_STEPS: ReadonlyArray<{ id: BookCourierStep; label: string }> = [
  { id: 'scan', label: 'Scan' },
  { id: 'address', label: 'Address' },
  { id: 'box', label: 'Box' },
  { id: 'review', label: 'Review' },
  { id: 'label', label: 'Label' },
  { id: 'final_photo', label: 'Photo' },
];

export function bookStepProgressIndex(step: BookCourierStep): number {
  if (step === 'complete') return BOOK_COURIER_STEPS.length;
  const idx = BOOK_COURIER_STEPS.findIndex(item => item.id === step);
  return idx >= 0 ? idx : 0;
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
  const idx = LOGISTICS_PIPELINE_STATUSES.findIndex(item => item.id === status);
  if (idx >= 0) return idx;
  if (status === 'cancelled') return -1;
  return 0;
}

export function shippingLabelFileName(booking: LogisticsBooking): string {
  return `shipping-label-${booking.consignmentNo}.html`;
}

export function courierSlipFileName(booking: LogisticsBooking): string {
  return `courier-slip-${booking.orderRef}.png`;
}

export function chargeableWeight(booking: LogisticsBooking): number {
  if (typeof booking.chargeableWeightKg === 'number' && Number.isFinite(booking.chargeableWeightKg)) {
    return booking.chargeableWeightKg;
  }
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
