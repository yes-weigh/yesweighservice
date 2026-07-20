import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { StaffLogisticsSite } from './staff-logistics';

export type LogisticsBookingStatus =
  | 'label_generated'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type LogisticsBookingSource = 'manual' | 'invoice' | 'support';

export type DeliveryAddressKind = 'shipping' | 'billing';

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
  /**
   * Receiver phone for labels / courier slip.
   * Preference: shipping address → billing address → contact person → any other field.
   */
  mobile: string;
  /** Phone on Zoho shipping address (when available). */
  shippingPhone?: string;
  /** Phone on Zoho billing address (when available). */
  billingPhone?: string;
  shippingAddress: string;
  billingAddress: string;
  /** Preferred destination city for shipping labels. */
  destinationCity?: string;
}

/** @deprecated use LogisticsDealerSnapshot */
export type Dealer = LogisticsDealerSnapshot;

/** A persisted box photo. */
export interface ShipmentBoxPhoto {
  storagePath: string;
  /** Resolved download URL or transient preview. */
  url?: string | null;
}

/** A persisted box in a shipment. */
export interface ShipmentBox {
  id: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number;
  volumetricWeightKg: number;
  /** photos[0] is the mandatory "inside" photo; the rest are optional. */
  photos: ShipmentBoxPhoto[];
}

/** A box photo while editing (transient data URL preview or resolved URL). */
export interface ShipmentBoxPhotoDraft {
  id: string;
  url: string;
  storagePath?: string | null;
}

/** A box while editing (string inputs for the number fields). */
export interface ShipmentBoxDraft {
  id: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
  photos: ShipmentBoxPhotoDraft[];
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
  boxes: ShipmentBoxDraft[];
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
  boxes: ShipmentBox[];
  /** Total boxes (boxes.length). */
  numberOfBoxes: number;
  /** Sum of box actual weights. */
  actualWeightKg: number;
  /** Sum of box volumetric weights. */
  volumetricWeightKg: number;
  /** Sum of per-box chargeable weights (max actual/volumetric). */
  chargeableWeightKg?: number;
  finalPackagePhoto: string | null;
  finalPackagePhotoStoragePath: string | null;
  /** @deprecated legacy alias of shippingLabelGenerated */
  labelGenerated: boolean;
  courierSlipGenerated: boolean;
  shippingLabelGenerated: boolean;
  /** @deprecated no longer surfaced in the UI */
  packingSlipGenerated?: boolean;
  status: LogisticsBookingStatus;
  /** Wizard step while booking is still in progress (`null` once confirmed). */
  wizardStep?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
}

/** @deprecated Prefer LogisticsPartnerId from logisticsPartners */
export type CourierPartnerId = LogisticsPartnerId | 'ecosafe' | 'aps' | 'transport_lorry';
