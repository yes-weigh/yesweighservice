/**
 * PO machine serial ranges (Firestore only). Applied to serial allotment
 * when a goods receipt is marked received — not when the PO is created.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { compactSerialKey, previewSerialRange } from './serial-range.js';
import { pushSerialAllotmentsToYesGatc } from './yesgatc-serial-push.js';

const ALLOTMENT_DOC = 'appSettings/serialNumberAllotment';

function str(value) {
  return value == null ? '' : String(value).trim();
}

function serialRangeKey(row) {
  const series = str(row?.series) || 'non_gatc';
  return `${series}:${compactSerialKey(row?.from)}:${compactSerialKey(row?.to)}`;
}

function stableAllotmentId(poId, lineId) {
  const raw = `po_${str(poId)}_${str(lineId)}`.replace(/[^A-Za-z0-9_-]/g, '_');
  return raw.slice(0, 80) || `po_${Date.now()}`;
}

export function normalizeIncomingSerialRanges(rawRanges, lineItems) {
  const incoming = Array.isArray(rawRanges) ? rawRanges : [];
  const byLineId = new Map();
  const byItemQueue = new Map();

  for (const row of incoming) {
    const start = str(row?.startNumber ?? row?.from);
    const end = str(row?.endNumber ?? row?.to);
    if (!start && !end) continue;
    const preview = previewSerialRange({ from: start, to: end });
    if (preview.error) {
      throw new Error(preview.error);
    }
    const payload = {
      startNumber: preview.from,
      endNumber: preview.to,
      qty: preview.count,
      itemId: str(row?.itemId ?? row?.productId) || null,
      sku: str(row?.sku) || null,
      productName: str(row?.productName ?? row?.name) || null,
      imageUrl: str(row?.imageUrl) || null,
    };
    const lineId = str(row?.lineId);
    if (lineId) byLineId.set(lineId, payload);
    if (payload.itemId) {
      const queue = byItemQueue.get(payload.itemId) || [];
      queue.push(payload);
      byItemQueue.set(payload.itemId, queue);
    }
  }

  const out = {};
  for (const line of Array.isArray(lineItems) ? lineItems : []) {
    const lineId = str(line?.id);
    if (!lineId) continue;
    let match = byLineId.get(lineId);
    if (!match) {
      const queue = byItemQueue.get(str(line?.itemId));
      if (queue?.length) match = queue.shift();
    }
    if (!match) continue;
    out[lineId] = {
      ...match,
      itemId: match.itemId || str(line.itemId) || null,
      sku: match.sku || str(line.sku) || null,
      productName: match.productName || str(line.name) || null,
      imageUrl: match.imageUrl || str(line.imageUrl) || null,
    };
  }
  return out;
}

export async function writePurchaseOrderSerialRanges(purchaseOrderId, rawRanges) {
  const id = str(purchaseOrderId);
  if (!id) throw new Error('purchaseOrderId is required.');
  const ref = getFirestore().collection('purchaseOrders').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Purchase order not found.');
  const data = snap.data() || {};
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
  const serialRangesByLineId = normalizeIncomingSerialRanges(rawRanges, lineItems);
  // update() replaces the map so stale Zoho line ids do not linger after a PUT.
  await ref.update({
    serialRangesByLineId,
    serialRangesUpdatedAt: new Date().toISOString(),
  });
  return { id, serialRangesByLineId };
}

async function lookupPurchaseOrderByNumber(poNumber) {
  const number = str(poNumber);
  if (!number) return null;
  const snap = await getFirestore()
    .collection('purchaseOrders')
    .where('purchaseOrderNumber', '==', number)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() || {} };
}

async function enrichRangeFromCatalog(range) {
  const itemId = str(range.itemId);
  if (!itemId) return range;
  if (range.imageUrl && range.sku && range.productName) return range;
  const snap = await getFirestore().collection('catalogProducts').doc(itemId).get();
  if (!snap.exists) return range;
  const data = snap.data() || {};
  return {
    ...range,
    sku: range.sku || str(data.sku) || null,
    productName: range.productName || str(data.name) || null,
    imageUrl: range.imageUrl || str(data.imageUrl) || null,
  };
}

/**
 * Append PO serial ranges to appSettings/serialNumberAllotment once,
 * then try YesGATC. Never throws for a missing PO / empty ranges.
 */
export async function applyPurchaseOrderSerialsOnGoodsReceipt({
  goodsReceiptId,
  purchaseOrderNumber,
  markedByName,
} = {}) {
  const grId = str(goodsReceiptId);
  if (!grId) return { applied: 0, alreadyApplied: false, pushed: 0 };

  const db = getFirestore();
  const grRef = db.collection('goodsReceipts').doc(grId);
  const grSnap = await grRef.get();
  const gr = grSnap.exists ? (grSnap.data() || {}) : {};

  if (gr.serialAllotmentAppliedAt) {
    return { applied: 0, alreadyApplied: true, pushed: 0 };
  }

  const poNumber = str(purchaseOrderNumber) || str(gr.purchaseOrderNumber) || str(gr.referenceNumber);
  if (!poNumber) {
    return { applied: 0, alreadyApplied: false, pushed: 0, skipped: 'no_po' };
  }

  const po = await lookupPurchaseOrderByNumber(poNumber);
  if (!po) {
    return { applied: 0, alreadyApplied: false, pushed: 0, skipped: 'po_not_found' };
  }

  const ranges = po.data.serialRangesByLineId && typeof po.data.serialRangesByLineId === 'object'
    ? po.data.serialRangesByLineId
    : {};
  const newRows = [];
  for (const [lineId, raw] of Object.entries(ranges)) {
    const start = str(raw?.startNumber ?? raw?.from);
    const end = str(raw?.endNumber ?? raw?.to);
    if (!start || !end) continue;
    const preview = previewSerialRange({ from: start, to: end });
    if (preview.error) continue;
    const enriched = await enrichRangeFromCatalog({
      itemId: str(raw?.itemId) || null,
      sku: str(raw?.sku) || null,
      productName: str(raw?.productName ?? raw?.name) || null,
      imageUrl: str(raw?.imageUrl) || null,
    });
    newRows.push({
      id: stableAllotmentId(po.id, lineId),
      series: 'non_gatc',
      from: preview.from,
      to: preview.to,
      missing: [],
      count: preview.count,
      createdAt: new Date().toISOString(),
      createdBy: str(markedByName) || 'Goods receipt',
      pushedAt: null,
      pushError: null,
      sku: enriched.sku,
      imageUrl: enriched.imageUrl,
      productName: enriched.productName,
      sourcePoNumber: poNumber,
      sourceLineId: str(lineId),
      sourceGoodsReceiptId: grId,
    });
  }

  if (newRows.length) {
    const allotRef = db.doc(ALLOTMENT_DOC);
    await db.runTransaction(async tx => {
      const snap = await tx.get(allotRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      const existing = Array.isArray(data.allotments) ? data.allotments : [];
      const seenKeys = new Set(existing.map(serialRangeKey));
      const seenIds = new Set(existing.map(row => str(row?.id)));
      const merged = [...existing];
      for (const row of newRows) {
        if (seenKeys.has(serialRangeKey(row)) || seenIds.has(row.id)) continue;
        seenKeys.add(serialRangeKey(row));
        seenIds.add(row.id);
        merged.push(row);
      }
      tx.set(allotRef, {
        allotments: merged,
        updatedAt: new Date().toISOString(),
        updatedBy: str(markedByName) || 'Goods receipt',
      }, { merge: true });
    });
  }

  await grRef.set({
    purchaseOrderNumber: poNumber,
    serialAllotmentAppliedAt: new Date().toISOString(),
    serialAllotmentCount: newRows.length,
  }, { merge: true });

  let pushed = 0;
  if (newRows.length) {
    try {
      const result = await pushSerialAllotmentsToYesGatc({
        mode: 'ids',
        ids: newRows.map(row => row.id),
        actorName: str(markedByName) || 'Goods receipt',
      });
      pushed = Number(result?.sent) || 0;
    } catch {
      // Leave pending — Serial numbers → Test retries YesGATC.
    }
  }

  return { applied: newRows.length, alreadyApplied: false, pushed };
}
