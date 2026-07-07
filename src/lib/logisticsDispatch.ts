import type {
  CourierDispatch,
  CourierDispatchBox,
  CourierDispatchPhase,
  CourierPartnerFormDraft,
  CourierPartnerId,
} from '../types/logistics-dispatch';

export const COURIER_DISPATCH_PHASES: ReadonlyArray<{
  id: CourierDispatchPhase;
  label: string;
  description: string;
}> = [
  {
    id: 'courier_assigned',
    label: 'Courier Assigned',
    description: 'Courier selected, tracking number entered.',
  },
  {
    id: 'label_generated',
    label: 'Label Generated',
    description: 'Print shipping label for each box.',
  },
  {
    id: 'handover_pending',
    label: 'Handover Pending',
    description: 'Boxes ready to hand over to courier.',
  },
  {
    id: 'pickup_completed',
    label: 'Pickup Completed',
    description: 'Courier pickup photo / receipt uploaded.',
  },
  {
    id: 'in_transit',
    label: 'In Transit',
    description: 'Tracking active.',
  },
  {
    id: 'delivered',
    label: 'Delivered',
    description: 'POD / delivery proof uploaded.',
  },
];

const MOCK_BOX_SPECS = [
  { productCount: 4, weightKg: 18 },
  { productCount: 3, weightKg: 12 },
  { productCount: 2, weightKg: 8 },
];

export function createMockPackedBoxes(
  trackingNumber: string,
  boxCount = 3,
): CourierDispatchBox[] {
  return Array.from({ length: boxCount }, (_, index) => {
    const spec = MOCK_BOX_SPECS[index] ?? { productCount: 1, weightKg: 5 };
    return {
      id: `box-${index + 1}`,
      boxNumber: index + 1,
      totalBoxes: boxCount,
      productCount: spec.productCount,
      weightKg: spec.weightKg,
      trackingNumber,
      status: 'ready',
      labelGenerated: false,
      photoFileName: null,
    };
  });
}

export function createCourierDispatch(
  draft: CourierPartnerFormDraft,
  orderRef = 'ORD-2026-0042',
): CourierDispatch | null {
  if (!draft.courierPartnerId || !draft.trackingNumber.trim()) return null;

  const boxCount = Math.max(1, Number.parseInt(draft.numberOfBoxes, 10) || 1);
  const totalWeightKg = Number.parseFloat(draft.totalWeightKg) || 0;
  const freightCharge = draft.freightCharge.trim()
    ? Number.parseFloat(draft.freightCharge)
    : null;

  return {
    id: `dispatch-${Date.now()}`,
    orderRef,
    courierPartnerId: draft.courierPartnerId,
    trackingNumber: draft.trackingNumber.trim(),
    freightCharge: Number.isFinite(freightCharge) ? freightCharge : null,
    expectedDeliveryDate: draft.expectedDeliveryDate,
    numberOfBoxes: boxCount,
    totalWeightKg,
    lrReceiptFileName: draft.lrReceiptFileName,
    remarks: draft.remarks.trim(),
    pickupReceiptFileName: null,
    podFileName: null,
    boxes: createMockPackedBoxes(draft.trackingNumber.trim(), boxCount),
    status: 'active',
    createdAt: new Date().toISOString(),
    dispatchedAt: null,
  };
}

export function emptyCourierFormDraft(): CourierPartnerFormDraft {
  return {
    courierPartnerId: null,
    trackingNumber: '',
    freightCharge: '',
    expectedDeliveryDate: '',
    numberOfBoxes: '3',
    totalWeightKg: '38',
    lrReceiptFileName: null,
    remarks: '',
  };
}

export function allBoxesLabeled(dispatch: CourierDispatch): boolean {
  return dispatch.boxes.length > 0 && dispatch.boxes.every(box => box.labelGenerated);
}

export function allBoxPhotosUploaded(dispatch: CourierDispatch): boolean {
  return dispatch.boxes.length > 0 && dispatch.boxes.every(box => Boolean(box.photoFileName));
}

export function allBoxesPickedUp(dispatch: CourierDispatch): boolean {
  return dispatch.boxes.length > 0 && dispatch.boxes.every(box => box.status === 'picked_up');
}

export function canMarkDispatched(dispatch: CourierDispatch): boolean {
  return dispatch.status === 'active'
    && Boolean(dispatch.courierPartnerId)
    && Boolean(dispatch.trackingNumber.trim())
    && allBoxesLabeled(dispatch)
    && allBoxPhotosUploaded(dispatch)
    && Boolean(dispatch.pickupReceiptFileName);
}

export function computeActivePhase(dispatch: CourierDispatch): CourierDispatchPhase {
  if (dispatch.status === 'dispatched' || dispatch.podFileName) return 'delivered';
  if (allBoxesPickedUp(dispatch) && dispatch.pickupReceiptFileName) return 'in_transit';
  if (dispatch.pickupReceiptFileName && allBoxPhotosUploaded(dispatch)) return 'pickup_completed';
  if (allBoxesLabeled(dispatch)) return 'handover_pending';
  if (dispatch.courierPartnerId && dispatch.trackingNumber.trim()) return 'label_generated';
  return 'courier_assigned';
}

export function phaseIndex(phase: CourierDispatchPhase): number {
  return COURIER_DISPATCH_PHASES.findIndex(item => item.id === phase);
}

export function isPhaseComplete(dispatch: CourierDispatch, phase: CourierDispatchPhase): boolean {
  if (dispatch.status === 'dispatched') return true;
  const active = computeActivePhase(dispatch);
  return phaseIndex(phase) < phaseIndex(active);
}

export function boxStatusLabel(status: CourierDispatchBox['status']): string {
  switch (status) {
    case 'label_printed':
      return 'Label Printed';
    case 'picked_up':
      return 'Picked Up';
    default:
      return 'Ready';
  }
}

export function trackingUrl(partnerId: CourierPartnerId, trackingNumber: string): string | null {
  const encoded = encodeURIComponent(trackingNumber.trim());
  if (!encoded) return null;
  switch (partnerId) {
    case 'delhivery':
      return `https://www.delhivery.com/track/package/${encoded}`;
    case 'bluedart':
      return `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${encoded}`;
    case 'dtdc':
      return `https://www.dtdc.in/tracking.asp?strCnno=${encoded}`;
    case 'trackon':
      return `https://trackon.in/Tracking/t1.jsp?txtAction=track&txtAWBNo=${encoded}`;
    default:
      return null;
  }
}
