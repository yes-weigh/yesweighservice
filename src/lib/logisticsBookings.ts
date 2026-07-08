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
  statusForDocument,
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
    finalPackagePhoto: null,
    finalPackagePhotoStoragePath: typeof data.finalPackagePhotoStoragePath === 'string'
      ? data.finalPackagePhotoStoragePath
      : null,
    labelGenerated: Boolean(data.shippingLabelGenerated ?? data.labelGenerated),
    courierSlipGenerated: Boolean(data.courierSlipGenerated),
    shippingLabelGenerated: Boolean(data.shippingLabelGenerated ?? data.labelGenerated),
    packingSlipGenerated: Boolean(data.packingSlipGenerated),
    status,
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

async function uploadDraftBoxPhotos(bookingId: string, draft: LogisticsBookingDraft): Promise<{
  boxes: ShipmentBox[];
  finalPackagePhotoStoragePath: string | null;
}> {
  const isEnvelope = draft.shipmentMode === 'envelope';
  const boxes = await Promise.all(draft.boxes.map(async (box, boxIndex) => {
    const photos = await Promise.all(box.photos.map(async (photo, photoIndex) => {
      if (photo.storagePath) return { storagePath: photo.storagePath, url: photo.url ?? null };
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
      photos,
    } satisfies ShipmentBox;
  }));

  let finalPackagePhotoStoragePath: string | null = null;
  if (draft.finalPackagePhoto) {
    const file = await dataUrlToFile(draft.finalPackagePhoto, 'final-package.jpg');
    finalPackagePhotoStoragePath = await uploadLogisticsPhoto(bookingId, 'final-package', file);
  }

  return { boxes, finalPackagePhotoStoragePath };
}

export async function persistLogisticsBooking(
  input: PersistLogisticsBookingInput,
): Promise<LogisticsBooking> {
  const { draft, dealer, createdBy } = input;
  if (!draft.consignmentNo.trim()) throw new Error('Consignment number is required.');
  if (!draft.zohoCustomerId.trim()) throw new Error('Select a dealer.');
  if (!draft.boxes.length) throw new Error('Add at least one box.');
  if (draft.boxes.some(box => box.photos.length === 0)) {
    throw new Error('Each box needs at least the inside photo.');
  }
  if (!draft.finalPackagePhoto) throw new Error('Final package photo is required.');

  const settings = await loadLogisticsSettings();
  const shipFromAddress = settings.fromAddresses[draft.shipFromSite]?.trim() || '';
  const now = new Date().toISOString();
  const orderRef = draft.invoiceNumber
    || draft.supportRequestNumber
    || `ORD-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const bookingRef = doc(collection(db, COLLECTION));
  const { boxes, finalPackagePhotoStoragePath } = await uploadDraftBoxPhotos(bookingRef.id, draft);
  const actualWeightKg = boxes.reduce((total, box) => total + box.weightKg, 0);
  const volumetricWeightKg = boxes.reduce((total, box) => total + box.volumetricWeightKg, 0);

  const payload = {
    orderRef,
    source: draft.source,
    invoiceId: draft.invoiceId,
    invoiceNumber: draft.invoiceNumber,
    supportRequestId: draft.supportRequestId,
    supportRequestNumber: draft.supportRequestNumber,
    partnerId: draft.partnerId,
    consignmentNo: draft.consignmentNo.trim(),
    trackingNo: draft.consignmentNo.trim(),
    branch: draft.branch.trim(),
    serviceType: draft.serviceType.trim(),
    bookingDate: draft.bookingDate,
    zohoCustomerId: draft.zohoCustomerId,
    dealerId: draft.dealerId,
    dealerSnapshot: dealer,
    deliveryAddressKind: draft.deliveryAddressKind,
    deliveryAddress: resolveDeliveryAddress(dealer, draft.deliveryAddressKind),
    shipFromSite: draft.shipFromSite,
    shipFromAddress,
    shipmentMode: draft.shipmentMode,
    numberOfBoxes: boxes.length,
    actualWeightKg,
    volumetricWeightKg,
    boxes: boxes.map(box => ({
      id: box.id,
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
      weightKg: box.weightKg,
      volumetricWeightKg: box.volumetricWeightKg,
      photos: box.photos.map(photo => ({ storagePath: photo.storagePath })),
    })),
    finalPackagePhotoStoragePath,
    labelGenerated: false,
    courierSlipGenerated: false,
    shippingLabelGenerated: false,
    packingSlipGenerated: false,
    status: 'booked' as LogisticsBookingStatus,
    createdAt: now,
    updatedAt: now,
    createdByUid: createdBy.uid,
    createdByName: createdBy.displayName,
  };

  await setDoc(bookingRef, payload);

  const booking = mapLogisticsBookingDoc(bookingRef.id, payload);
  return hydrateBookingPhotos(booking);
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
