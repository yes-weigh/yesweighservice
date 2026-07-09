import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../../firebase';
import { compressImageForUpload } from '../compressImage';
import { isCatalogSparePartProduct } from '../catalog';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type { CatalogInventorySite } from '../../types/catalog-site-inventory';
import type {
  CatalogNcDoc,
  CatalogNcEvent,
  CatalogNcLine,
  CatalogNcLocation,
  CatalogNcLocationKey,
  CatalogNcPhoto,
  NcReasonCode,
  NcResolveOutcome,
} from '../../types/catalog-nc';
import {
  formatNcLocationLabel,
  MAX_NC_PHOTOS_PER_LINE,
  ncLocationKey,
  ncReasonLabel,
} from '../../types/catalog-nc';
import {
  BIN_NUMBERS,
  ROW_NUMBERS,
  VALID_RACK_LETTERS,
} from '../../types/yes-store';
import { isValidZoneId, normalizeZoneId } from '../../types/warehouse-locations';

const COLLECTION = 'catalogProductNc';
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_EVENTS = 200;
const functions = getFunctions(app, 'asia-south1');

const now = () => new Date().toISOString();

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ncDocRef(catalogProductId: string) {
  return doc(db, COLLECTION, catalogProductId);
}

function extFromFile(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read image file.'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not read image file.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function callableError(err: unknown, fallback: string): Error {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const fbErr = err as { code?: string; message: string };
    if (fbErr.code?.startsWith('functions/') && fbErr.message) {
      return new Error(fbErr.message);
    }
  }
  return new Error(fallback);
}

export function resolveNcSiteForProduct(
  product: Pick<CatalogProduct, 'categoryId' | 'categoryName'>,
  categories: CatalogCategory[] = [],
): CatalogInventorySite {
  return isCatalogSparePartProduct(product, categories) ? 'head_office' : 'cochin';
}

function emptyNcDoc(
  catalogProductId: string,
  site: CatalogInventorySite,
): CatalogNcDoc {
  return {
    id: catalogProductId,
    catalogProductId,
    site,
    openNcQty: 0,
    locations: [],
    events: [],
    updatedAt: now(),
    updatedByUid: null,
    updatedByName: null,
  };
}

function mapPhoto(raw: unknown): CatalogNcPhoto | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  const url = String(row.url ?? '').trim();
  const storagePath = String(row.storagePath ?? '').trim();
  if (!id || !storagePath) return null;
  return {
    id,
    url,
    storagePath,
    fileName: String(row.fileName ?? ''),
    uploadedAt: String(row.uploadedAt ?? ''),
  };
}

function mapLine(raw: unknown): CatalogNcLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  const qty = Number(row.qty ?? 0);
  if (!id || !Number.isFinite(qty) || qty <= 0) return null;
  const photos = Array.isArray(row.photos)
    ? row.photos.map(mapPhoto).filter((p): p is CatalogNcPhoto => p !== null)
    : [];
  return {
    id,
    qty: Math.floor(qty),
    reasonCode: (String(row.reasonCode ?? 'other') as NcReasonCode),
    reasonText: (row.reasonText as string | null) ?? null,
    photos,
    status: (String(row.status ?? 'open') as CatalogNcLine['status']),
    createdAt: String(row.createdAt ?? ''),
    createdByUid: (row.createdByUid as string | null) ?? null,
    createdByName: (row.createdByName as string | null) ?? null,
    resolvedAt: (row.resolvedAt as string | null) ?? null,
    resolvedByUid: (row.resolvedByUid as string | null) ?? null,
    resolvedByName: (row.resolvedByName as string | null) ?? null,
    resolveNote: (row.resolveNote as string | null) ?? null,
  };
}

function mapLocation(raw: unknown): CatalogNcLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  const site = String(row.site ?? '') as CatalogInventorySite;
  if (!id || (site !== 'cochin' && site !== 'head_office')) return null;
  const lines = Array.isArray(row.lines)
    ? row.lines.map(mapLine).filter((l): l is CatalogNcLine => l !== null)
    : [];
  const openNcQty = lines
    .filter(line => line.status === 'open')
    .reduce((sum, line) => sum + line.qty, 0);
  return {
    id,
    site,
    zoneId: (row.zoneId as string | null) ?? null,
    zoneRowNumber: row.zoneRowNumber != null ? Number(row.zoneRowNumber) : null,
    rackId: (row.rackId as string | null) ?? null,
    rowNumber: row.rowNumber != null ? Number(row.rowNumber) : null,
    binNumber: row.binNumber != null ? Number(row.binNumber) : null,
    openNcQty,
    lines,
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

function mapEvent(raw: unknown): CatalogNcEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    type: row.type as CatalogNcEvent['type'],
    at: String(row.at ?? ''),
    byUid: (row.byUid as string | null) ?? null,
    byName: (row.byName as string | null) ?? null,
    locationId: (row.locationId as string | null) ?? null,
    lineId: (row.lineId as string | null) ?? null,
    summary: String(row.summary ?? ''),
    qty: row.qty != null ? Number(row.qty) : null,
    outcome: (row.outcome as NcResolveOutcome | null) ?? null,
  };
}

function mapNcDoc(data: Record<string, unknown>, fallbackId: string): CatalogNcDoc {
  const locations = Array.isArray(data.locations)
    ? data.locations.map(mapLocation).filter((l): l is CatalogNcLocation => l !== null)
    : [];
  const openNcQty = locations.reduce((sum, loc) => sum + loc.openNcQty, 0);
  const events = Array.isArray(data.events)
    ? data.events.map(mapEvent).filter((e): e is CatalogNcEvent => e !== null)
    : [];
  return {
    id: String(data.id ?? fallbackId),
    catalogProductId: String(data.catalogProductId ?? fallbackId),
    site: (String(data.site ?? 'cochin') as CatalogInventorySite),
    openNcQty,
    locations,
    events,
    updatedAt: String(data.updatedAt ?? ''),
    updatedByUid: (data.updatedByUid as string | null) ?? null,
    updatedByName: (data.updatedByName as string | null) ?? null,
  };
}

function recompute(docData: CatalogNcDoc): CatalogNcDoc {
  const locations = docData.locations.map(loc => {
    const openNcQty = loc.lines
      .filter(line => line.status === 'open')
      .reduce((sum, line) => sum + line.qty, 0);
    return { ...loc, openNcQty };
  });
  return {
    ...docData,
    locations,
    openNcQty: locations.reduce((sum, loc) => sum + loc.openNcQty, 0),
  };
}

function pushEvent(docData: CatalogNcDoc, event: Omit<CatalogNcEvent, 'id'>): CatalogNcDoc {
  const next: CatalogNcEvent = { ...event, id: newId('evt') };
  return {
    ...docData,
    events: [next, ...docData.events].slice(0, MAX_EVENTS),
  };
}

function validateLocationKey(location: CatalogNcLocationKey, site: CatalogInventorySite): void {
  if (location.site !== site) {
    throw new Error('NC location site does not match this product.');
  }
  if (site === 'cochin') {
    const zoneId = normalizeZoneId(location.zoneId ?? '');
    if (!isValidZoneId(zoneId)) throw new Error('Choose a valid warehouse zone.');
    const row = Number(location.zoneRowNumber);
    if (!Number.isInteger(row) || row < 1) throw new Error('Choose a valid warehouse row.');
    return;
  }
  const rackId = String(location.rackId ?? '').trim().toLowerCase();
  if (!VALID_RACK_LETTERS.includes(rackId)) throw new Error('Choose a valid store-room rack.');
  const row = Number(location.rowNumber);
  const bin = Number(location.binNumber);
  if (!ROW_NUMBERS.includes(row as typeof ROW_NUMBERS[number])) {
    throw new Error('Choose a valid store-room row.');
  }
  if (!BIN_NUMBERS.includes(bin as typeof BIN_NUMBERS[number])) {
    throw new Error('Choose a valid store-room bin.');
  }
}

export async function getCatalogProductNc(
  catalogProductId: string,
): Promise<CatalogNcDoc | null> {
  const snap = await getDoc(ncDocRef(catalogProductId));
  if (!snap.exists()) return null;
  return mapNcDoc(snap.data() as Record<string, unknown>, catalogProductId);
}

export async function listCatalogProductNcSummaries(): Promise<Map<string, number>> {
  const snap = await getDocs(collection(db, COLLECTION));
  const map = new Map<string, number>();
  for (const row of snap.docs) {
    const data = row.data() as Record<string, unknown>;
    const qty = Number(data.openNcQty ?? 0);
    if (qty > 0) map.set(row.id, qty);
  }
  return map;
}

async function saveNcDoc(docData: CatalogNcDoc): Promise<CatalogNcDoc> {
  const computed = recompute(docData);
  await setDoc(ncDocRef(computed.catalogProductId), computed, { merge: false });
  return computed;
}

export async function ensureCatalogProductNc(input: {
  catalogProductId: string;
  site: CatalogInventorySite;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogNcDoc> {
  const existing = await getCatalogProductNc(input.catalogProductId);
  if (existing) return existing;
  const created = emptyNcDoc(input.catalogProductId, input.site);
  created.updatedByUid = input.actorUid;
  created.updatedByName = input.actorName?.trim() || null;
  return saveNcDoc(created);
}

export async function uploadCatalogNcPhoto(
  catalogProductId: string,
  file: File,
): Promise<CatalogNcPhoto> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Image must be under 12 MB.');
  const compressed = await compressImageForUpload(file, { maxBytes: 900_000 });
  const photoId = newId('photo');
  const fileName = `${photoId}.${extFromFile(compressed)}`;
  try {
    const fn = httpsCallable<
      {
        catalogProductId: string;
        photoId: string;
        fileName: string;
        contentType: string;
        fileBase64: string;
      },
      CatalogNcPhoto
    >(functions, 'uploadCatalogNcPhotoFn', { timeout: 120_000 });
    const result = await fn({
      catalogProductId,
      photoId,
      fileName,
      contentType: compressed.type || 'image/jpeg',
      fileBase64: await fileToBase64(compressed),
    });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not upload NC photo.');
  }
}

export async function deleteCatalogNcPhoto(photo: CatalogNcPhoto): Promise<void> {
  if (!photo.storagePath) return;
  try {
    const fn = httpsCallable<{ storagePath: string }, { deleted: boolean }>(
      functions,
      'deleteCatalogNcPhotoFn',
      { timeout: 60_000 },
    );
    await fn({ storagePath: photo.storagePath });
  } catch {
    // ignore missing / permission races
  }
}

export async function addCatalogNcLine(input: {
  catalogProductId: string;
  site: CatalogInventorySite;
  location: CatalogNcLocationKey;
  qty: number;
  reasonCode: NcReasonCode;
  reasonText?: string | null;
  photos?: CatalogNcPhoto[];
  actorUid: string;
  actorName?: string | null;
  /** Audited qty at the selected existing location — required. */
  auditedQtyAtLocation: number;
  zohoStock?: number | null;
}): Promise<{ doc: CatalogNcDoc; warnings: string[] }> {
  validateLocationKey(input.location, input.site);
  const qty = Math.floor(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1) throw new Error('NC quantity must be at least 1.');
  if (input.reasonCode === 'other' && !input.reasonText?.trim()) {
    throw new Error('Add a short note for Other.');
  }
  const audited = Math.floor(Number(input.auditedQtyAtLocation));
  if (!Number.isFinite(audited) || audited < 0) {
    throw new Error('Select an existing audited location for this item.');
  }
  const photos = (input.photos ?? []).slice(0, MAX_NC_PHOTOS_PER_LINE);
  if (photos.length > MAX_NC_PHOTOS_PER_LINE) {
    throw new Error(`Maximum ${MAX_NC_PHOTOS_PER_LINE} photos per NC line.`);
  }

  let docData = await ensureCatalogProductNc({
    catalogProductId: input.catalogProductId,
    site: input.site,
    actorUid: input.actorUid,
    actorName: input.actorName,
  });
  if (docData.site !== input.site) {
    throw new Error('This product already has NC records on a different site.');
  }

  const key = ncLocationKey({ ...input.location, site: input.site });
  let location = docData.locations.find(loc => ncLocationKey(loc) === key) ?? null;
  const stamp = now();
  const actorName = input.actorName?.trim() || null;
  const warnings: string[] = [];

  if (!location) {
    location = {
      id: newId('loc'),
      site: input.site,
      zoneId: input.site === 'cochin' ? normalizeZoneId(input.location.zoneId ?? '') : null,
      zoneRowNumber: input.site === 'cochin' ? Number(input.location.zoneRowNumber) : null,
      rackId: input.site === 'head_office' ? String(input.location.rackId).trim().toLowerCase() : null,
      rowNumber: input.site === 'head_office' ? Number(input.location.rowNumber) : null,
      binNumber: input.site === 'head_office' ? Number(input.location.binNumber) : null,
      openNcQty: 0,
      lines: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    docData = {
      ...docData,
      locations: [...docData.locations, location],
    };
    docData = pushEvent(docData, {
      type: 'location_added',
      at: stamp,
      byUid: input.actorUid,
      byName: actorName,
      locationId: location.id,
      lineId: null,
      summary: `Added NC location ${formatNcLocationLabel(location)}`,
    });
  }

  const nextOpenAtLocation = location.openNcQty + qty;
  if (nextOpenAtLocation > audited) {
    throw new Error(
      `NC at this location cannot exceed audited qty (${audited}).`,
    );
  }

  const line: CatalogNcLine = {
    id: newId('line'),
    qty,
    reasonCode: input.reasonCode,
    reasonText: input.reasonText?.trim() || null,
    photos,
    status: 'open',
    createdAt: stamp,
    createdByUid: input.actorUid,
    createdByName: actorName,
    resolvedAt: null,
    resolvedByUid: null,
    resolvedByName: null,
    resolveNote: null,
  };

  docData = {
    ...docData,
    locations: docData.locations.map(loc => (
      loc.id === location!.id
        ? { ...loc, lines: [...loc.lines, line], updatedAt: stamp }
        : loc
    )),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: actorName,
  };

  docData = pushEvent(docData, {
    type: 'line_added',
    at: stamp,
    byUid: input.actorUid,
    byName: actorName,
    locationId: location.id,
    lineId: line.id,
    summary: `Added ${qty} NC — ${ncReasonLabel(line.reasonCode, line.reasonText)} at ${formatNcLocationLabel(location)}`,
    qty,
  });

  const saved = await saveNcDoc(docData);
  if (input.zohoStock != null && saved.openNcQty > input.zohoStock) {
    warnings.push(`Total NC (${saved.openNcQty}) is higher than Zoho stock (${input.zohoStock}).`);
  }
  return { doc: saved, warnings };
}

export async function resolveCatalogNcLine(input: {
  catalogProductId: string;
  locationId: string;
  lineId: string;
  resolveQty: number;
  outcome: NcResolveOutcome;
  note?: string | null;
  actorUid: string;
  actorName?: string | null;
}): Promise<CatalogNcDoc> {
  const existing = await getCatalogProductNc(input.catalogProductId);
  if (!existing) throw new Error('No NC records found for this product.');

  const location = existing.locations.find(loc => loc.id === input.locationId);
  if (!location) throw new Error('NC location not found.');
  const line = location.lines.find(row => row.id === input.lineId && row.status === 'open');
  if (!line) throw new Error('Open NC line not found.');

  const resolveQty = Math.floor(Number(input.resolveQty));
  if (!Number.isFinite(resolveQty) || resolveQty < 1) {
    throw new Error('Resolve quantity must be at least 1.');
  }
  if (resolveQty > line.qty) {
    throw new Error(`Cannot resolve more than the open qty (${line.qty}).`);
  }

  const stamp = now();
  const actorName = input.actorName?.trim() || null;
  const outcomeLabel = input.outcome;

  let nextLines: CatalogNcLine[];
  if (resolveQty === line.qty) {
    nextLines = location.lines.map(row => (
      row.id === line.id
        ? {
            ...row,
            status: input.outcome,
            resolvedAt: stamp,
            resolvedByUid: input.actorUid,
            resolvedByName: actorName,
            resolveNote: input.note?.trim() || null,
          }
        : row
    ));
  } else {
    const closed: CatalogNcLine = {
      ...line,
      id: newId('line'),
      qty: resolveQty,
      status: input.outcome,
      resolvedAt: stamp,
      resolvedByUid: input.actorUid,
      resolvedByName: actorName,
      resolveNote: input.note?.trim() || null,
    };
    const remaining: CatalogNcLine = {
      ...line,
      qty: line.qty - resolveQty,
    };
    nextLines = location.lines.flatMap(row => (
      row.id === line.id ? [remaining, closed] : [row]
    ));
  }

  let docData: CatalogNcDoc = {
    ...existing,
    locations: existing.locations.map(loc => (
      loc.id === location.id
        ? { ...loc, lines: nextLines, updatedAt: stamp }
        : loc
    )),
    updatedAt: stamp,
    updatedByUid: input.actorUid,
    updatedByName: actorName,
  };

  docData = pushEvent(docData, {
    type: resolveQty === line.qty ? 'line_resolved' : 'line_split_resolved',
    at: stamp,
    byUid: input.actorUid,
    byName: actorName,
    locationId: location.id,
    lineId: line.id,
    summary: `Resolved ${resolveQty} NC as ${outcomeLabel} at ${formatNcLocationLabel(location)}`,
    qty: resolveQty,
    outcome: input.outcome,
  });

  return saveNcDoc(docData);
}
