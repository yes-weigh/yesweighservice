import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import type {
  DealerDeliveryAddress,
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsBookingStatus,
} from '../types/logistics-dispatch';

export const LOGISTICS_BOOKING_STATUSES: ReadonlyArray<{
  id: LogisticsBookingStatus;
  label: string;
}> = [
  { id: 'courier_booked', label: 'Courier Booked' },
  { id: 'pickup_pending', label: 'Pickup Pending' },
  { id: 'in_transit', label: 'In Transit' },
  { id: 'delivered', label: 'Delivered' },
];

export const MOCK_DEALER_ADDRESSES: DealerDeliveryAddress[] = [
  {
    id: 'addr-kochi',
    label: 'Kochi Showroom',
    lines: ['42 MG Road, Ernakulam'],
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682035',
  },
  {
    id: 'addr-tvm',
    label: 'Trivandrum Branch',
    lines: ['Yes One Scales, Technopark Road'],
    city: 'Thiruvananthapuram',
    state: 'Kerala',
    pincode: '695581',
  },
  {
    id: 'addr-cbe',
    label: 'Coimbatore Depot',
    lines: ['12 Avinashi Road, Peelamedu'],
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincode: '641004',
  },
];

export type BookCourierStep =
  | 'scan'
  | 'details'
  | 'address'
  | 'package'
  | 'review'
  | 'complete';

export const BOOK_COURIER_STEPS: ReadonlyArray<{ id: BookCourierStep; label: string }> = [
  { id: 'scan', label: 'Scan slip' },
  { id: 'details', label: 'Courier details' },
  { id: 'address', label: 'Delivery address' },
  { id: 'package', label: 'Package' },
  { id: 'review', label: 'Review' },
  { id: 'complete', label: 'Done' },
];

export function emptyBookingDraft(partnerId: LogisticsPartnerId): LogisticsBookingDraft {
  return {
    partnerId,
    barcodeRaw: '',
    consignmentNo: '',
    branch: '',
    serviceType: '',
    bookingDate: new Date().toISOString().slice(0, 10),
    deliveryAddressId: MOCK_DEALER_ADDRESSES[0]?.id ?? '',
    numberOfBoxes: '1',
    totalWeightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    notes: '',
  };
}

const PARTNER_BRANCH: Record<LogisticsPartnerId, string> = {
  st_courier: 'Kochi Hub',
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

/** Mock barcode parse — in production, wire to camera / scanner SDK. */
export function parseCourierBarcode(
  raw: string,
  partnerId: LogisticsPartnerId,
): Partial<LogisticsBookingDraft> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const parts = trimmed.split('|').map(part => part.trim());
  if (parts.length >= 4) {
    return {
      consignmentNo: parts[1] ?? '',
      branch: parts[2] ?? PARTNER_BRANCH[partnerId],
      serviceType: parts[3] ?? PARTNER_SERVICE[partnerId],
      bookingDate: parts[4]?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    };
  }

  const prefix = partnerId.slice(0, 3).toUpperCase();
  const suffix = trimmed.replace(/\D/g, '').slice(-8).padStart(8, '0');
  return {
    consignmentNo: `${prefix}${suffix}`,
    branch: PARTNER_BRANCH[partnerId],
    serviceType: PARTNER_SERVICE[partnerId],
    bookingDate: new Date().toISOString().slice(0, 10),
  };
}

export function mockScanBarcode(partnerId: LogisticsPartnerId): string {
  const code = Math.floor(10000000 + Math.random() * 89999999);
  return `${partnerId}|${code}|${PARTNER_BRANCH[partnerId]}|${PARTNER_SERVICE[partnerId]}|${new Date().toISOString().slice(0, 10)}`;
}

export function formatDealerAddress(address: DealerDeliveryAddress): string {
  return [...address.lines, `${address.city}, ${address.state} ${address.pincode}`].join(', ');
}

export function createLogisticsBooking(
  draft: LogisticsBookingDraft,
  orderRef = `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
): LogisticsBooking | null {
  const address = MOCK_DEALER_ADDRESSES.find(item => item.id === draft.deliveryAddressId);
  if (!address || !draft.consignmentNo.trim()) return null;

  const boxes = Math.max(1, Number.parseInt(draft.numberOfBoxes, 10) || 1);
  const weight = Number.parseFloat(draft.totalWeightKg) || 0;

  return {
    id: `booking-${Date.now()}`,
    orderRef,
    partnerId: draft.partnerId,
    consignmentNo: draft.consignmentNo.trim(),
    branch: draft.branch.trim(),
    serviceType: draft.serviceType.trim(),
    bookingDate: draft.bookingDate,
    deliveryAddress: address,
    numberOfBoxes: boxes,
    totalWeightKg: weight,
    lengthCm: draft.lengthCm ? Number.parseFloat(draft.lengthCm) : null,
    widthCm: draft.widthCm ? Number.parseFloat(draft.widthCm) : null,
    heightCm: draft.heightCm ? Number.parseFloat(draft.heightCm) : null,
    notes: draft.notes.trim(),
    courierSlipGenerated: false,
    packingSlipGenerated: false,
    status: 'courier_booked',
    createdAt: new Date().toISOString(),
  };
}

export function bookingStatusIndex(status: LogisticsBookingStatus): number {
  return LOGISTICS_BOOKING_STATUSES.findIndex(item => item.id === status);
}

export function courierSlipFileName(booking: LogisticsBooking): string {
  return `courier-slip-${booking.consignmentNo}.pdf`;
}

export function packingSlipFileName(booking: LogisticsBooking): string {
  return `packing-slip-${booking.orderRef}.pdf`;
}

export function bookingSummaryLines(booking: LogisticsBooking): Array<{ label: string; value: string }> {
  return [
    { label: 'Logistics partner', value: logisticsPartnerLabel(booking.partnerId) },
    { label: 'Consignment no.', value: booking.consignmentNo },
    { label: 'Branch', value: booking.branch },
    { label: 'Service type', value: booking.serviceType },
    { label: 'Booking date', value: booking.bookingDate },
    { label: 'Deliver to', value: formatDealerAddress(booking.deliveryAddress) },
    { label: 'Boxes', value: String(booking.numberOfBoxes) },
    { label: 'Weight', value: `${booking.totalWeightKg} kg` },
    {
      label: 'Dimensions',
      value: booking.lengthCm && booking.widthCm && booking.heightCm
        ? `${booking.lengthCm} × ${booking.widthCm} × ${booking.heightCm} cm`
        : '—',
    },
    { label: 'Notes', value: booking.notes || '—' },
  ];
}
