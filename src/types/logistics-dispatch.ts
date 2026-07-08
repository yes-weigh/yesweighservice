import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { StaffLogisticsSite } from './staff-logistics';

export type LogisticsBookingStatus =
  | 'booked'
  | 'label_generated'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type LogisticsBookingSource = 'manual' | 'invoice' | 'support';

export type DeliveryAddressKind = 'shipping' | 'billing';

export type PackageType = 'carton' | 'wooden' | 'pallet' | 'plastic';

/** Whether the shipment is a flat envelope/document pouch or a box. */
export type ShipmentMode = 'envelope' | 'box';

/** The two printable documents generated for a shipment. */
export type LogisticsDocumentType = 'courier_slip' | 'shipping_label';

/** Snapshot of the Zoho customer at booking time. */
export interface LogisticsDealerSnapshot {
  zohoCustomerId: string;
  /** Portal user uid when linked, otherwise Zoho contact id. */
  dealerId: string;
  name: string;
  code: string;
  contactPerson: string;
  mobile: string;
  shippingAddress: string;
  billingAddress: string;
}

/** @deprecated use LogisticsDealerSnapshot */
export type Dealer = LogisticsDealerSnapshot;

export interface ShipmentItem {
  id: string;
  name: string;
  sku?: string | null;
  catalogProductId?: string | null;
  quantity: number;
  serialNumbers?: string[];
  photoStoragePath: string | null;
  /** Resolved download URL or transient preview before persist. */
  photoUrl?: string | null;
}

export interface LogisticsBookingDraft {
  partnerId: LogisticsPartnerId;
  source: LogisticsBookingSource;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supportRequestId: string | null;
  supportRequestNumber: string | null;
  barcodeRaw: string;
  consignmentNo: string;
  branch: string;
  serviceType: string;
  bookingDate: string;
  zohoCustomerId: string;
  dealerId: string;
  deliveryAddressKind: DeliveryAddressKind;
  shipFromSite: StaffLogisticsSite;
  shipmentMode: ShipmentMode;
  numberOfBoxes: number;
  actualWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  packageType: PackageType;
  notes: string;
  shipmentItems: ShipmentItem[];
  /** Transient data URL until uploaded on confirm. */
  finalPackagePhoto: string | null;
  labelGenerated: boolean;
}

export interface LogisticsBooking {
  id: string;
  orderRef: string;
  source: LogisticsBookingSource;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supportRequestId: string | null;
  supportRequestNumber: string | null;
  partnerId: LogisticsPartnerId;
  consignmentNo: string;
  trackingNo: string;
  branch: string;
  serviceType: string;
  bookingDate: string;
  dealer: LogisticsDealerSnapshot;
  deliveryAddressKind: DeliveryAddressKind;
  deliveryAddress: string;
  shipFromSite: StaffLogisticsSite;
  shipFromAddress: string;
  shipmentMode: ShipmentMode;
  numberOfBoxes: number;
  actualWeightKg: number;
  volumetricWeightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  packageType: PackageType;
  notes: string;
  shipmentItems: ShipmentItem[];
  finalPackagePhoto: string | null;
  finalPackagePhotoStoragePath: string | null;
  /** @deprecated legacy alias of shippingLabelGenerated */
  labelGenerated: boolean;
  courierSlipGenerated: boolean;
  shippingLabelGenerated: boolean;
  /** @deprecated no longer surfaced in the UI */
  packingSlipGenerated?: boolean;
  status: LogisticsBookingStatus;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
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
