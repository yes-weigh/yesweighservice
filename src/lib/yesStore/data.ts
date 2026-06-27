import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  BinNumber,
  RowNumber,
  YesStoreBinDoc,
  YesStoreItemDoc,
  YesStorePhoto,
  YesStoreRackDoc,
  YesStoreRowDoc,
} from '../../types/yes-store';
import {
  binDocId,
  isValidBinNumber,
  isValidRackId,
  isValidRowNumber,
  MAX_ITEM_PHOTOS,
  rowDocId,
} from '../../types/yes-store';

const now = () => new Date().toISOString();

function emptyPhotos(): YesStorePhoto[] {
  return [];
}

function rackRef(rackId: string) {
  return doc(db, 'yesStoreRacks', rackId);
}

function rowRef(rackId: string, rowNumber: RowNumber) {
  return doc(db, 'yesStoreRows', rowDocId(rackId, rowNumber));
}

function binRef(rackId: string, rowNumber: RowNumber, binNumber: BinNumber) {
  return doc(db, 'yesStoreBins', binDocId(rackId, rowNumber, binNumber));
}

function itemRef(itemId: string) {
  return doc(db, 'yesStoreItems', itemId);
}

export async function getRack(rackId: string): Promise<YesStoreRackDoc | null> {
  const snap = await getDoc(rackRef(rackId));
  if (!snap.exists()) return null;
  return snap.data() as YesStoreRackDoc;
}

export async function ensureRack(rackId: string): Promise<YesStoreRackDoc> {
  const existing = await getRack(rackId);
  if (existing) return existing;
  const createdAt = now();
  const docData: YesStoreRackDoc = {
    id: rackId,
    photos: emptyPhotos(),
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(rackRef(rackId), docData);
  return docData;
}

export async function getRow(
  rackId: string,
  rowNumber: RowNumber,
): Promise<YesStoreRowDoc | null> {
  const snap = await getDoc(rowRef(rackId, rowNumber));
  if (!snap.exists()) return null;
  return snap.data() as YesStoreRowDoc;
}

export async function ensureRow(
  rackId: string,
  rowNumber: RowNumber,
): Promise<YesStoreRowDoc> {
  const existing = await getRow(rackId, rowNumber);
  if (existing) return existing;
  const createdAt = now();
  const docData: YesStoreRowDoc = {
    id: rowDocId(rackId, rowNumber),
    rackId,
    number: rowNumber,
    photos: emptyPhotos(),
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(rowRef(rackId, rowNumber), docData);
  return docData;
}

export async function getBin(
  rackId: string,
  rowNumber: RowNumber,
  binNumber: BinNumber,
): Promise<YesStoreBinDoc | null> {
  const snap = await getDoc(binRef(rackId, rowNumber, binNumber));
  if (!snap.exists()) return null;
  return snap.data() as YesStoreBinDoc;
}

export async function ensureBin(
  rackId: string,
  rowNumber: RowNumber,
  binNumber: BinNumber,
): Promise<YesStoreBinDoc> {
  const existing = await getBin(rackId, rowNumber, binNumber);
  if (existing) return existing;
  const createdAt = now();
  const docData: YesStoreBinDoc = {
    id: binDocId(rackId, rowNumber, binNumber),
    rackId,
    rowId: rowDocId(rackId, rowNumber),
    rowNumber,
    number: binNumber,
    photos: emptyPhotos(),
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(binRef(rackId, rowNumber, binNumber), docData);
  return docData;
}

export async function listItemsInBin(
  rackId: string,
  rowNumber: RowNumber,
  binNumber: BinNumber,
): Promise<YesStoreItemDoc[]> {
  const binId = binDocId(rackId, rowNumber, binNumber);
  const snap = await getDocs(
    query(collection(db, 'yesStoreItems'), where('binId', '==', binId)),
  );
  return snap.docs
    .map(d => d.data() as YesStoreItemDoc)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listAllItems(max = 200): Promise<YesStoreItemDoc[]> {
  const snap = await getDocs(
    query(
      collection(db, 'yesStoreItems'),
      orderBy('updatedAt', 'desc'),
      limit(max),
    ),
  );
  return snap.docs.map(d => d.data() as YesStoreItemDoc);
}

/** @deprecated use listAllItems */
export async function listRecentItems(max = 24): Promise<YesStoreItemDoc[]> {
  return listAllItems(max);
}

export async function getItem(itemId: string): Promise<YesStoreItemDoc | null> {
  const snap = await getDoc(itemRef(itemId));
  if (!snap.exists()) return null;
  return snap.data() as YesStoreItemDoc;
}

export async function createItem(input: {
  rackId: string;
  rowNumber: RowNumber;
  binNumber: BinNumber;
  quantity: number;
  photos: YesStorePhoto[];
}): Promise<YesStoreItemDoc> {
  if (!input.photos.length) throw new Error('Add at least one photo.');
  if (input.photos.length > MAX_ITEM_PHOTOS) {
    throw new Error(`Maximum ${MAX_ITEM_PHOTOS} photos per item.`);
  }
  const quantity = Math.max(1, Math.floor(input.quantity));
  await ensureBin(input.rackId, input.rowNumber, input.binNumber);
  const itemId = doc(collection(db, 'yesStoreItems')).id;
  const createdAt = now();
  const docData: YesStoreItemDoc = {
    id: itemId,
    quantity,
    rackId: input.rackId,
    rowId: rowDocId(input.rackId, input.rowNumber),
    rowNumber: input.rowNumber,
    binId: binDocId(input.rackId, input.rowNumber, input.binNumber),
    binNumber: input.binNumber,
    photos: input.photos.slice(0, MAX_ITEM_PHOTOS),
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(itemRef(itemId), docData);
  return docData;
}

export async function updateItem(
  itemId: string,
  patch: Partial<Pick<YesStoreItemDoc, 'quantity' | 'photos'>>,
): Promise<void> {
  if (patch.photos != null) {
    if (!patch.photos.length) throw new Error('Add at least one photo.');
    if (patch.photos.length > MAX_ITEM_PHOTOS) {
      throw new Error(`Maximum ${MAX_ITEM_PHOTOS} photos per item.`);
    }
  }
  const payload: Record<string, unknown> = { updatedAt: now() };
  if (patch.quantity != null) {
    payload.quantity = Math.max(1, Math.floor(patch.quantity));
  }
  if (patch.photos != null) {
    payload.photos = patch.photos.slice(0, MAX_ITEM_PHOTOS);
  }
  await updateDoc(itemRef(itemId), payload);
}

export async function linkYesStoreItemToCatalog(
  itemId: string,
  product: { id: string; name: string; sku: string | null },
  linkedByUid: string,
): Promise<void> {
  await updateDoc(itemRef(itemId), {
    catalogProductId: product.id,
    catalogProductName: product.name.trim(),
    catalogProductSku: product.sku?.trim() || null,
    linkedAt: now(),
    linkedByUid,
    updatedAt: now(),
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  await deleteDoc(itemRef(itemId));
}

type PhotoLevel = 'rack' | 'row' | 'bin' | 'item';

async function photoParentRef(
  level: PhotoLevel,
  ids: {
    rackId: string;
    rowNumber?: RowNumber;
    binNumber?: BinNumber;
    itemId?: string;
  },
) {
  if (level === 'rack') return rackRef(ids.rackId);
  if (level === 'row' && ids.rowNumber != null) return rowRef(ids.rackId, ids.rowNumber);
  if (level === 'bin' && ids.rowNumber != null && ids.binNumber != null) {
    return binRef(ids.rackId, ids.rowNumber, ids.binNumber);
  }
  if (level === 'item' && ids.itemId) return itemRef(ids.itemId);
  throw new Error('Invalid photo target.');
}

export async function appendPhoto(
  level: PhotoLevel,
  ids: {
    rackId: string;
    rowNumber?: RowNumber;
    binNumber?: BinNumber;
    itemId?: string;
  },
  photo: YesStorePhoto,
): Promise<void> {
  if (level === 'rack') await ensureRack(ids.rackId);
  if (level === 'row' && ids.rowNumber != null) await ensureRow(ids.rackId, ids.rowNumber);
  if (level === 'bin' && ids.rowNumber != null && ids.binNumber != null) {
    await ensureBin(ids.rackId, ids.rowNumber, ids.binNumber);
  }

  const ref = await photoParentRef(level, ids);
  const snap = await getDoc(ref);
  const data = snap.data() as { photos?: YesStorePhoto[] } | undefined;
  const photos = [...(data?.photos ?? []), photo];
  await updateDoc(ref, { photos, updatedAt: now() });
}

export async function removePhoto(
  level: PhotoLevel,
  ids: {
    rackId: string;
    rowNumber?: RowNumber;
    binNumber?: BinNumber;
    itemId?: string;
  },
  photoId: string,
): Promise<YesStorePhoto | null> {
  const ref = await photoParentRef(level, ids);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as { photos?: YesStorePhoto[] };
  const removed = (data.photos ?? []).find(p => p.id === photoId) ?? null;
  const photos = (data.photos ?? []).filter(p => p.id !== photoId);
  await updateDoc(ref, { photos, updatedAt: now() });
  return removed;
}

export function parseRouteLocation(
  rackId: string,
  rowParam?: string,
  binParam?: string,
): { rackId: string; rowNumber?: RowNumber; binNumber?: BinNumber } | null {
  const normalizedRack = rackId.toLowerCase();
  if (!isValidRackId(normalizedRack)) return null;
  if (!rowParam) return { rackId: normalizedRack };
  const rowNumber = Number(rowParam);
  if (!isValidRowNumber(rowNumber)) return null;
  if (!binParam) return { rackId: normalizedRack, rowNumber };
  const binNumber = Number(binParam);
  if (!isValidBinNumber(binNumber)) return null;
  return { rackId: normalizedRack, rowNumber, binNumber };
}
