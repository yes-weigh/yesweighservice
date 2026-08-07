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
  'trackon_air',
  'trackon_surface',
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

/**
 * Label-generated booking still parked on the outer-photo wizard step.
 * Outer package photo is optional — missing photo alone must not force resume
 * (list opens detail so staff can Mark as Shipped without a photo).
 */
export function needsFinalPackagePhoto(
  booking: Pick<LogisticsBooking, 'status' | 'wizardStep' | 'finalPackagePhotoStoragePath'>,
): boolean {
  return booking.status === 'label_generated' && booking.wizardStep === 'final_photo';
}

/** True when the outer / label-pasted package photo has not been stored yet. */
export function missingFinalPackagePhoto(
  booking: Pick<LogisticsBooking, 'finalPackagePhoto' | 'finalPackagePhotoStoragePath'>,
): boolean {
  return !booking.finalPackagePhotoStoragePath?.trim() && !booking.finalPackagePhoto?.trim();
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

/** Sum actual weights of draft boxes (for combine prefill). */
export function sumDraftBoxWeightsKg(boxes: ReadonlyArray<Pick<ShipmentBoxDraft, 'weightKg'>>): string {
  const sum = boxes.reduce((total, box) => total + (Number.parseFloat(box.weightKg) || 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) return '';
  return sum.toFixed(2);
}

function parsePositiveCm(value: string | undefined): number | null {
  const n = Number.parseFloat(value ?? '');
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatCombineCm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Suggest outer L×B×H when packing selected boxes into one carton:
 * orient each box L≥B≥H, then max(L) × max(B) × sum(H).
 * Returns empty strings when no selected box has full dimensions.
 */
export function suggestCombinedBoxDims(
  boxes: ReadonlyArray<Pick<ShipmentBoxDraft, 'lengthCm' | 'widthCm' | 'heightCm'>>,
): Pick<ShipmentBoxDraft, 'lengthCm' | 'widthCm' | 'heightCm'> {
  let maxL = 0;
  let maxB = 0;
  let sumH = 0;
  let counted = 0;

  for (const box of boxes) {
    const l = parsePositiveCm(box.lengthCm);
    const b = parsePositiveCm(box.widthCm);
    const h = parsePositiveCm(box.heightCm);
    if (l == null || b == null || h == null) continue;
    const sorted = [l, b, h].sort((a, c) => c - a);
    maxL = Math.max(maxL, sorted[0]);
    maxB = Math.max(maxB, sorted[1]);
    sumH += sorted[2];
    counted += 1;
  }

  if (counted === 0) {
    return { lengthCm: '', widthCm: '', heightCm: '' };
  }

  return {
    lengthCm: formatCombineCm(maxL),
    widthCm: formatCombineCm(maxB),
    heightCm: formatCombineCm(sumH),
  };
}

/**
 * Replace selected boxes with one combined box (new L×B×H + weight).
 * Photos from selected boxes are kept in selection order.
 * Box / label count follow the returned array length.
 */
export function combineShipmentBoxDrafts(
  boxes: readonly ShipmentBoxDraft[],
  selectedIds: readonly string[],
  dims: Pick<ShipmentBoxDraft, 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg'>,
): ShipmentBoxDraft[] {
  const idSet = new Set(selectedIds.filter(Boolean));
  if (idSet.size < 2) return boxes.slice();

  const selected = boxes.filter(box => idSet.has(box.id));
  if (selected.length < 2) return boxes.slice();

  const combined: ShipmentBoxDraft = {
    ...emptyShipmentBoxDraft(),
    lengthCm: dims.lengthCm.trim(),
    widthCm: dims.widthCm.trim(),
    heightCm: dims.heightCm.trim(),
    weightKg: dims.weightKg.trim(),
    photos: selected.flatMap(box => box.photos),
  };

  const next: ShipmentBoxDraft[] = [];
  let inserted = false;
  for (const box of boxes) {
    if (!idSet.has(box.id)) {
      next.push(box);
      continue;
    }
    if (!inserted) {
      next.push(combined);
      inserted = true;
    }
  }
  return next;
}

/** True when every package has at least one inside photo (url or stored path). */
export function draftBoxesHaveRequiredPhotos(
  boxes: ReadonlyArray<Pick<ShipmentBoxDraft, 'photos'>>,
): boolean {
  return boxes.length > 0 && boxes.every(box =>
    box.photos.some(photo => Boolean(photo.storagePath?.trim() || photo.url?.trim())),
  );
}

/** Per-box chargeable weight = max(actual, volumetric), always rounded up. */
export function boxChargeableWeight(box: Pick<ShipmentBox, 'weightKg' | 'volumetricWeightKg'>): number {
  const raw = Math.max(box.weightKg || 0, box.volumetricWeightKg || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.ceil(raw);
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
  const raw = (lengthCm * widthCm * heightCm) / VOLUMETRIC_WEIGHT_DIVISOR;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.ceil(raw);
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
  trackon_air: 'Cochin Hub',
  trackon_surface: 'Cochin Hub',
  delhivery: 'Bangalore DC',
  bluedart_air: 'Kochi Airport Road',
  bluedart_surface: 'Kochi Airport Road',
  bluedart_domestic: 'Kochi Airport Road',
  dtdc: 'Ernakulam Branch',
  ecosafe: 'Bangalore Hub',
  aps: 'Alleppey Branch',
  personal_collection: 'Counter Pickup',
  own_vehicle: 'Head Office',
};

const PARTNER_SERVICE: Record<LogisticsPartnerId, string> = {
  st_courier: 'Surface',
  trackon_air: 'Air',
  trackon_surface: 'Surface',
  delhivery: 'Express',
  bluedart_air: 'Dart Apex',
  bluedart_surface: 'Surface Band 13',
  bluedart_domestic: 'Domestic Priority',
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
    shipFromSite: 'cochin',
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
  if (booking.partnerId === 'st_courier') {
    return `courier-slip-${booking.orderRef || booking.consignmentNo}.pdf`;
  }
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
