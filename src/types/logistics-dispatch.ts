import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { StaffLogisticsSite } from './staff-logistics';

export type LogisticsBookingStatus =
  | 'label_generated'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'returned';

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
  /** Draft-side id used to keep local captures linked across save/resume. */
  clientPhotoId?: string | null;
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
  /** Linked SO number when booking from an invoice (used as Delhivery shipper reference). */
  salesOrderNumber?: string | null;
  /** Invoice grand total (INR) for courier invoice value / FOV. */
  invoiceValueInr?: number | null;
  /** Consignee GSTIN from invoice / Zoho customer when available. */
  customerGstin?: string | null;
  /** Consignee phone from invoice when dealer snapshot phone is missing. */
  customerPhone?: string | null;
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
  /** Set when resuming a saved booking; wizard resolves this to a display URL. */
  finalPackagePhotoStoragePath?: string | null;
  labelGenerated: boolean;
  /**
   * Delhivery only: FOD (consignee pays freight) vs BTC (bill to client).
   * Sent as freight_mode on manifest create when FOD.
   */
  freightBillingMode?: LogisticsFreightBillingMode | null;
  /** Delhivery first-mile pickup after Create LR (stashed until persist). */
  delhiveryPickup?: LogisticsDelhiveryPickup | null;
  /** Delhivery Master AWB (MWB) when known at Create LR. */
  masterAwb?: string | null;
}

/** Persisted ST Courier track snapshot (from hourly sync / live fetch). */
export interface LogisticsCourierTrackHistoryItem {
  at: string;
  location: string;
  activity: string;
}

export interface LogisticsCourierTrack {
  awb: string;
  ok: boolean;
  error: string | null;
  status: string | null;
  /** Delhivery StatusType when present (DL / UD / RT / CN / …). */
  statusType?: string | null;
  /** Delhivery Master AWB (MWB) when track used Express packages/json fallback. */
  masterAwb?: string | null;
  origin: string | null;
  destination: string | null;
  consignmentType: string | null;
  bookedAt: string | null;
  /** Courier delivery date/time string when available. */
  deliveredAt: string | null;
  history: LogisticsCourierTrackHistoryItem[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Delhivery freight billing: FOD = consignee pays freight; BTC = bill to client. */
export type LogisticsFreightBillingMode = 'fod' | 'btc';

/** Delhivery first-mile pickup request snapshot (after Create LR). */
export interface LogisticsDelhiveryPickup {
  ok: boolean;
  alreadyExisted?: boolean;
  pickupId: string | null;
  pickupLocationName?: string | null;
  pickupDate?: string | null;
  pickupTime?: string | null;
  expectedPackageCount?: number | null;
  message?: string | null;
  requestedAt: string;
}

/** Delhivery freight-breakup snapshot (after weight captured). */
export interface LogisticsCourierFreightBreakup {
  baseFreightCharge: number | null;
  fuelSurcharge: number | null;
  fuelHike: number | null;
  insuranceRov: number | null;
  odaFm: number | null;
  odaLm: number | null;
  fm: number | null;
  lm: number | null;
  green: number | null;
  preTaxFreight: number | null;
  gst: number | null;
  gstPercent: number | null;
  markup: number | null;
  otherHandlingCharges: number | null;
}

export interface LogisticsCourierFreight {
  ok: boolean;
  lrn: string;
  totalInr: number | null;
  chargedWeightKg: number | null;
  minChargedWeightKg: number | null;
  breakup: LogisticsCourierFreightBreakup | null;
  /** FOD / BTC when known from API or ops. */
  billingMode?: LogisticsFreightBillingMode | null;
  error: string | null;
  fetchedAt: string;
  source: string;
}

/** Destination delivery-office contact from ST pincode search (fetched once). */
export interface LogisticsCourierDeliveryOffice {
  pincode: string;
  communication: string;
  serviceCenter?: string | null;
  hubCenter?: string | null;
  sourceUrl: string;
  fetchedAt: string;
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
  /** Delhivery Master AWB (MWB) when known. */
  masterAwb?: string | null;
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
  /** Last persisted ST Courier track (status + history). */
  courierTrack?: LogisticsCourierTrack | null;
  /** ISO timestamp of last ST track fetch (mirrors courierTrack.fetchedAt). */
  trackFetchedAt?: string | null;
  /** Delhivery actual freight from freight-breakup API (post weight capture). */
  courierFreight?: LogisticsCourierFreight | null;
  /** Convenience mirror of courierFreight.totalInr when available. */
  actualFreightInr?: number | null;
  /** ISO timestamp of last Delhivery freight-breakup fetch. */
  freightFetchedAt?: string | null;
  /** Delhivery freight billing: fod (consignee) or btc (bill to client). */
  freightBillingMode?: LogisticsFreightBillingMode | null;
  /** How freightBillingMode was set: booking UI, Delhivery API, estimate inference, or ops. */
  freightBillingModeSource?: 'booking' | 'api' | 'inferred' | 'manual' | null;
  /** Delhivery first-mile pickup request (auto after Create LR). */
  delhiveryPickup?: LogisticsDelhiveryPickup | null;
  /** Set when this booking's BTC freight Diff was fully settled onto an invoiced SO. */
  freightDiffSettledAt?: string | null;
  freightDiffSettledInvoiceId?: string | null;
  freightDiffSettledSalesOrderId?: string | null;
  /** Destination office Communication from ST pincode search (once per booking). */
  courierDeliveryOffice?: LogisticsCourierDeliveryOffice | null;
  /** ISO or ST delivery timestamp when booking was marked delivered via sync. */
  deliveredAt?: string | null;
  inTransitAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  createdByName: string;
}

/** @deprecated Prefer LogisticsPartnerId from logisticsPartners */
export type CourierPartnerId = LogisticsPartnerId | 'ecosafe' | 'aps' | 'transport_lorry';
