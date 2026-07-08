import {
  collection,
  deleteDoc,
  deleteField,
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
  CatalogLinkMode,
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

export async function listRacks(): Promise<YesStoreRackDoc[]> {
  const snap = await getDocs(collection(db, 'yesStoreRacks'));
  return snap.docs
    .map(d => d.data() as YesStoreRackDoc)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function listRowsByRack(rackId: string): Promise<YesStoreRowDoc[]> {
  const snap = await getDocs(
    query(collection(db, 'yesStoreRows'), where('rackId', '==', rackId.toLowerCase())),
  );
  return snap.docs
    .map(d => d.data() as YesStoreRowDoc)
    .sort((a, b) => a.number - b.number);
}

export async function listBinsByRow(
  rackId: string,
  rowNumber: RowNumber,
): Promise<YesStoreBinDoc[]> {
  const rowId = rowDocId(rackId, rowNumber);
  const snap = await getDocs(
    query(collection(db, 'yesStoreBins'), where('rowId', '==', rowId)),
  );
  return snap.docs
    .map(d => d.data() as YesStoreBinDoc)
    .sort((a, b) => a.number - b.number);
}

export async function countItemsInBin(
  rackId: string,
  rowNumber: RowNumber,
  binNumber: BinNumber,
): Promise<number> {
  const items = await listItemsInBin(rackId, rowNumber, binNumber);
  return items.length;
}

export async function deleteRackIfEmpty(rackId: string): Promise<void> {
  const rows = await listRowsByRack(rackId);
  if (rows.length) throw new Error('Remove all rows before deleting this rack.');
  await deleteDoc(rackRef(rackId));
}

export async function deleteRowIfEmpty(rackId: string, rowNumber: RowNumber): Promise<void> {
  const bins = await listBinsByRow(rackId, rowNumber);
  if (bins.length) throw new Error('Remove all bins before deleting this row.');
  await deleteDoc(rowRef(rackId, rowNumber));
}

export async function deleteBinIfEmpty(
  rackId: string,
  rowNumber: RowNumber,
  binNumber: BinNumber,
): Promise<void> {
  const count = await countItemsInBin(rackId, rowNumber, binNumber);
  if (count > 0) throw new Error('This bin has audited items. Clear or move them first.');
  await deleteDoc(binRef(rackId, rowNumber, binNumber));
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

function buildCountStamp(counter?: { uid: string; displayName?: string | null }) {
  if (!counter?.uid) return {};
  return {
    countedAt: now(),
    countedByUid: counter.uid,
    countedByName: counter.displayName?.trim() || null,
  };
}

export async function createItem(input: {
  rackId: string;
  rowNumber: RowNumber;
  binNumber: BinNumber;
  quantity: number;
  photos: YesStorePhoto[];
  countedBy?: { uid: string; displayName?: string | null };
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
    ...buildCountStamp(input.countedBy),
  };
  await setDoc(itemRef(itemId), docData);
  return docData;
}

export async function updateItem(
  itemId: string,
  patch: Partial<Pick<YesStoreItemDoc, 'quantity' | 'photos'>>,
  countedBy?: { uid: string; displayName?: string | null },
): Promise<void> {
  if (patch.photos != null) {
    if (!patch.photos.length) throw new Error('Add at least one photo.');
    if (patch.photos.length > MAX_ITEM_PHOTOS) {
      throw new Error(`Maximum ${MAX_ITEM_PHOTOS} photos per item.`);
    }
  }
  const payload: Record<string, unknown> = { updatedAt: now(), ...buildCountStamp(countedBy) };
  if (patch.quantity != null) {
    payload.quantity = Math.max(1, Math.floor(patch.quantity));
  }
  if (patch.photos != null) {
    payload.photos = patch.photos.slice(0, MAX_ITEM_PHOTOS);
  }
  await updateDoc(itemRef(itemId), payload);
}

export async function updateItemDetails(
  itemId: string,
  input: {
    rackId: string;
    rowNumber: RowNumber;
    binNumber: BinNumber;
    quantity: number;
    photos: YesStorePhoto[];
  },
  countedBy?: { uid: string; displayName?: string | null },
): Promise<YesStoreItemDoc> {
  const rackId = input.rackId.toLowerCase();
  if (!isValidRackId(rackId)) throw new Error('Select a valid rack.');
  if (!isValidRowNumber(input.rowNumber)) throw new Error('Select a valid row.');
  if (!isValidBinNumber(input.binNumber)) throw new Error('Select a valid bin.');
  if (!input.photos.length) throw new Error('Add at least one photo.');
  if (input.photos.length > MAX_ITEM_PHOTOS) {
    throw new Error(`Maximum ${MAX_ITEM_PHOTOS} photos per item.`);
  }
  const quantity = Math.max(1, Math.floor(input.quantity));
  await ensureBin(rackId, input.rowNumber, input.binNumber);
  await updateDoc(itemRef(itemId), {
    rackId,
    rowId: rowDocId(rackId, input.rowNumber),
    rowNumber: input.rowNumber,
    binId: binDocId(rackId, input.rowNumber, input.binNumber),
    binNumber: input.binNumber,
    quantity,
    photos: input.photos.slice(0, MAX_ITEM_PHOTOS),
    updatedAt: now(),
    ...buildCountStamp(countedBy),
  });
  const updated = await getItem(itemId);
  if (!updated) throw new Error('Item not found after saving.');
  return updated;
}

export async function updateInventoryAuditCount(
  itemId: string,
  quantity: number,
  _auditor: { uid: string; displayName?: string | null },
): Promise<YesStoreItemDoc> {
  const normalizedQty = Math.max(1, Math.floor(quantity));
  await updateDoc(itemRef(itemId), {
    quantity: normalizedQty,
    updatedAt: now(),
  });
  const updated = await getItem(itemId);
  if (!updated) throw new Error('Audit item not found after update.');
  return updated;
}

export async function linkYesStoreItemToCatalog(
  itemId: string,
  product: { id: string; name: string; sku: string | null },
  linkedByUid: string,
  options?: {
    mode?: CatalogLinkMode;
    partLabel?: string | null;
    unitsPerProduct?: number;
    linkedByName?: string | null;
  },
): Promise<void> {
  const mode = options?.mode === 'part' ? 'part' : 'unit';
  const unitsPerProduct = Math.max(1, Math.floor(options?.unitsPerProduct ?? 1));
  const partLabel = options?.partLabel?.trim() || null;
  const linkedByName = options?.linkedByName?.trim() || null;
  const linkedAt = now();

  await updateDoc(itemRef(itemId), {
    catalogProductId: product.id,
    catalogProductName: product.name.trim(),
    catalogProductSku: product.sku?.trim() || null,
    catalogLinkMode: mode,
    partLabel: mode === 'part' ? partLabel : null,
    unitsPerProduct: mode === 'part' ? unitsPerProduct : 1,
    linkedAt,
    linkedByUid,
    linkedByName,
    updatedAt: now(),
  });
}

export async function batchLinkYesStoreItemsToCatalog(
  itemIds: string[],
  product: { id: string; name: string; sku: string | null },
  linkedByUid: string,
  options?: {
    linkedByName?: string | null;
    mode?: CatalogLinkMode;
  },
): Promise<void> {
  const uniqueIds = [...new Set(itemIds.map(id => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return;

  await Promise.all(
    uniqueIds.map(itemId =>
      linkYesStoreItemToCatalog(itemId, product, linkedByUid, {
        mode: options?.mode ?? 'unit',
        linkedByName: options?.linkedByName,
      }),
    ),
  );
}

export async function unlinkYesStoreItemFromCatalog(itemId: string): Promise<void> {
  await updateDoc(itemRef(itemId), {
    catalogProductId: deleteField(),
    catalogProductName: deleteField(),
    catalogProductSku: deleteField(),
    catalogLinkMode: deleteField(),
    partLabel: deleteField(),
    unitsPerProduct: deleteField(),
    linkedAt: deleteField(),
    linkedByUid: deleteField(),
    linkedByName: deleteField(),
    updatedAt: now(),
  });
}

export async function batchUnlinkYesStoreItemsFromCatalog(itemIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(itemIds.map(id => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return;
  await Promise.all(uniqueIds.map(id => unlinkYesStoreItemFromCatalog(id)));
}

export async function fetchDisplayNamesForUids(uids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uids.map(uid => uid.trim()).filter(Boolean))];
  const names = new Map<string, string>();
  await Promise.all(
    unique.map(async uid => {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) return;
      const displayName = String(snap.data().displayName ?? '').trim();
      if (displayName) names.set(uid, displayName);
    }),
  );
  return names;
}

export async function listItemsByCatalogProduct(catalogProductId: string): Promise<YesStoreItemDoc[]> {
  const snap = await getDocs(
    query(
      collection(db, 'yesStoreItems'),
      where('catalogProductId', '==', catalogProductId),
      orderBy('updatedAt', 'desc'),
      limit(200),
    ),
  );
  return snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as YesStoreItemDoc));
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
