/**
 * One Firestore doc per machine serial. Range metadata stays on
 * appSettings/serialNumberAllotment; this collection is the live pool.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { compactSerialKey, compactProductToken, expandSerialRange, parseSerialToken } from './serial-range.js';

export const SERIAL_UNITS = 'serialUnits';
export const PRODUCT_SERIAL_CURSORS = 'productSerialCursors';
export const WAREHOUSE_RC_CODE = 'IWP';
export const WAREHOUSE_RC_NAME = 'INTERWEIGHING PVT LTD';
const NON_GATC_ALLOCATIONS = 'nonGatcSerialAllocations';

export const SERIAL_UNIT_IN_STOCK = 'in_stock';
export const SERIAL_UNIT_INVOICED = 'invoiced';
export const SERIAL_UNIT_USED = 'used';
export const SERIAL_UNIT_VOID = 'void';

const WRITE_CHUNK = 400;

function str(value) {
  return value == null ? '' : String(value).trim();
}

function unitId(serial) {
  return compactSerialKey(serial);
}

export function serialUnitRef(db, serial) {
  return db.collection(SERIAL_UNITS).doc(unitId(serial));
}

export async function writeSerialUnitsForRange(row, extras = {}) {
  const serials = expandSerialRange({
    from: row?.from,
    to: row?.to,
    missing: Array.isArray(row?.missing) ? row.missing : [],
  });
  if (!serials.length) return { written: 0 };
  const db = getFirestore();
  const now = new Date().toISOString();
  const productId = str(row?.productId || row?.itemId) || null;
  const sku = str(row?.sku) || null;
  const productName = str(row?.productName) || null;
  const series = str(row?.series) || 'non_gatc';
  const base = {
    series,
    sku,
    productId,
    productName,
    imageUrl: str(row?.imageUrl) || null,
    goodsReceiptId: str(row?.sourceGoodsReceiptId) || extras.goodsReceiptId || null,
    sourcePoNumber: str(row?.sourcePoNumber) || extras.sourcePoNumber || null,
    sourceLineId: str(row?.sourceLineId) || extras.sourceLineId || null,
    allotmentId: str(row?.id) || null,
    updatedAt: now,
  };
  let written = 0;
  for (let i = 0; i < serials.length; i += 100) {
    const slice = serials.slice(i, i + 100).filter(serial => unitId(serial));
    if (!slice.length) continue;
    const refs = slice.map(serial => db.collection(SERIAL_UNITS).doc(unitId(serial)));
    const snaps = await db.getAll(...refs);
    let batch = db.batch();
    let count = 0;
    for (let j = 0; j < slice.length; j += 1) {
      const snap = snaps[j];
      const serial = slice[j];
      const id = unitId(serial);
      if (!id) continue;
      const status = str(snap.data()?.status);
      if (status === SERIAL_UNIT_INVOICED || status === SERIAL_UNIT_USED) {
        if (productId && !str(snap.data()?.productId)) {
          batch.set(snap.ref, { productId, sku, productName, updatedAt: now }, { merge: true });
          count += 1;
        }
        continue;
      }
      batch.set(snap.ref, {
        ...base,
        serial,
        status: SERIAL_UNIT_IN_STOCK,
        ...(snap.exists ? {} : {
          rcCode: null,
          invoiceId: null,
          createdAt: now,
        }),
      }, { merge: true });
      count += 1;
      written += 1;
      if (count >= WRITE_CHUNK) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count) await batch.commit();
  }
  await updateProductSerialCursor({
    productId,
    sku,
    productName,
    lastSerial: serials[serials.length - 1],
    goodsReceiptId: str(row?.sourceGoodsReceiptId) || extras.goodsReceiptId || null,
  });
  return { written };
}

export async function updateProductSerialCursor({
  productId,
  sku,
  productName,
  lastSerial,
  goodsReceiptId,
} = {}) {
  const id = str(productId) || str(sku);
  const serial = str(lastSerial);
  if (!id || !serial) return null;
  const parsed = parseSerialToken(serial);
  const db = getFirestore();
  await db.collection(PRODUCT_SERIAL_CURSORS).doc(id).set({
    productId: str(productId) || null,
    sku: str(sku) || null,
    productName: str(productName) || null,
    lastSerial: serial,
    prefix: parsed?.prefix || null,
    lastN: parsed?.n ?? null,
    width: parsed?.width ?? null,
    goodsReceiptId: str(goodsReceiptId) || null,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return serial;
}

export function suggestNextSerial(cursor) {
  const last = str(cursor?.lastSerial);
  const parsed = parseSerialToken(last);
  if (!parsed) return '';
  const n = parsed.n + 1;
  const raw = String(n);
  const width = Math.max(parsed.width, raw.length);
  return `${parsed.prefix}${raw.padStart(width, '0')}`;
}

export async function listAvailableSerialUnits({
  productId = '',
  sku = '',
  max = 2000,
} = {}) {
  const db = getFirestore();
  const limit = Math.min(5000, Math.max(1, Number(max) || 2000));
  const wantProduct = compactProductToken(productId);
  const wantSku = compactProductToken(sku);
  const filtered = Boolean(wantProduct || wantSku);
  const snap = await db.collection(SERIAL_UNITS)
    .where('status', '==', SERIAL_UNIT_IN_STOCK)
    .limit(5000)
    .get();
  const rows = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    const unitProduct = compactProductToken(data.productId);
    const unitSku = compactProductToken(data.sku);
    const bound = Boolean(unitProduct || unitSku);
    if (filtered) {
      if (bound && unitProduct !== wantProduct && unitSku !== wantSku) return;
    } else if (bound) {
      return;
    }
    const serial = str(data.serial) || doc.id;
    rows.push({
      id: doc.id,
      serialNumber: serial,
      sku: str(data.sku) || null,
      productId: str(data.productId) || null,
      productName: str(data.productName) || null,
    });
  });
  rows.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber, 'en', { numeric: true }));
  return rows.slice(0, limit);
}

export async function ensureSerialUnitsFromAllotments(allotments, filter = {}) {
  const wantProduct = compactProductToken(filter.productId);
  const wantSku = compactProductToken(filter.sku);
  const rows = Array.isArray(allotments) ? allotments : [];
  let written = 0;
  for (const row of rows) {
    const productId = compactProductToken(row?.productId || row?.itemId);
    const sku = compactProductToken(row?.sku);
    if (wantProduct && productId !== wantProduct && sku !== wantSku) continue;
    if (!wantProduct && wantSku && sku !== wantSku) continue;
    if (!productId && !sku) continue;
    const result = await writeSerialUnitsForRange(row);
    written += Number(result?.written) || 0;
  }
  return { written };
}

export async function markSerialUnitsInvoiced({
  serials,
  invoiceId,
  invoiceNumber,
  customerId,
  lineId,
  rcCode,
  rcName,
  actorName,
} = {}) {
  return patchSerialUnits(serials, {
    status: SERIAL_UNIT_INVOICED,
    invoiceId: str(invoiceId) || null,
    invoiceNumber: str(invoiceNumber) || null,
    customerId: str(customerId) || null,
    lineId: str(lineId) || null,
    rcCode: str(rcCode) || null,
    rcName: str(rcName) || null,
    allottedAt: new Date().toISOString(),
    allottedBy: str(actorName) || null,
  });
}

export async function markSerialUnitsInStock(serials) {
  return patchSerialUnits(serials, {
    status: SERIAL_UNIT_IN_STOCK,
    invoiceId: null,
    invoiceNumber: null,
    customerId: null,
    lineId: null,
    rcCode: null,
    rcName: null,
    allottedAt: null,
    allottedBy: null,
    usedAt: null,
  });
}

export async function markSerialUnitsUsed(serials) {
  return patchSerialUnits(serials, {
    status: SERIAL_UNIT_USED,
    usedAt: new Date().toISOString(),
  });
}

/** Delete in-stock units for a range. Throws if any serial is invoiced, used, or allotted. */
export async function assertSerialRangeNeverUsed(row) {
  const serials = expandSerialRange({
    from: row?.from,
    to: row?.to,
    missing: Array.isArray(row?.missing) ? row.missing : [],
  });
  if (!serials.length) return { serials: 0 };
  const db = getFirestore();
  const used = [];
  for (let i = 0; i < serials.length; i += 100) {
    const slice = serials.slice(i, i + 100);
    const ids = slice.map(unitId).filter(Boolean);
    if (!ids.length) continue;
    const unitRefs = ids.map(id => db.collection(SERIAL_UNITS).doc(id));
    const allocRefs = ids.map(id => db.collection(NON_GATC_ALLOCATIONS).doc(id));
    const [unitSnaps, allocSnaps] = await Promise.all([
      db.getAll(...unitRefs),
      db.getAll(...allocRefs),
    ]);
    for (let j = 0; j < ids.length; j += 1) {
      const status = str(unitSnaps[j].data()?.status);
      if (status === SERIAL_UNIT_INVOICED || status === SERIAL_UNIT_USED || allocSnaps[j].exists) {
        used.push(slice[j] || ids[j]);
      }
    }
  }
  if (used.length) {
    const sample = used.slice(0, 8).join(', ');
    throw new Error(
      `Cannot delete: ${used.length} serial${used.length === 1 ? '' : 's'} already used (${sample}${used.length > 8 ? '…' : ''}).`,
    );
  }
  return { serials: serials.length };
}

export async function deleteUnusedSerialUnitsForRange(row) {
  await assertSerialRangeNeverUsed(row);
  const serials = expandSerialRange({
    from: row?.from,
    to: row?.to,
    missing: Array.isArray(row?.missing) ? row.missing : [],
  });
  if (!serials.length) return { deleted: 0, serials: 0 };
  const db = getFirestore();
  let deleted = 0;
  let batch = db.batch();
  let count = 0;
  for (let i = 0; i < serials.length; i += 100) {
    const ids = serials.slice(i, i + 100).map(unitId).filter(Boolean);
    if (!ids.length) continue;
    const snaps = await db.getAll(...ids.map(id => db.collection(SERIAL_UNITS).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      batch.delete(snap.ref);
      count += 1;
      deleted += 1;
      if (count >= WRITE_CHUNK) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
  }
  if (count) await batch.commit();
  return { deleted, serials: serials.length };
}

async function patchSerialUnits(serials, patch) {
  const list = (Array.isArray(serials) ? serials : []).map(str).filter(Boolean);
  if (!list.length) return { updated: 0 };
  const db = getFirestore();
  const now = new Date().toISOString();
  let batch = db.batch();
  let count = 0;
  let updated = 0;
  for (const serial of list) {
    const id = unitId(serial);
    if (!id) continue;
    batch.set(db.collection(SERIAL_UNITS).doc(id), {
      ...patch,
      serial: str(serial),
      updatedAt: now,
    }, { merge: true });
    count += 1;
    updated += 1;
    if (count >= WRITE_CHUNK) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();
  return { updated };
}
