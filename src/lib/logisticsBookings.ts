import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import { isLogisticsPartnerId, logisticsPartnerLabel } from '../constants/logisticsPartners';
import type { User } from '../types';
import { normalizeRole } from '../types';
import { isInternalOpsUser } from './staffAccess';
import { resolveDeliveryAddress } from './logisticsDealers';
import {
  computeVolumetricWeight,
  draftBoxesHaveRequiredPhotos,
  statusForDocument,
  type BookCourierStep,
} from './logisticsBooking';
import {
  dataUrlToFile,
  resolveLogisticsPhotoUrl,
  uploadLogisticsPhoto,
} from './logisticsPhotos';
import { loadLogisticsSettings } from './logisticsSettings';
import type {
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsBookingStatus,
  LogisticsDealerSnapshot,
  LogisticsDocumentType,
  ShipmentBox,
  ShipmentBoxDraft,
} from '../types/logistics-dispatch';
import { isStaffLogisticsSite } from '../types/staff-logistics';

const COLLECTION = 'logisticsBookings';

export interface LogisticsBookingListFilters {
  status?: LogisticsBookingStatus | '';
  partnerId?: LogisticsPartnerId | '';
  query?: string;
}

export interface PersistLogisticsBookingInput {
  draft: LogisticsBookingDraft;
  dealer: LogisticsDealerSnapshot;
  createdBy: User;
  /** When confirming or updating an existing draft booking. */
  existingBookingId?: string | null;
  /** Wizard step stored on draft saves for resume. */
  wizardStep?: string | null;
}

function resolveDealerIdForUser(user: User): string {
  if (user.role === 'dealer') return user.uid;
  if (user.dealerId) return user.dealerId;
  return user.uid;
}

function isEditableStatus(status: LogisticsBookingStatus): boolean {
  return status !== 'in_transit' && status !== 'delivered' && status !== 'cancelled';
}

/** Map legacy/unknown status values onto the current pipeline statuses. */
function normalizeBookingStatus(raw: string): LogisticsBookingStatus {
  switch (raw) {
    case 'draft':
    case 'label_generated':
    case 'in_transit':
    case 'delivered':
    case 'cancelled':
      return raw;
    case 'booked':
    case 'courier_booked':
    case 'pickup_pending':
    default:
      return 'booked';
  }
}

function mapShipmentBox(data: DocumentData): ShipmentBox {
  const photos = Array.isArray(data.photos)
    ? data.photos
        .map((photo: unknown) => (typeof photo === 'string' ? photo : (photo as DocumentData)?.storagePath))
        .filter((path: unknown): path is string => typeof path === 'string' && path.length > 0)
        .map((storagePath: string) => ({ storagePath, url: null as string | null }))
    : [];
  return {
    id: String(data.id ?? ''),
    lengthCm: data.lengthCm == null ? null : Number(data.lengthCm),
    widthCm: data.widthCm == null ? null : Number(data.widthCm),
    heightCm: data.heightCm == null ? null : Number(data.heightCm),
    weightKg: Number(data.weightKg) || 0,
    volumetricWeightKg: Number(data.volumetricWeightKg) || 0,
    photos,
  };
}

async function hydrateBookingPhotos(booking: LogisticsBooking): Promise<LogisticsBooking> {
  const boxes = await Promise.all(booking.boxes.map(async box => ({
    ...box,
    photos: await Promise.all(box.photos.map(async photo => ({
      ...photo,
      url: photo.storagePath ? await resolveLogisticsPhotoUrl(photo.storagePath) : null,
    }))),
  })));
  const finalPhotoUrl = booking.finalPackagePhotoStoragePath
    ? await resolveLogisticsPhotoUrl(booking.finalPackagePhotoStoragePath)
    : null;
  return {
    ...booking,
    boxes,
    finalPackagePhoto: finalPhotoUrl,
  };
}

export function mapLogisticsBookingDoc(id: string, data: DocumentData): LogisticsBooking {
  const dealer = (data.dealerSnapshot ?? {}) as LogisticsDealerSnapshot;
  const partnerId = isLogisticsPartnerId(String(data.partnerId ?? ''))
    ? String(data.partnerId) as LogisticsPartnerId
    : 'st_courier';
  const status = normalizeBookingStatus(String(data.status ?? 'booked'));
  const shipmentMode = data.shipmentMode === 'envelope' ? 'envelope' : 'box';
  const boxes = Array.isArray(data.boxes)
    ? data.boxes.map((box: DocumentData) => mapShipmentBox(box))
    : [];
  const numberOfBoxes = boxes.length || Number(data.numberOfBoxes) || 1;
  const actualWeightKg = boxes.length
    ? boxes.reduce((total, box) => total + box.weightKg, 0)
    : Number(data.actualWeightKg) || 0;
  const volumetricWeightKg = boxes.length
    ? boxes.reduce((total, box) => total + box.volumetricWeightKg, 0)
    : Number(data.volumetricWeightKg) || 0;
  const chargeableWeightKg = typeof data.chargeableWeightKg === 'number'
    ? data.chargeableWeightKg
    : boxes.length
      ? boxes.reduce((total, box) => total + Math.max(box.weightKg || 0, box.volumetricWeightKg || 0), 0)
      : Math.max(actualWeightKg, volumetricWeightKg);

  return {
    id,
    orderRef: String(data.orderRef ?? ''),
    source: (data.source === 'invoice' || data.source === 'support') ? data.source : 'manual',
    invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : null,
    invoiceNumber: typeof data.invoiceNumber === 'string' ? data.invoiceNumber : null,
    supportRequestId: typeof data.supportRequestId === 'string' ? data.supportRequestId : null,
    supportRequestNumber: typeof data.supportRequestNumber === 'string' ? data.supportRequestNumber : null,
    partnerId,
    consignmentNo: String(data.consignmentNo ?? ''),
    trackingNo: String(data.trackingNo ?? data.consignmentNo ?? ''),
    branch: String(data.branch ?? ''),
    serviceType: String(data.serviceType ?? ''),
    bookingDate: String(data.bookingDate ?? ''),
    dealer,
    deliveryAddressKind: data.deliveryAddressKind === 'billing' ? 'billing' : 'shipping',
    deliveryAddress: String(data.deliveryAddress ?? resolveDeliveryAddress(dealer, 'shipping')),
    shipFromSite: isStaffLogisticsSite(data.shipFromSite) ? data.shipFromSite : 'head_office',
    shipFromAddress: String(data.shipFromAddress ?? ''),
    shipmentMode,
    boxes,
    numberOfBoxes,
    actualWeightKg,
    volumetricWeightKg,
    chargeableWeightKg,
    finalPackagePhoto: null,
    finalPackagePhotoStoragePath: typeof data.finalPackagePhotoStoragePath === 'string'
      ? data.finalPackagePhotoStoragePath
      : null,
    labelGenerated: Boolean(data.shippingLabelGenerated ?? data.labelGenerated),
    courierSlipGenerated: Boolean(data.courierSlipGenerated),
    shippingLabelGenerated: Boolean(data.shippingLabelGenerated ?? data.labelGenerated),
    packingSlipGenerated: Boolean(data.packingSlipGenerated),
    status,
    wizardStep: typeof data.wizardStep === 'string' ? data.wizardStep : null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? data.createdAt ?? ''),
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: String(data.createdByName ?? ''),
  };
}

function matchesClientFilters(booking: LogisticsBooking, filters: LogisticsBookingListFilters): boolean {
  if (filters.status && booking.status !== filters.status) return false;
  if (filters.partnerId && booking.partnerId !== filters.partnerId) return false;
  const q = filters.query?.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    booking.consignmentNo,
    booking.trackingNo,
    booking.orderRef,
    booking.dealer.name,
    booking.dealer.code,
    booking.invoiceNumber,
    booking.supportRequestNumber,
    logisticsPartnerLabel(booking.partnerId),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

async function uploadDraftBoxPhotos(
  bookingId: string,
  draft: LogisticsBookingDraft,
  existingFinalPackagePhotoStoragePath: string | null = null,
): Promise<{
  boxes: ShipmentBox[];
  finalPackagePhotoStoragePath: string | null;
}> {
  const isEnvelope = draft.shipmentMode === 'envelope';
  const boxes = await Promise.all(draft.boxes.map(async (box, boxIndex) => {
    const photos = await Promise.all(box.photos.map(async (photo, photoIndex) => {
      if (photo.storagePath) return { storagePath: photo.storagePath, url: photo.url ?? null };
      if (!photo.url || !photo.url.startsWith('data:')) return null;
      const file = await dataUrlToFile(photo.url, `box-${boxIndex + 1}-${photoIndex + 1}.jpg`);
      const storagePath = await uploadLogisticsPhoto(bookingId, `box-${box.id}-${photo.id}`, file);
      return { storagePath, url: photo.url };
    }));
    const length = !isEnvelope && box.lengthCm ? Number.parseFloat(box.lengthCm) : null;
    const width = !isEnvelope && box.widthCm ? Number.parseFloat(box.widthCm) : null;
    const height = !isEnvelope && box.heightCm ? Number.parseFloat(box.heightCm) : null;
    return {
      id: box.id,
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      weightKg: isEnvelope ? 0 : (Number.parseFloat(box.weightKg) || 0),
      volumetricWeightKg: isEnvelope ? 0 : computeVolumetricWeight(length, width, height),
      photos: photos.filter((photo): photo is NonNullable<typeof photo> => Boolean(photo)),
    } satisfies ShipmentBox;
  }));

  let finalPackagePhotoStoragePath: string | null = existingFinalPackagePhotoStoragePath;
  if (draft.finalPackagePhoto?.startsWith('data:')) {
    const file = await dataUrlToFile(draft.finalPackagePhoto, 'final-package.jpg');
    finalPackagePhotoStoragePath = await uploadLogisticsPhoto(bookingId, 'final-package', file);
  }

  return { boxes, finalPackagePhotoStoragePath };
}

async function buildBookingPayload(input: PersistLogisticsBookingInput & {
  bookingId: string;
  status: LogisticsBookingStatus;
  createdAt: string;
  existingFinalPackagePhotoStoragePath?: string | null;
  existingOrderRef?: string | null;
}): Promise<Record<string, unknown>> {
  const {
    draft,
    dealer,
    createdBy,
    bookingId,
    status,
    createdAt,
    wizardStep,
    existingFinalPackagePhotoStoragePath = null,
    existingOrderRef = null,
  } = input;
  const settings = await loadLogisticsSettings();
  const shipFromAddress = settings.fromAddresses[draft.shipFromSite]?.trim() || '';
  const now = new Date().toISOString();
  const orderRef = existingOrderRef
    || draft.invoiceNumber
    || draft.supportRequestNumber
    || `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const { boxes, finalPackagePhotoStoragePath } = await uploadDraftBoxPhotos(
    bookingId,
    draft,
    existingFinalPackagePhotoStoragePath,
  );
  const actualWeightKg = boxes.reduce((total, box) => total + box.weightKg, 0);
  const volumetricWeightKg = boxes.reduce((total, box) => total + box.volumetricWeightKg, 0);
  const chargeableWeightKg = boxes.reduce(
    (total, box) => total + Math.max(box.weightKg || 0, box.volumetricWeightKg || 0),
    0,
  );
  const createdByName = (
    createdBy.displayName?.trim()
    || createdBy.loginId?.trim()
    || createdBy.email?.trim()
    || 'YESWEIGH'
  );

  return {
    orderRef,
    source: draft.source,
    invoiceId: draft.invoiceId ?? null,
    invoiceNumber: draft.invoiceNumber ?? null,
    supportRequestId: draft.supportRequestId ?? null,
    supportRequestNumber: draft.supportRequestNumber ?? null,
    partnerId: draft.partnerId,
    consignmentNo: draft.consignmentNo.trim(),
    trackingNo: draft.consignmentNo.trim(),
    branch: draft.branch.trim(),
    serviceType: draft.serviceType.trim(),
    bookingDate: draft.bookingDate || new Date().toISOString().slice(0, 10),
    zohoCustomerId: draft.zohoCustomerId,
    dealerId: draft.dealerId,
    dealerSnapshot: {
      zohoCustomerId: dealer.zohoCustomerId,
      dealerId: dealer.dealerId,
      name: dealer.name,
      code: dealer.code,
      contactPerson: dealer.contactPerson,
      mobile: dealer.mobile,
      shippingAddress: dealer.shippingAddress,
      billingAddress: dealer.billingAddress,
      ...(dealer.destinationCity?.trim()
        ? { destinationCity: dealer.destinationCity.trim() }
        : {}),
    },
    deliveryAddressKind: draft.deliveryAddressKind,
    deliveryAddress: resolveDeliveryAddress(dealer, draft.deliveryAddressKind),
    shipFromSite: draft.shipFromSite,
    shipFromAddress,
    shipmentMode: draft.shipmentMode,
    numberOfBoxes: Math.max(boxes.length, 1),
    actualWeightKg,
    volumetricWeightKg,
    chargeableWeightKg,
    boxes: boxes.map(box => ({
      id: box.id,
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
      weightKg: box.weightKg,
      volumetricWeightKg: box.volumetricWeightKg,
      photos: box.photos.map(photo => ({ storagePath: photo.storagePath })),
    })),
    finalPackagePhotoStoragePath: finalPackagePhotoStoragePath ?? null,
    labelGenerated: Boolean(draft.labelGenerated),
    courierSlipGenerated: Boolean(draft.labelGenerated),
    shippingLabelGenerated: Boolean(draft.labelGenerated),
    packingSlipGenerated: false,
    status,
    wizardStep: status === 'draft' ? (wizardStep ?? null) : null,
    createdAt,
    updatedAt: now,
    createdByUid: createdBy.uid,
    createdByName,
  };
}

function formatLogisticsPersistError(err: unknown, fallback: string): Error {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const code = typeof err === 'object' && err && 'code' in err
    ? String((err as { code?: string }).code ?? '')
    : '';
  if (code.includes('permission-denied') || /permission/i.test(message)) {
    return new Error(
      'Could not save logistics booking (permission denied). Deploy the latest Firestore rules that allow status “draft”.',
    );
  }
  if (/unsupported field value|undefined/i.test(message)) {
    return new Error('Could not save logistics booking because some fields were empty. Try again.');
  }
  return err instanceof Error ? err : new Error(fallback);
}

/** Build box records for a draft without uploading new data-URL photos. */
function boxesWithoutNewUploads(draft: LogisticsBookingDraft): ShipmentBox[] {
  const isEnvelope = draft.shipmentMode === 'envelope';
  return draft.boxes.map(box => {
    const length = !isEnvelope && box.lengthCm ? Number.parseFloat(box.lengthCm) : null;
    const width = !isEnvelope && box.widthCm ? Number.parseFloat(box.widthCm) : null;
    const height = !isEnvelope && box.heightCm ? Number.parseFloat(box.heightCm) : null;
    return {
      id: box.id,
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      weightKg: isEnvelope ? 0 : (Number.parseFloat(box.weightKg) || 0),
      volumetricWeightKg: isEnvelope ? 0 : computeVolumetricWeight(length, width, height),
      photos: box.photos
        .filter(photo => Boolean(photo.storagePath))
        .map(photo => ({ storagePath: photo.storagePath as string, url: photo.url ?? null })),
    };
  });
}

function draftHasPendingPhotoUploads(draft: LogisticsBookingDraft): boolean {
  const pendingBoxes = draft.boxes.some(box =>
    box.photos.some(photo => !photo.storagePath && Boolean(photo.url?.startsWith('data:'))),
  );
  const pendingFinal = Boolean(draft.finalPackagePhoto?.startsWith('data:'));
  return pendingBoxes || pendingFinal;
}

/**
 * Storage rules for logistics photos allow ops create without a booking doc,
 * but reads (and some environments) expect the booking to exist first.
 * Write a minimal draft stub before uploading new photos when creating.
 */
async function ensureDraftBookingStub(input: {
  bookingRef: ReturnType<typeof doc>;
  draft: LogisticsBookingDraft;
  dealer: LogisticsDealerSnapshot;
  createdBy: User;
  createdAt: string;
  existingOrderRef: string | null;
  existingCreatedByUid: string | null;
  existingCreatedByName: string | null;
  isNew: boolean;
}): Promise<void> {
  if (!input.isNew) return;
  const now = new Date().toISOString();
  const orderRef = input.existingOrderRef
    || input.draft.invoiceNumber
    || input.draft.supportRequestNumber
    || `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const createdByName = input.existingCreatedByName
    || input.createdBy.displayName?.trim()
    || input.createdBy.loginId?.trim()
    || input.createdBy.email?.trim()
    || 'YESWEIGH';
  await setDoc(input.bookingRef, {
    orderRef,
    source: input.draft.source,
    invoiceId: input.draft.invoiceId ?? null,
    invoiceNumber: input.draft.invoiceNumber ?? null,
    supportRequestId: input.draft.supportRequestId ?? null,
    supportRequestNumber: input.draft.supportRequestNumber ?? null,
    partnerId: input.draft.partnerId,
    consignmentNo: input.draft.consignmentNo.trim(),
    trackingNo: input.draft.consignmentNo.trim(),
    branch: input.draft.branch.trim(),
    serviceType: input.draft.serviceType.trim(),
    bookingDate: input.draft.bookingDate || now.slice(0, 10),
    zohoCustomerId: input.draft.zohoCustomerId,
    dealerId: input.draft.dealerId,
    dealerSnapshot: {
      zohoCustomerId: input.dealer.zohoCustomerId,
      dealerId: input.dealer.dealerId,
      name: input.dealer.name,
      code: input.dealer.code,
      contactPerson: input.dealer.contactPerson,
      mobile: input.dealer.mobile,
      shippingAddress: input.dealer.shippingAddress,
      billingAddress: input.dealer.billingAddress,
      ...(input.dealer.destinationCity?.trim()
        ? { destinationCity: input.dealer.destinationCity.trim() }
        : {}),
    },
    deliveryAddressKind: input.draft.deliveryAddressKind,
    deliveryAddress: resolveDeliveryAddress(input.dealer, input.draft.deliveryAddressKind),
    shipFromSite: input.draft.shipFromSite,
    shipFromAddress: '',
    shipmentMode: input.draft.shipmentMode,
    numberOfBoxes: Math.max(input.draft.boxes.length, 1),
    actualWeightKg: 0,
    volumetricWeightKg: 0,
    chargeableWeightKg: 0,
    boxes: input.draft.boxes.map(box => ({
      id: box.id,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      weightKg: 0,
      volumetricWeightKg: 0,
      photos: [],
    })),
    finalPackagePhotoStoragePath: null,
    labelGenerated: false,
    courierSlipGenerated: false,
    shippingLabelGenerated: false,
    packingSlipGenerated: false,
    status: 'draft',
    wizardStep: 'box',
    createdAt: input.createdAt,
    updatedAt: now,
    createdByUid: input.existingCreatedByUid || input.createdBy.uid,
    createdByName,
  }, { merge: true });
}

export async function persistLogisticsBookingDraft(
  input: PersistLogisticsBookingInput,
): Promise<LogisticsBooking> {
  const { draft, dealer, createdBy, existingBookingId, wizardStep } = input;
  if (!draft.zohoCustomerId.trim()) throw new Error('Select a dealer before saving a draft.');

  const now = new Date().toISOString();
  const isNew = !existingBookingId;
  const bookingRef = existingBookingId
    ? doc(db, COLLECTION, existingBookingId)
    : doc(collection(db, COLLECTION));

  let createdAt = now;
  let existingFinalPackagePhotoStoragePath: string | null = null;
  let existingOrderRef: string | null = null;
  let existingCreatedByUid: string | null = null;
  let existingCreatedByName: string | null = null;
  let existingBoxes: ShipmentBox[] = [];
  if (existingBookingId) {
    const existing = await getDoc(bookingRef);
    if (!existing.exists()) throw new Error('Draft booking not found.');
    const existingStatus = normalizeBookingStatus(String(existing.data()?.status ?? 'booked'));
    if (existingStatus !== 'draft') {
      throw new Error('Only draft bookings can be updated this way.');
    }
    createdAt = String(existing.data()?.createdAt ?? now);
    existingFinalPackagePhotoStoragePath = typeof existing.data()?.finalPackagePhotoStoragePath === 'string'
      ? existing.data()?.finalPackagePhotoStoragePath
      : null;
    existingOrderRef = typeof existing.data()?.orderRef === 'string'
      ? existing.data()?.orderRef
      : null;
    existingCreatedByUid = typeof existing.data()?.createdByUid === 'string'
      ? existing.data()?.createdByUid
      : null;
    existingCreatedByName = typeof existing.data()?.createdByName === 'string'
      ? existing.data()?.createdByName
      : null;
    existingBoxes = Array.isArray(existing.data()?.boxes)
      ? existing.data()!.boxes.map((box: DocumentData) => mapShipmentBox(box))
      : [];
  }

  try {
    if (draftHasPendingPhotoUploads(draft)) {
      await ensureDraftBookingStub({
        bookingRef,
        draft,
        dealer,
        createdBy,
        createdAt,
        existingOrderRef,
        existingCreatedByUid,
        existingCreatedByName,
        isNew,
      });
    }

    let photoResult: {
      boxes: ShipmentBox[];
      finalPackagePhotoStoragePath: string | null;
    };
    let photoUploadWarning = '';
    try {
      photoResult = await uploadDraftBoxPhotos(
        bookingRef.id,
        draft,
        existingFinalPackagePhotoStoragePath,
      );
    } catch (photoErr) {
      // Never wipe newly captured data-URL photos by saving an empty photo list.
      if (draftHasPendingPhotoUploads(draft)) {
        throw photoErr instanceof Error
          ? photoErr
          : new Error('Could not upload package photos. Try again.');
      }
      photoUploadWarning = photoErr instanceof Error
        ? photoErr.message
        : 'Some photos could not be uploaded.';
      // Prefer already-stored photos on the draft, else keep whatever was on the server.
      const fallbackBoxes = boxesWithoutNewUploads(draft);
      photoResult = {
        boxes: fallbackBoxes.map(box => {
          if (box.photos.length) return box;
          const existing = existingBoxes.find(item => item.id === box.id);
          return existing ? { ...box, photos: existing.photos } : box;
        }),
        finalPackagePhotoStoragePath: existingFinalPackagePhotoStoragePath,
      };
    }

    const settings = await loadLogisticsSettings();
    const shipFromAddress = settings.fromAddresses[draft.shipFromSite]?.trim() || '';
    const orderRef = existingOrderRef
      || draft.invoiceNumber
      || draft.supportRequestNumber
      || `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const { boxes, finalPackagePhotoStoragePath } = photoResult;
    const actualWeightKg = boxes.reduce((total, box) => total + box.weightKg, 0);
    const volumetricWeightKg = boxes.reduce((total, box) => total + box.volumetricWeightKg, 0);
    const chargeableWeightKg = boxes.reduce(
      (total, box) => total + Math.max(box.weightKg || 0, box.volumetricWeightKg || 0),
      0,
    );
    const createdByName = existingCreatedByName
      || createdBy.displayName?.trim()
      || createdBy.loginId?.trim()
      || createdBy.email?.trim()
      || 'YESWEIGH';
    const labelsPrinted = Boolean(draft.labelGenerated);

    const photosReady = boxes.every(box => box.photos.length > 0);
    const storedWizardStep = (
      (wizardStep === 'review' || wizardStep === 'label' || wizardStep === 'final_photo')
      && !photosReady
    )
      ? 'box'
      : (wizardStep ?? 'box');

    const payload: Record<string, unknown> = {
      orderRef,
      source: draft.source,
      invoiceId: draft.invoiceId ?? null,
      invoiceNumber: draft.invoiceNumber ?? null,
      supportRequestId: draft.supportRequestId ?? null,
      supportRequestNumber: draft.supportRequestNumber ?? null,
      partnerId: draft.partnerId,
      consignmentNo: draft.consignmentNo.trim(),
      trackingNo: draft.consignmentNo.trim(),
      branch: draft.branch.trim(),
      serviceType: draft.serviceType.trim(),
      bookingDate: draft.bookingDate || now.slice(0, 10),
      zohoCustomerId: draft.zohoCustomerId,
      dealerId: draft.dealerId,
      dealerSnapshot: {
        zohoCustomerId: dealer.zohoCustomerId,
        dealerId: dealer.dealerId,
        name: dealer.name,
        code: dealer.code,
        contactPerson: dealer.contactPerson,
        mobile: dealer.mobile,
        shippingAddress: dealer.shippingAddress,
        billingAddress: dealer.billingAddress,
        ...(dealer.destinationCity?.trim()
          ? { destinationCity: dealer.destinationCity.trim() }
          : {}),
      },
      deliveryAddressKind: draft.deliveryAddressKind,
      deliveryAddress: resolveDeliveryAddress(dealer, draft.deliveryAddressKind),
      shipFromSite: draft.shipFromSite,
      shipFromAddress,
      shipmentMode: draft.shipmentMode,
      numberOfBoxes: Math.max(boxes.length, 1),
      actualWeightKg,
      volumetricWeightKg,
      chargeableWeightKg,
      boxes: boxes.map(box => ({
        id: box.id,
        lengthCm: box.lengthCm,
        widthCm: box.widthCm,
        heightCm: box.heightCm,
        weightKg: box.weightKg,
        volumetricWeightKg: box.volumetricWeightKg,
        photos: box.photos.map(photo => ({ storagePath: photo.storagePath })),
      })),
      finalPackagePhotoStoragePath: finalPackagePhotoStoragePath ?? null,
      labelGenerated: labelsPrinted,
      courierSlipGenerated: labelsPrinted,
      shippingLabelGenerated: labelsPrinted,
      packingSlipGenerated: false,
      status: 'draft',
      wizardStep: storedWizardStep,
      createdAt,
      updatedAt: now,
      createdByUid: existingCreatedByUid || createdBy.uid,
      createdByName,
    };

    await setDoc(bookingRef, payload);
    if (photoUploadWarning && typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.alert(`Draft saved, but photos need attention:\n${photoUploadWarning}`);
      }, 0);
    }
    const booking = mapLogisticsBookingDoc(bookingRef.id, payload);
    return hydrateBookingPhotos(booking);
  } catch (err) {
    throw formatLogisticsPersistError(err, 'Could not save draft.');
  }
}

export async function persistLogisticsBooking(
  input: PersistLogisticsBookingInput,
): Promise<LogisticsBooking> {
  const { draft, dealer, createdBy, existingBookingId } = input;
  if (!draft.consignmentNo.trim()) throw new Error('Consignment number is required.');
  if (!draft.zohoCustomerId.trim()) throw new Error('Select a dealer.');
  if (!draft.boxes.length) throw new Error('Add at least one box.');
  if (draft.boxes.some(box => box.photos.length === 0)) {
    throw new Error('Each box needs at least the inside photo.');
  }
  if (!draft.finalPackagePhoto) throw new Error('Final package photo is required.');

  const now = new Date().toISOString();
  const bookingRef = existingBookingId
    ? doc(db, COLLECTION, existingBookingId)
    : doc(collection(db, COLLECTION));

  let createdAt = now;
  let existingFinalPackagePhotoStoragePath: string | null = null;
  let existingOrderRef: string | null = null;
  if (existingBookingId) {
    const existing = await getDoc(bookingRef);
    if (!existing.exists()) throw new Error('Booking not found.');
    createdAt = String(existing.data()?.createdAt ?? now);
    existingFinalPackagePhotoStoragePath = typeof existing.data()?.finalPackagePhotoStoragePath === 'string'
      ? existing.data()?.finalPackagePhotoStoragePath
      : null;
    existingOrderRef = typeof existing.data()?.orderRef === 'string'
      ? existing.data()?.orderRef
      : null;
  }

  try {
    const labelsPrinted = Boolean(draft.labelGenerated);
    const payload = await buildBookingPayload({
      draft,
      dealer,
      createdBy,
      bookingId: bookingRef.id,
      status: labelsPrinted ? 'label_generated' : 'booked',
      createdAt,
      wizardStep: null,
      existingFinalPackagePhotoStoragePath,
      existingOrderRef,
    });

    await setDoc(bookingRef, payload);
    const booking = mapLogisticsBookingDoc(bookingRef.id, payload);
    return hydrateBookingPhotos(booking);
  } catch (err) {
    throw formatLogisticsPersistError(err, 'Could not save shipment.');
  }
}

/** Convert a saved booking (usually a draft) into wizard draft + step for resume. */
export function bookingToWizardState(booking: LogisticsBooking): {
  draft: LogisticsBookingDraft;
  step: string;
  dealerQuery: string;
} {
  const step = typeof booking.wizardStep === 'string' && booking.wizardStep
    ? booking.wizardStep
    : 'box';
  return {
    dealerQuery: booking.dealer.name || booking.dealer.code || '',
    step,
    draft: {
      partnerId: booking.partnerId,
      source: booking.source,
      invoiceId: booking.invoiceId,
      invoiceNumber: booking.invoiceNumber,
      supportRequestId: booking.supportRequestId,
      supportRequestNumber: booking.supportRequestNumber,
      barcodeRaw: booking.consignmentNo,
      consignmentNo: booking.consignmentNo,
      branch: booking.branch,
      serviceType: booking.serviceType,
      bookingDate: booking.bookingDate,
      zohoCustomerId: booking.dealer.zohoCustomerId || '',
      dealerId: booking.dealer.dealerId || '',
      deliveryAddressKind: booking.deliveryAddressKind,
      shipFromSite: booking.shipFromSite,
      shipmentMode: booking.shipmentMode,
      boxes: booking.boxes.map(box => ({
        id: box.id,
        lengthCm: box.lengthCm == null ? '' : String(box.lengthCm),
        widthCm: box.widthCm == null ? '' : String(box.widthCm),
        heightCm: box.heightCm == null ? '' : String(box.heightCm),
        weightKg: box.weightKg ? String(box.weightKg) : '',
        photos: box.photos
          .filter(photo => Boolean(photo.storagePath || photo.url))
          .map((photo, index) => ({
            id: `saved-${box.id}-${index}`,
            url: photo.url || '',
            storagePath: photo.storagePath,
          })),
      })),
      finalPackagePhoto: booking.finalPackagePhoto,
      labelGenerated: booking.labelGenerated,
    },
  };
}

/** If a draft was saved past Box without package photos, reopen on Box so Next works. */
export function clampWizardStepForDraftPhotos(
  step: BookCourierStep,
  boxes: ReadonlyArray<Pick<ShipmentBoxDraft, 'photos'>>,
): BookCourierStep {
  if (draftBoxesHaveRequiredPhotos(boxes)) return step;
  if (step === 'review' || step === 'label' || step === 'final_photo') return 'box';
  return step;
}

export async function fetchLogisticsBooking(id: string): Promise<LogisticsBooking | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  if (!snap.exists()) return null;
  const booking = mapLogisticsBookingDoc(snap.id, snap.data());
  return hydrateBookingPhotos(booking);
}

async function fetchDealerBookings(user: User): Promise<LogisticsBooking[]> {
  const dealerId = resolveDealerIdForUser(user);
  const queries = [
    query(
      collection(db, COLLECTION),
      where('dealerId', '==', dealerId),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
  ];
  if (user.zohoCustomerId?.trim()) {
    queries.push(
      query(
        collection(db, COLLECTION),
        where('zohoCustomerId', '==', user.zohoCustomerId.trim()),
        orderBy('updatedAt', 'desc'),
        limit(100),
      ),
    );
  }

  const snaps = await Promise.all(queries.map(q => getDocs(q)));
  const byId = new Map<string, LogisticsBooking>();
  for (const snap of snaps) {
    for (const docSnap of snap.docs) {
      byId.set(docSnap.id, mapLogisticsBookingDoc(docSnap.id, docSnap.data()));
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listLogisticsBookings(
  user: User,
  filters: LogisticsBookingListFilters = {},
): Promise<LogisticsBooking[]> {
  const base = isInternalOpsUser(user)
    ? (await getDocs(query(collection(db, COLLECTION), orderBy('updatedAt', 'desc'), limit(250))))
      .docs.map(docSnap => mapLogisticsBookingDoc(docSnap.id, docSnap.data()))
    : await fetchDealerBookings(user);

  const filtered = base.filter(booking => matchesClientFilters(booking, filters));
  return Promise.all(filtered.map(booking => hydrateBookingPhotos(booking)));
}

export function subscribeLogisticsBookings(
  user: User,
  onChange: (bookings: LogisticsBooking[]) => void,
  onError?: (error: Error) => void,
  filters: LogisticsBookingListFilters = {},
): Unsubscribe {
  if (!isInternalOpsUser(user)) {
    let active = true;
    const refresh = () => {
      void listLogisticsBookings(user, filters)
        .then(bookings => { if (active) onChange(bookings); })
        .catch(err => onError?.(err instanceof Error ? err : new Error('Could not load logistics bookings.')));
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }

  const q = query(collection(db, COLLECTION), orderBy('updatedAt', 'desc'), limit(250));

  return onSnapshot(q, async snapshot => {
    try {
      const bookings = await Promise.all(
        snapshot.docs
          .map(docSnap => mapLogisticsBookingDoc(docSnap.id, docSnap.data()))
          .filter(booking => matchesClientFilters(booking, filters))
          .map(booking => hydrateBookingPhotos(booking)),
      );
      onChange(bookings);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error('Could not load logistics bookings.'));
    }
  }, err => {
    onError?.(err instanceof Error ? err : new Error('Could not load logistics bookings.'));
  });
}

export async function generateLogisticsDocument(
  booking: LogisticsBooking,
  document: LogisticsDocumentType,
  user: User,
): Promise<LogisticsBooking> {
  if (!isInternalOpsUser(user)) {
    throw new Error('You do not have permission to generate shipment documents.');
  }
  const updatedAt = new Date().toISOString();
  const status = statusForDocument(booking.status, document);
  const patch: Record<string, unknown> = { status, updatedAt };
  const next: LogisticsBooking = { ...booking, status, updatedAt };
  if (document === 'courier_slip') {
    patch.courierSlipGenerated = true;
    next.courierSlipGenerated = true;
  } else {
    patch.shippingLabelGenerated = true;
    patch.labelGenerated = true;
    next.shippingLabelGenerated = true;
    next.labelGenerated = true;
  }
  await updateDoc(doc(db, COLLECTION, booking.id), patch);
  return next;
}

export async function updateLogisticsBookingStatus(
  booking: LogisticsBooking,
  status: LogisticsBookingStatus,
  user: User,
): Promise<LogisticsBooking> {
  if (!isInternalOpsUser(user)) {
    throw new Error('You do not have permission to update shipment status.');
  }
  const updatedAt = new Date().toISOString();
  await updateDoc(doc(db, COLLECTION, booking.id), { status, updatedAt });
  return { ...booking, status, updatedAt };
}

export async function cancelLogisticsBooking(
  booking: LogisticsBooking,
  user: User,
): Promise<LogisticsBooking> {
  if (!isInternalOpsUser(user)) {
    throw new Error('You do not have permission to cancel shipments.');
  }
  if (booking.status === 'delivered') {
    throw new Error('Delivered shipments cannot be cancelled.');
  }
  return updateLogisticsBookingStatus(booking, 'cancelled', user);
}

export async function deleteLogisticsBookingPermanently(
  bookingId: string,
  user: User,
): Promise<void> {
  if (normalizeRole(user.role) !== 'super_admin') {
    throw new Error('Only super admin can permanently delete shipments.');
  }
  await deleteDoc(doc(db, COLLECTION, bookingId));
}

export function canEditLogisticsBooking(booking: LogisticsBooking, user: User): boolean {
  if (!isInternalOpsUser(user)) return false;
  return isEditableStatus(booking.status);
}

export function canCreateLogisticsBooking(user: User): boolean {
  return isInternalOpsUser(user);
}

export function canDeleteLogisticsBooking(user: User): boolean {
  return normalizeRole(user.role) === 'super_admin';
}
