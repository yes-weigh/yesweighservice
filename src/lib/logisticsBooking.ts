import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type {
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsBookingStatus,
  PackageType,
} from '../types/logistics-dispatch';

export const LOGISTICS_BOOKING_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'courier_booked', label: 'Courier Booked' },
  { id: 'pickup_pending', label: 'Pickup Pending' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const PACKAGE_TYPES: ReadonlyArray<{ id: PackageType; label: string }> = [
  { id: 'carton', label: 'Carton Box' },
  { id: 'wooden', label: 'Wooden Box' },
  { id: 'pallet', label: 'Pallet' },
  { id: 'plastic', label: 'Plastic Box' },
];

export function packageTypeLabel(id: PackageType): string {
  return PACKAGE_TYPES.find(item => item.id === id)?.label ?? id;
}

export const VOLUMETRIC_WEIGHT_DIVISOR = 2500;

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
    numberOfBoxes: 1,
    actualWeightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    packageType: 'carton',
    notes: '',
    shipmentItems: [],
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
  return `courier-label-${booking.consignmentNo}.pdf`;
}

export function packingSlipFileName(booking: LogisticsBooking): string {
  return `packing-slip-${booking.orderRef}.pdf`;
}

export function chargeableWeight(booking: LogisticsBooking): number {
  return Math.max(booking.actualWeightKg, booking.volumetricWeightKg);
}

export function bookingSummaryLines(booking: LogisticsBooking): Array<{ label: string; value: string }> {
  return [
    { label: 'Logistics partner', value: logisticsPartnerLabel(booking.partnerId) },
    { label: 'Tracking no.', value: booking.trackingNo },
    { label: 'Service type', value: booking.serviceType },
    { label: 'Branch', value: booking.branch },
    { label: 'Booking date', value: booking.bookingDate },
    { label: 'Dealer', value: `${booking.dealer.name} (${booking.dealer.code})` },
    { label: 'Deliver to', value: booking.deliveryAddress },
    { label: 'Ship from', value: booking.shipFromAddress || '—' },
    { label: 'Boxes', value: String(booking.numberOfBoxes) },
    { label: 'Actual weight', value: `${booking.actualWeightKg.toFixed(2)} kg` },
    { label: 'Volumetric weight', value: `${booking.volumetricWeightKg.toFixed(2)} kg` },
    {
      label: 'Dimensions',
      value: booking.lengthCm && booking.widthCm && booking.heightCm
        ? `${booking.lengthCm} × ${booking.widthCm} × ${booking.heightCm} cm`
        : '—',
    },
    { label: 'Package type', value: packageTypeLabel(booking.packageType) },
    { label: 'Notes', value: booking.notes || '—' },
  ];
}
