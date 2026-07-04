import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { WarehouseZoneDoc, WarehouseZoneRowDoc } from '../../types/warehouse-locations';
import {
  isValidZoneId,
  normalizeZoneId,
  warehouseZoneRowDocId,
} from '../../types/warehouse-locations';

const now = () => new Date().toISOString();

function zoneRef(zoneId: string) {
  return doc(db, 'warehouseZones', normalizeZoneId(zoneId));
}

function zoneRowRef(zoneId: string, rowNumber: number) {
  return doc(db, 'warehouseZoneRows', warehouseZoneRowDocId(zoneId, rowNumber));
}

export async function listWarehouseZones(): Promise<WarehouseZoneDoc[]> {
  const snap = await getDocs(collection(db, 'warehouseZones'));
  return snap.docs
    .map(d => d.data() as WarehouseZoneDoc)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getWarehouseZone(zoneId: string): Promise<WarehouseZoneDoc | null> {
  const snap = await getDoc(zoneRef(zoneId));
  if (!snap.exists()) return null;
  return snap.data() as WarehouseZoneDoc;
}

export async function createWarehouseZone(
  zoneId: string,
  label?: string | null,
): Promise<WarehouseZoneDoc> {
  const id = normalizeZoneId(zoneId);
  if (!isValidZoneId(id)) {
    throw new Error('Zone must be a single letter A–Z.');
  }
  const existing = await getWarehouseZone(id);
  if (existing) throw new Error(`Zone ${id.toUpperCase()} already exists.`);

  const createdAt = now();
  const docData: WarehouseZoneDoc = {
    id,
    label: label?.trim() || null,
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(zoneRef(id), docData);
  return docData;
}

export async function updateWarehouseZoneLabel(
  zoneId: string,
  label: string | null,
): Promise<void> {
  const id = normalizeZoneId(zoneId);
  const existing = await getWarehouseZone(id);
  if (!existing) throw new Error('Zone not found.');
  await setDoc(zoneRef(id), {
    label: label?.trim() || null,
    updatedAt: now(),
  }, { merge: true });
}

export async function deleteWarehouseZone(zoneId: string): Promise<void> {
  const id = normalizeZoneId(zoneId);
  const rows = await listWarehouseZoneRows(id);
  if (rows.length) {
    throw new Error('Remove all rows in this zone before deleting it.');
  }
  await deleteDoc(zoneRef(id));
}

export async function listWarehouseZoneRows(zoneId: string): Promise<WarehouseZoneRowDoc[]> {
  const id = normalizeZoneId(zoneId);
  const snap = await getDocs(
    query(collection(db, 'warehouseZoneRows'), where('zoneId', '==', id)),
  );
  return snap.docs
    .map(d => d.data() as WarehouseZoneRowDoc)
    .sort((a, b) => a.number - b.number);
}

export async function createWarehouseZoneRow(
  zoneId: string,
  rowNumber: number,
  label?: string | null,
): Promise<WarehouseZoneRowDoc> {
  const id = normalizeZoneId(zoneId);
  if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 99) {
    throw new Error('Row number must be between 1 and 99.');
  }
  const zone = await getWarehouseZone(id);
  if (!zone) throw new Error('Zone not found. Add the zone first.');

  const existing = await getDoc(zoneRowRef(id, rowNumber));
  if (existing.exists()) {
    throw new Error(`Row ${rowNumber} already exists in zone ${id.toUpperCase()}.`);
  }

  const createdAt = now();
  const docData: WarehouseZoneRowDoc = {
    id: warehouseZoneRowDocId(id, rowNumber),
    zoneId: id,
    number: rowNumber,
    label: label?.trim() || null,
    createdAt,
    updatedAt: createdAt,
  };
  await setDoc(zoneRowRef(id, rowNumber), docData);
  return docData;
}

export async function deleteWarehouseZoneRow(zoneId: string, rowNumber: number): Promise<void> {
  const id = normalizeZoneId(zoneId);
  await deleteDoc(zoneRowRef(id, rowNumber));
}

export function nextWarehouseRowNumber(rows: WarehouseZoneRowDoc[]): number {
  const used = new Set(rows.map(row => row.number));
  for (let n = 1; n <= 99; n += 1) {
    if (!used.has(n)) return n;
  }
  throw new Error('Maximum row count reached for this zone.');
}

export function unusedZoneLetters(zones: WarehouseZoneDoc[]): string[] {
  const used = new Set(zones.map(zone => zone.id.toLowerCase()));
  const letters: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code).toLowerCase();
    if (!used.has(letter)) letters.push(letter);
  }
  return letters;
}
