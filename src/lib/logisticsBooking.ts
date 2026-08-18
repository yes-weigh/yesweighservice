import { BLUE_DART_DP_SLAB_KG } from '../constants/blueDartRates';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  LOGISTICS_PARTNER_IDS,
  isBlueDartLogisticsPartnerId,
  logisticsPartnerLabel,
} from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsBookingStatus,
  LogisticsDocumentType,
  ShipmentBox,
  ShipmentBoxDraft,
  ShipmentMode,
} from '../types/logistics-dispatch';

/**
 * Partners that support the full booking pipeline today.
 * Customer pickup is invoice-only — never a logistics booking partner.
 */
export const ENABLED_LOGISTICS_PARTNER_IDS: ReadonlyArray<LogisticsPartnerId> =
  LOGISTICS_PARTNER_IDS.filter(id => id !== 'personal_collection');

/** Partners allowed for Logistics → New booking (manual, no invoice required). */
export const STANDALONE_LOGISTICS_PARTNER_IDS: ReadonlyArray<LogisticsPartnerId> =
  ENABLED_LOGISTICS_PARTNER_IDS;

export function isPipelineEnabledPartner(id: string): boolean {
  return ENABLED_LOGISTICS_PARTNER_IDS.includes(id as LogisticsPartnerId);
}

/** Delhivery / Blue Dart: AWB is created via API on Review — skip scan + local label. */
export function isApiBookedLogisticsPartner(id: string): boolean {
  return id === 'delhivery' || isBlueDartLogisticsPartnerId(id);
}

/**
 * Manual (non-API) partners whose booking can be switched after confirm
 * (ST ↔ Trackon, DTDC, etc.). Delhivery / Blue Dart need cancel-LR instead.
 */
export const CHANGEABLE_LOGISTICS_PARTNER_IDS: ReadonlyArray<LogisticsPartnerId> =
  ENABLED_LOGISTICS_PARTNER_IDS.filter(id => !isApiBookedLogisticsPartner(id));

export function canChangeLogisticsBookingPartner(
  booking: Pick<LogisticsBooking, 'status' | 'partnerId'>,
): boolean {
  if (
    booking.status === 'delivered'
    || booking.status === 'cancelled'
    || booking.status === 'returned'
  ) {
    return false;
  }
  return CHANGEABLE_LOGISTICS_PARTNER_IDS.includes(booking.partnerId);
}

export const LOGISTICS_BOOKING_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'label_generated', label: 'Booked' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'returned', label: 'Returned' },
];

/** Stages shown in dashboard / filters. */
export const LOGISTICS_DASHBOARD_STATUSES = LOGISTICS_BOOKING_STATUSES;

/** Progress timeline after the booking is confirmed. */
export const LOGISTICS_PIPELINE_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'label_generated', label: 'Booked' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
];

export function isLogisticsDashboardStatus(
  status: LogisticsBookingStatus,
): boolean {
  return LOGISTICS_DASHBOARD_STATUSES.some(item => item.id === status);
}

/**
 * Early wizard booking (before LR / shipping labels). After labels, wizardStep
 * may be `final_photo` — that counts as Booked, not Incomplete.
 * An LR already created on the courier must show in the list even if the
 * wizard step was left open (e.g. waiting on invoice total).
 */
export function isIncompleteLogisticsBooking(
  booking: Pick<LogisticsBooking, 'wizardStep'> & { consignmentNo?: string | null },
): boolean {
  if (booking.consignmentNo?.trim()) return false;
  const step = booking.wizardStep?.trim();
  if (!step) return false;
  if (step === 'final_photo') return false;
  return true;
}

/** Same fields the invoice-detail AWB card shows (consignment or tracking no). */
export function logisticsBookingShowsAwb(
  booking: Pick<LogisticsBooking, 'consignmentNo' | 'trackingNo'> | null | undefined,
): boolean {
  return Boolean(booking?.consignmentNo?.trim() || booking?.trackingNo?.trim());
}

/**
 * Invoice list Status overlay.
 * Assigned logistics with an AWB on invoice detail counts as In transit,
 * including Booked (`label_generated`). Delivered / returned / cancelled
 * keep their own status. Incomplete with no AWB → null (To dispatch).
 */
export function invoiceListLogisticsStatus(
  booking: Pick<LogisticsBooking, 'status' | 'wizardStep' | 'consignmentNo' | 'trackingNo'> | null | undefined,
): { status: LogisticsBookingStatus; label: string } | null {
  if (!booking) return null;
  const hasAwb = logisticsBookingShowsAwb(booking);
  if (!hasAwb && isIncompleteLogisticsBooking(booking)) return null;

  if (booking.status === 'label_generated') {
    if (!hasAwb) return null;
    const inTransitLabel = LOGISTICS_BOOKING_STATUSES.find(item => item.id === 'in_transit')?.label
      ?? 'In Transit';
    return { status: 'in_transit', label: inTransitLabel };
  }

  const label = LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label;
  if (!label) return null;
  return { status: booking.status, label };
}

/**
 * Label-generated booking still parked on the outer-photo wizard step.
 * Outer package photo is optional — missing photo alone must not force resume
 * (list opens detail so staff can finish without a photo).
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

/** Blue Dart Domestic Priority bills in 500 g steps (not whole-kg ceil). */
export function isBlueDartDomesticPriorityPartner(
  partnerId: LogisticsPartnerId | null | undefined,
): boolean {
  return partnerId === 'bluedart_domestic';
}

/** Round chargeable kg up for the partner’s billing step (1 kg, or 0.5 kg for BDDP). */
export function ceilChargeableWeightKg(
  value: number,
  partnerId?: LogisticsPartnerId | null,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (isBlueDartDomesticPriorityPartner(partnerId)) {
    return Math.ceil(value / BLUE_DART_DP_SLAB_KG - 1e-9) * BLUE_DART_DP_SLAB_KG;
  }
  return Math.ceil(value);
}

/** Per-box chargeable weight = max(actual, volumetric), rounded to partner step. */
export function boxChargeableWeight(
  box: Pick<ShipmentBox, 'weightKg' | 'volumetricWeightKg'>,
  partnerId?: LogisticsPartnerId | null,
): number {
  const raw = Math.max(box.weightKg || 0, box.volumetricWeightKg || 0);
  return ceilChargeableWeightKg(raw, partnerId);
}

/**
 * Resolve the status a booking should have after a document is generated.
 * Shipping Label ⇒ at least "Booked".
 * Never regresses a booking that is already further along (or terminal).
 */
export function statusForDocument(
  current: LogisticsBookingStatus,
  document: LogisticsDocumentType,
): LogisticsBookingStatus {
  if (
    current === 'returned'
    || current === 'cancelled'
    || current === 'delivered'
    || current === 'in_transit'
  ) {
    return current;
  }
  if (document === 'shipping_label') {
    return 'label_generated';
  }
  return current;
}

export const VOLUMETRIC_WEIGHT_DIVISOR = 5000;

/**
 * Volumetric kg = L×B×H ÷ divisor.
 * Most partners round up to whole kg; Blue Dart Domestic Priority keeps raw kg
 * (billing steps every 0.5 kg on chargeable weight instead).
 */
export function computeVolumetricWeight(
  lengthCm: number | null,
  widthCm: number | null,
  heightCm: number | null,
  partnerId?: LogisticsPartnerId | null,
  divisor: number = VOLUMETRIC_WEIGHT_DIVISOR,
): number {
  if (!lengthCm || !widthCm || !heightCm) return 0;
  const d = divisor > 0 ? divisor : VOLUMETRIC_WEIGHT_DIVISOR;
  const raw = (lengthCm * widthCm * heightCm) / d;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (isBlueDartDomesticPriorityPartner(partnerId)) {
    return Math.round(raw * 1000) / 1000;
  }
  return Math.ceil(raw);
}

export type BookCourierStep =
  | 'scan'
  | 'address'
  | 'club_invoices'
  | 'box'
  | 'review'
  | 'label'
  | 'final_photo'
  | 'eway_bill'
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

/** Delhivery / Blue Dart: AWB is created on Review — no local label / outer-photo wizard steps. */
export const DELHIVERY_BOOK_COURIER_STEPS: ReadonlyArray<{ id: BookCourierStep; label: string }> = [
  { id: 'address', label: 'Address' },
  { id: 'box', label: 'Box' },
  { id: 'review', label: 'Review' },
];

export type BookCourierStepOptions = {
  includeEwayBill?: boolean;
  includeClubInvoices?: boolean;
};

function delhiveryProgressSteps(
  options?: BookCourierStepOptions,
): ReadonlyArray<{ id: BookCourierStep; label: string }> {
  const steps: Array<{ id: BookCourierStep; label: string }> = [
    { id: 'address', label: 'Address' },
  ];
  if (options?.includeClubInvoices) {
    steps.push({ id: 'club_invoices', label: 'Invoices' });
  }
  if (options?.includeEwayBill) {
    steps.push({ id: 'eway_bill', label: 'E-way bill' });
  }
  steps.push(
    { id: 'box', label: 'Box' },
    { id: 'review', label: 'Review' },
  );
  return steps;
}

function delhiveryFlowOrder(options?: BookCourierStepOptions): readonly BookCourierStep[] {
  const order: BookCourierStep[] = ['address'];
  if (options?.includeClubInvoices) order.push('club_invoices');
  order.push('box', 'review');
  if (options?.includeEwayBill) order.push('eway_bill');
  return order;
}

export function bookCourierStepsForPartner(
  partnerId: LogisticsPartnerId,
): ReadonlyArray<{ id: BookCourierStep; label: string }> {
  return isApiBookedLogisticsPartner(partnerId) ? DELHIVERY_BOOK_COURIER_STEPS : BOOK_COURIER_STEPS;
}

/** Progress steps for an in-flight booking (optional e-way / club invoices). */
export function bookCourierStepsForBooking(
  partnerId: LogisticsPartnerId,
  options?: BookCourierStepOptions,
): ReadonlyArray<{ id: BookCourierStep; label: string }> {
  if (isApiBookedLogisticsPartner(partnerId)) return delhiveryProgressSteps(options);
  const base = bookCourierStepsForPartner(partnerId);
  if (!options?.includeEwayBill) return base;
  return [...base, { id: 'eway_bill', label: 'E-way bill' }];
}

/** Flow order for step counter copy (actual navigation), not progress bar layout. */
export function bookStepFlowIndex(
  step: BookCourierStep,
  partnerId?: LogisticsPartnerId,
  options?: BookCourierStepOptions,
): number {
  if (step === 'complete') {
    const steps = partnerId
      ? bookCourierStepsForBooking(partnerId, options)
      : BOOK_COURIER_STEPS;
    return steps.length;
  }
  if (partnerId && isApiBookedLogisticsPartner(partnerId)) {
    const idx = delhiveryFlowOrder(options).indexOf(step);
    if (idx >= 0) return idx;
    if (step === 'scan') return 0;
    if (step === 'label' || step === 'final_photo') return Math.max(0, delhiveryFlowOrder(options).length - 2);
    return 0;
  }
  return bookStepProgressIndex(step, partnerId, options);
}

export type BookStepProgressVisualState = 'done' | 'current' | 'pending';

/** Maps each progress pill to done/current/pending (supports Delhivery e-way UI early). */
export function bookStepProgressVisualState(
  stepId: BookCourierStep,
  currentStep: BookCourierStep,
  partnerId: LogisticsPartnerId,
  options?: BookCourierStepOptions,
): BookStepProgressVisualState {
  if (currentStep === 'complete') return 'done';

  if (isApiBookedLogisticsPartner(partnerId)) {
    if (stepId === 'eway_bill' && options?.includeEwayBill) {
      if (currentStep === 'eway_bill') return 'current';
      return 'pending';
    }
    const flow = delhiveryFlowOrder(options).filter(id => id !== 'eway_bill');
    const currentInFlow = currentStep === 'eway_bill' ? 'review' : currentStep;
    const activeIndex = flow.findIndex(id => id === currentInFlow);
    const index = flow.findIndex(id => id === stepId);
    if (index < 0 || activeIndex < 0) return 'pending';
    if (index < activeIndex) return 'done';
    if (index === activeIndex) return 'current';
    return 'pending';
  }

  const steps = bookCourierStepsForBooking(partnerId, options);
  const activeIndex = bookStepProgressIndex(currentStep, partnerId, options);
  const index = steps.findIndex(item => item.id === stepId);
  if (index < 0) return 'pending';
  if (index < activeIndex) return 'done';
  if (index === activeIndex) return 'current';
  return 'pending';
}

export function bookStepProgressIndex(
  step: BookCourierStep,
  partnerId?: LogisticsPartnerId,
  options?: BookCourierStepOptions,
): number {
  const steps = partnerId
    ? bookCourierStepsForBooking(partnerId, options)
    : BOOK_COURIER_STEPS;
  if (step === 'complete') return steps.length;
  const idx = steps.findIndex(item => item.id === step);
  if (idx >= 0) return idx;
  if (partnerId && isApiBookedLogisticsPartner(partnerId)) {
    const flow = delhiveryFlowOrder(options);
    const mapped = step === 'scan' ? 'address' : step;
    const flowIdx = flow.indexOf(mapped);
    return flowIdx >= 0 ? flowIdx : 0;
  }
  if (step === 'eway_bill') return Math.max(0, steps.length - 1);
  return 0;
}

const PARTNER_BRANCH: Record<LogisticsPartnerId, string> = {
  st_courier: 'Kochi Main Branch',
  trackon_air: 'Cochin Hub',
  trackon_surface: 'Cochin Hub',
  delhivery: 'Delhivery B2B',
  bluedart_air: 'Kochi Airport Road',
  bluedart_surface: 'Kochi Airport Road',
  bluedart_domestic: 'Kochi Airport Road',
  dtdc: 'Ernakulam Branch',
  ecosafe: 'Bangalore Hub',
  aps: 'Alleppey Branch',
  personal_collection: 'Counter Pickup',
};

const PARTNER_SERVICE: Record<LogisticsPartnerId, string> = {
  st_courier: 'Surface',
  trackon_air: 'Air',
  trackon_surface: 'Surface',
  delhivery: 'Surface',
  bluedart_air: 'Dart Apex',
  bluedart_surface: 'Surface Band 13',
  bluedart_domestic: 'Domestic Priority',
  dtdc: 'Premium',
  ecosafe: 'Eco Express',
  aps: 'Parcel',
  personal_collection: 'Self pickup',
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
    deliveryAddress: null,
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
  if (status === 'returned' || status === 'cancelled') return -1;
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

/** Consignment chargeable kg for a partner (BDDP: step 0.5 kg on combined weight). */
export function consignmentChargeableWeightKg(
  boxes: ReadonlyArray<Pick<ShipmentBox, 'weightKg' | 'volumetricWeightKg'>>,
  partnerId?: LogisticsPartnerId | null,
): number {
  if (!boxes.length) return 0;
  if (isBlueDartDomesticPriorityPartner(partnerId)) {
    const actual = boxes.reduce((total, box) => total + (box.weightKg || 0), 0);
    const volumetric = boxes.reduce((total, box) => total + (box.volumetricWeightKg || 0), 0);
    return ceilChargeableWeightKg(Math.max(actual, volumetric), partnerId);
  }
  return boxes.reduce(
    (total, box) => total + boxChargeableWeight(box, partnerId),
    0,
  );
}

export function chargeableWeight(booking: LogisticsBooking): number {
  if (typeof booking.chargeableWeightKg === 'number' && Number.isFinite(booking.chargeableWeightKg)) {
    return booking.chargeableWeightKg;
  }
  if (booking.boxes.length) {
    return consignmentChargeableWeightKg(booking.boxes, booking.partnerId);
  }
  return ceilChargeableWeightKg(
    Math.max(booking.actualWeightKg, booking.volumetricWeightKg),
    booking.partnerId,
  );
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
