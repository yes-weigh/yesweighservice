export type CourierPartnerId =
  | 'delhivery'
  | 'bluedart'
  | 'dtdc'
  | 'trackon'
  | 'st_courier'
  | 'ecosafe'
  | 'aps'
  | 'transport_lorry'
  | 'own_vehicle'
  | 'customer_pickup';

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
