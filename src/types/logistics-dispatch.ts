import type { LogisticsPartnerId } from '../constants/logisticsPartners';

export type LogisticsBookingStatus =
  | 'courier_booked'
  | 'pickup_pending'
  | 'in_transit'
  | 'delivered';

export interface DealerDeliveryAddress {
  id: string;
  label: string;
  lines: string[];
  city: string;
  state: string;
  pincode: string;
}

export interface LogisticsBookingDraft {
  partnerId: LogisticsPartnerId;
  barcodeRaw: string;
  consignmentNo: string;
  branch: string;
  serviceType: string;
  bookingDate: string;
  deliveryAddressId: string;
  numberOfBoxes: string;
  totalWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  notes: string;
}

export interface LogisticsBooking {
  id: string;
  orderRef: string;
  partnerId: LogisticsPartnerId;
  consignmentNo: string;
  branch: string;
  serviceType: string;
  bookingDate: string;
  deliveryAddress: DealerDeliveryAddress;
  numberOfBoxes: number;
  totalWeightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  notes: string;
  courierSlipGenerated: boolean;
  packingSlipGenerated: boolean;
  status: LogisticsBookingStatus;
  createdAt: string;
}

/** @deprecated Use LogisticsPartnerId from logisticsPartners */
export type CourierPartnerId = LogisticsPartnerId | 'ecosafe' | 'aps' | 'transport_lorry';

export type CourierDispatchPhase =
  | 'courier_assigned'
  | 'label_generated'
  | 'handover_pending'
  | 'pickup_completed'
  | 'in_transit'
  | 'delivered';

export type CourierBoxStatus = 'ready' | 'label_printed' | 'picked_up';

export type CourierDispatchStatus = 'active' | 'dispatched';

export interface CourierDispatchBox {
  id: string;
  boxNumber: number;
  totalBoxes: number;
  productCount: number;
  weightKg: number;
  trackingNumber: string;
  status: CourierBoxStatus;
  labelGenerated: boolean;
  photoFileName: string | null;
}

export interface CourierDispatch {
  id: string;
  orderRef: string;
  courierPartnerId: CourierPartnerId;
  trackingNumber: string;
  freightCharge: number | null;
  expectedDeliveryDate: string;
  numberOfBoxes: number;
  totalWeightKg: number;
  lrReceiptFileName: string | null;
  remarks: string;
  pickupReceiptFileName: string | null;
  podFileName: string | null;
  boxes: CourierDispatchBox[];
  status: CourierDispatchStatus;
  createdAt: string;
  dispatchedAt: string | null;
}

export interface CourierPartnerFormDraft {
  courierPartnerId: CourierPartnerId | null;
  trackingNumber: string;
  freightCharge: string;
  expectedDeliveryDate: string;
  numberOfBoxes: string;
  totalWeightKg: string;
  lrReceiptFileName: string | null;
  remarks: string;
}
