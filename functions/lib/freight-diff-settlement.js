/**
 * Per-dealer last logistics freight Diff → next SO freight line.
 *
 * Ledger: customerFreightSettlements/{zohoCustomerId}
 * - remainingInr: unsettled and not currently on an SO
 * - reservedAppliedInr + reservedSalesOrderId: slice sitting on one open SO
 * Settles only when an SO with freight is invoiced.
 */

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { isFreightOrderLine, isFreightSku, isFreightProductId } from './freight-lines.js';
import {
  updateSalesOrderLines,
  fetchZohoSalesOrder,
} from './zoho-sales-orders.js';

export const CUSTOMER_FREIGHT_SETTLEMENTS = 'customerFreightSettlements';
export const FREIGHT_ADJUST_REMARK_PREFIX = 'Freight adjust';

const EPS = 0.009;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function settlementRef(db, zohoCustomerId) {
  return db.collection(CUSTOMER_FREIGHT_SETTLEMENTS).doc(String(zohoCustomerId).trim());
}

function isInvoiceFreightLine(line = {}) {
  if (isFreightOrderLine(line)) return true;
  if (isFreightProductId(line.itemId || line.productId || line.id)) return true;
  if (isFreightSku(line.sku)) return true;
  const name = String(line.name || '').toLowerCase();
  const sku = String(line.sku || '').toLowerCase();
  return name.includes('freight') || sku.includes('freight');
}

function lineAmount(line) {
  if (typeof line.total === 'number' && Number.isFinite(line.total)) return line.total;
  if (typeof line.itemTotal === 'number' && Number.isFinite(line.itemTotal)) return line.itemTotal;
  const rate = Number(line.rate) || 0;
  const qty = Number(line.quantity) || 0;
  return rate * qty;
}

export function sumPaidFreightFromInvoiceLines(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  return round2(items.reduce((sum, line) => (
    isInvoiceFreightLine(line) ? sum + lineAmount(line) : sum
  ), 0));
}

export function actualFreightExclGstFromBooking(booking) {
  if (!booking || typeof booking !== 'object') return null;
  if (typeof booking.actualFreightInr === 'number' && Number.isFinite(booking.actualFreightInr)) {
    return round2(booking.actualFreightInr);
  }
  const api = booking.courierFreight;
  if (!api || typeof api !== 'object' || !api.ok) return null;
  const preTax = api.breakup?.preTaxFreight;
  if (typeof preTax === 'number' && Number.isFinite(preTax)) return round2(preTax);
  if (
    typeof api.totalInr === 'number'
    && Number.isFinite(api.totalInr)
    && typeof api.breakup?.gst === 'number'
    && Number.isFinite(api.breakup.gst)
  ) {
    return round2(api.totalInr - api.breakup.gst);
  }
  return typeof api.totalInr === 'number' && Number.isFinite(api.totalInr)
    ? round2(api.totalInr)
    : null;
}

export function isFodBooking(booking) {
  const mode = booking?.freightBillingMode || booking?.courierFreight?.billingMode;
  return mode === 'fod';
}

export function formatFreightAdjustRemark({
  appliedInr,
  invoiceNumber,
  lrn,
}) {
  const amount = round2(Math.abs(Number(appliedInr) || 0));
  const direction = Number(appliedInr) >= 0 ? 'under-billed' : 'over-billed';
  const inv = String(invoiceNumber || '').trim() || 'prior invoice';
  const lr = String(lrn || '').trim();
  const lrBit = lr ? ` LR ${lr}` : '';
  return `${FREIGHT_ADJUST_REMARK_PREFIX} ₹${amount.toLocaleString('en-IN')} vs ${inv}${lrBit} (${direction})`;
}

export function stripFreightAdjustRemarks(notes) {
  const text = String(notes || '');
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith(FREIGHT_ADJUST_REMARK_PREFIX))
    .join('\n')
    .trim();
}

export function appendFreightAdjustRemark(notes, remark) {
  const base = stripFreightAdjustRemarks(notes);
  const bit = String(remark || '').trim();
  if (!bit) return base;
  return base ? `${base}\n${bit}` : bit;
}

/**
 * Apply signed remainingInr to the first freight line.
 * @returns {{
 *   lines: any[],
 *   appliedInr: number,
 *   remainingInr: number,
 *   baseFreightInr: number | null,
 *   freightIndex: number,
 * }}
 */
export function applyFreightDiffToLines(lines, remainingInr) {
  const next = (Array.isArray(lines) ? lines : []).map(line => ({ ...line }));
  const remaining = round2(Number(remainingInr) || 0);
  const freightIndex = next.findIndex(isFreightOrderLine);
  if (freightIndex < 0 || Math.abs(remaining) <= EPS) {
    return {
      lines: next,
      appliedInr: 0,
      remainingInr: remaining,
      baseFreightInr: null,
      freightIndex: -1,
    };
  }
  const freight = next[freightIndex];
  const base = round2(Number(freight.rate) || 0);
  let applied = 0;
  let newRemaining = remaining;
  if (remaining > 0) {
    // Under-billed: add full remaining to freight.
    freight.rate = round2(base + remaining);
    applied = remaining;
    newRemaining = 0;
  } else {
    // Over-billed credit: reduce freight to ₹0 max; keep leftover pending.
    const credit = Math.min(base, Math.abs(remaining));
    applied = -round2(credit);
    freight.rate = round2(base - credit);
    newRemaining = round2(remaining - applied); // e.g. -500 - (-200) = -300
  }
  if (typeof freight.lineTotal === 'number') {
    freight.lineTotal = round2((Number(freight.quantity) || 1) * Number(freight.rate));
  }
  next[freightIndex] = freight;
  return {
    lines: next,
    appliedInr: round2(applied),
    remainingInr: round2(newRemaining),
    baseFreightInr: base,
    freightIndex,
  };
}

export function removeFreightDiffFromLines(lines, appliedInr) {
  const next = (Array.isArray(lines) ? lines : []).map(line => ({ ...line }));
  const applied = round2(Number(appliedInr) || 0);
  if (Math.abs(applied) <= EPS) {
    return { lines: next, freightIndex: -1 };
  }
  const freightIndex = next.findIndex(isFreightOrderLine);
  if (freightIndex < 0) return { lines: next, freightIndex: -1 };
  const freight = next[freightIndex];
  const rate = round2(Number(freight.rate) || 0);
  // Undo: subtract what was applied (if applied +200, rate -= 200; if applied -200, rate += 200).
  freight.rate = round2(Math.max(0, rate - applied));
  if (typeof freight.lineTotal === 'number') {
    freight.lineTotal = round2((Number(freight.quantity) || 1) * Number(freight.rate));
  }
  next[freightIndex] = freight;
  return { lines: next, freightIndex };
}

function bookingSortKey(data) {
  const bookingDate = String(data.bookingDate || '').slice(0, 10);
  const createdAt = String(data.createdAt || '');
  return `${bookingDate}T${createdAt}`;
}

/**
 * Find newest BTC logistics booking with a non-zero computable Diff.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} zohoCustomerId
 */
export async function resolveLastFreightDiff(db, zohoCustomerId) {
  const customerId = String(zohoCustomerId || '').trim();
  if (!customerId) {
    return { ok: false, error: 'Customer required', diff: null };
  }

  let snap;
  try {
    snap = await db.collection('logisticsBookings')
      .where('zohoCustomerId', '==', customerId)
      .limit(80)
      .get();
  } catch (err) {
    // Fallback if composite index missing — scan recent by dealerId field variants.
    snap = await db.collection('logisticsBookings').limit(200).get();
    snap = {
      docs: snap.docs.filter(d => {
        const x = d.data() || {};
        return String(x.zohoCustomerId || x.dealerSnapshot?.zohoCustomerId || '').trim() === customerId;
      }),
    };
  }

  const rows = snap.docs
    .map(doc => ({ id: doc.id, data: doc.data() || {} }))
    .filter(row => {
      const status = String(row.data.status || '');
      return status !== 'cancelled' && status !== 'returned';
    })
    .sort((a, b) => bookingSortKey(b.data).localeCompare(bookingSortKey(a.data)));

  for (const row of rows) {
    const booking = row.data;
    if (booking.freightDiffSettledAt) continue;
    if (isFodBooking(booking)) continue;

    const invoiceId = String(booking.invoiceId || '').trim();
    if (!invoiceId) continue;

    let paid = null;
    try {
      const invSnap = await db.doc(`customers/${customerId}/invoices/${invoiceId}`).get();
      if (invSnap.exists) {
        paid = sumPaidFreightFromInvoiceLines(invSnap.data()?.lineItems);
      }
    } catch {
      paid = null;
    }
    if (paid == null) continue;

    const actual = actualFreightExclGstFromBooking(booking);
    if (actual == null) continue;

    const differenceInr = round2(actual - paid);
    if (Math.abs(differenceInr) <= EPS) continue;

    return {
      ok: true,
      error: null,
      diff: {
        bookingId: row.id,
        invoiceId,
        invoiceNumber: String(booking.invoiceNumber || '').trim() || null,
        lrn: String(booking.consignmentNo || '').trim() || null,
        paidFreightInr: paid,
        actualFreightInr: actual,
        differenceInr,
      },
    };
  }

  return { ok: true, error: null, diff: null };
}

/**
 * Sync ledger source from last logistics when nothing is reserved.
 * Does not overwrite an active reservation's source mid-flight.
 */
export async function syncCustomerFreightSettlementLedger(db, zohoCustomerId) {
  const customerId = String(zohoCustomerId || '').trim();
  const ref = settlementRef(db, customerId);
  const resolved = await resolveLastFreightDiff(db, customerId);
  const diff = resolved.diff;

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : {};
    const reservedSo = String(prev.reservedSalesOrderId || '').trim();
    if (reservedSo) {
      return {
        ...prev,
        remainingInr: round2(Number(prev.remainingInr) || 0),
        reservedAppliedInr: round2(Number(prev.reservedAppliedInr) || 0),
        hasReservation: true,
      };
    }

    if (!diff) {
      const empty = {
        zohoCustomerId: customerId,
        sourceBookingId: null,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        sourceLrn: null,
        sourceDifferenceInr: 0,
        remainingInr: 0,
        reservedSalesOrderId: null,
        reservedSalesOrderNumber: null,
        reservedAppliedInr: 0,
        reservedBaseFreightInr: null,
        reservedAt: null,
        updatedAt: nowIso(),
      };
      tx.set(ref, empty, { merge: true });
      return { ...empty, hasReservation: false };
    }

    const sameSource = String(prev.sourceBookingId || '') === diff.bookingId;
    const remainingInr = sameSource
      ? round2(Number(prev.remainingInr) || 0)
      : diff.differenceInr;

    // New source replaces prior unsettled remaining when not reserved.
    const next = {
      zohoCustomerId: customerId,
      sourceBookingId: diff.bookingId,
      sourceInvoiceId: diff.invoiceId,
      sourceInvoiceNumber: diff.invoiceNumber,
      sourceLrn: diff.lrn,
      sourceDifferenceInr: diff.differenceInr,
      remainingInr: sameSource && Math.abs(remainingInr) > EPS
        ? remainingInr
        : diff.differenceInr,
      reservedSalesOrderId: null,
      reservedSalesOrderNumber: null,
      reservedAppliedInr: 0,
      reservedBaseFreightInr: null,
      reservedAt: null,
      updatedAt: nowIso(),
    };
    // If same source was partially settled, keep remaining; if remaining was zeroed by settle, stay 0.
    if (sameSource && Math.abs(remainingInr) <= EPS && prev.settledAt) {
      next.remainingInr = 0;
    }
    tx.set(ref, next, { merge: true });
    return { ...next, hasReservation: false };
  });
}

/**
 * Prepare lines/remarks for SO create (does not reserve until SO ids exist).
 */
export async function prepareFreightDiffForOrderCreate(db, zohoCustomerId, lines, remarks) {
  const ledger = await syncCustomerFreightSettlementLedger(db, zohoCustomerId);
  const remaining = round2(Number(ledger.remainingInr) || 0);
  if (ledger.hasReservation || Math.abs(remaining) <= EPS) {
    return {
      lines,
      remarks: String(remarks || ''),
      apply: null,
      ledger,
    };
  }
  if (!lines.some(isFreightOrderLine)) {
    return {
      lines,
      remarks: String(remarks || ''),
      apply: null,
      ledger,
    };
  }

  const result = applyFreightDiffToLines(lines, remaining);
  if (Math.abs(result.appliedInr) <= EPS) {
    return {
      lines,
      remarks: String(remarks || ''),
      apply: null,
      ledger,
    };
  }

  const remark = formatFreightAdjustRemark({
    appliedInr: result.appliedInr,
    invoiceNumber: ledger.sourceInvoiceNumber,
    lrn: ledger.sourceLrn,
  });

  return {
    lines: result.lines,
    remarks: appendFreightAdjustRemark(remarks, remark),
    apply: {
      appliedInr: result.appliedInr,
      remainingAfter: result.remainingInr,
      baseFreightInr: result.baseFreightInr,
      remark,
      sourceBookingId: ledger.sourceBookingId,
      sourceInvoiceNumber: ledger.sourceInvoiceNumber,
      sourceLrn: ledger.sourceLrn,
    },
    ledger,
  };
}

export async function reserveFreightDiffOnSalesOrder(db, {
  zohoCustomerId,
  salesOrderId,
  salesOrderNumber,
  apply,
}) {
  if (!apply || Math.abs(apply.appliedInr) <= EPS) return null;
  const customerId = String(zohoCustomerId || '').trim();
  const soId = String(salesOrderId || '').trim();
  if (!customerId || !soId) return null;

  const ref = settlementRef(db, customerId);
  const soRef = db.collection('salesOrders').doc(soId);

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() || {}) : {};
    if (String(prev.reservedSalesOrderId || '').trim()) {
      throw new Error('Freight difference is already reserved on another sales order.');
    }
    tx.set(ref, {
      remainingInr: round2(apply.remainingAfter),
      reservedSalesOrderId: soId,
      reservedSalesOrderNumber: salesOrderNumber || null,
      reservedAppliedInr: round2(apply.appliedInr),
      reservedBaseFreightInr: apply.baseFreightInr,
      reservedAt: nowIso(),
      updatedAt: nowIso(),
    }, { merge: true });
    tx.set(soRef, {
      yesOneFreightAdjustInr: round2(apply.appliedInr),
      yesOneFreightAdjustSourceBookingId: apply.sourceBookingId || null,
      yesOneFreightAdjustRemark: apply.remark || null,
      yesOneUpdatedAt: nowIso(),
    }, { merge: true });
  });

  return { salesOrderId: soId, appliedInr: apply.appliedInr };
}

/**
 * Preview for UI (no writes).
 */
export async function getPendingFreightDiffPreview(db, zohoCustomerId) {
  const ledger = await syncCustomerFreightSettlementLedger(db, zohoCustomerId);
  const remaining = round2(Number(ledger.remainingInr) || 0);
  const reserved = round2(Number(ledger.reservedAppliedInr) || 0);
  const available = ledger.hasReservation ? 0 : remaining;
  return {
    zohoCustomerId: String(zohoCustomerId || '').trim(),
    sourceBookingId: ledger.sourceBookingId || null,
    sourceInvoiceNumber: ledger.sourceInvoiceNumber || null,
    sourceLrn: ledger.sourceLrn || null,
    sourceDifferenceInr: round2(Number(ledger.sourceDifferenceInr) || 0),
    remainingInr: remaining,
    availableInr: available,
    reservedSalesOrderId: ledger.reservedSalesOrderId || null,
    reservedSalesOrderNumber: ledger.reservedSalesOrderNumber || null,
    reservedAppliedInr: reserved,
    willApplyOnNextFreightSo: Math.abs(available) > EPS,
  };
}

async function loadZohoSalesOrder(secrets, configuredOrgId, salesOrderId) {
  return fetchZohoSalesOrder(secrets, configuredOrgId, salesOrderId);
}

function zohoLinesToOrderLines(so) {
  const items = Array.isArray(so?.line_items) ? so.line_items : [];
  return items.map(item => ({
    itemId: item.item_id != null ? String(item.item_id) : '',
    productId: item.item_id != null ? String(item.item_id) : '',
    name: item.name ? String(item.name) : '',
    sku: item.sku ? String(item.sku) : '',
    rate: Number(item.rate) || 0,
    quantity: Number(item.quantity) || 0,
    unit: item.unit ? String(item.unit) : undefined,
    hsn: item.hsn_or_sac != null ? String(item.hsn_or_sac) : null,
  }));
}

async function pushZohoLinesAndNotes(secrets, orgId, salesOrderId, lines, notes, allowConfirmed = false) {
  return updateSalesOrderLines(secrets, orgId, salesOrderId, lines, {
    notes: notes == null ? undefined : String(notes),
    allowConfirmed,
  });
}

/**
 * Release reservation (void/delete SO). Restores remainingInr.
 */
export async function releaseFreightDiffReservation(db, {
  salesOrderId,
  secrets = null,
  orgId = null,
  stripZoho = false,
}) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) return { released: false };

  const dbx = db || getFirestore();
  const soSnap = await dbx.collection('salesOrders').doc(soId).get();
  const soData = soSnap.exists ? (soSnap.data() || {}) : {};
  const customerId = String(soData.customerId || '').trim();

  let ledgerSnap = null;
  let ledgerRef = null;
  if (customerId) {
    ledgerRef = settlementRef(dbx, customerId);
    ledgerSnap = await ledgerRef.get();
  } else {
    // Find ledger by reserved SO id.
    const q = await dbx.collection(CUSTOMER_FREIGHT_SETTLEMENTS)
      .where('reservedSalesOrderId', '==', soId)
      .limit(1)
      .get();
    if (!q.empty) {
      ledgerRef = q.docs[0].ref;
      ledgerSnap = q.docs[0];
    }
  }

  if (!ledgerSnap?.exists) {
    if (soSnap.exists) {
      await soSnap.ref.set({
        yesOneFreightAdjustInr: FieldValue.delete(),
        yesOneFreightAdjustSourceBookingId: FieldValue.delete(),
        yesOneFreightAdjustRemark: FieldValue.delete(),
        yesOneUpdatedAt: nowIso(),
      }, { merge: true });
    }
    return { released: false };
  }

  const ledger = ledgerSnap.data() || {};
  if (String(ledger.reservedSalesOrderId || '').trim() !== soId) {
    return { released: false };
  }

  const applied = round2(Number(ledger.reservedAppliedInr) || 0);
  const remaining = round2((Number(ledger.remainingInr) || 0) + applied);

  if (stripZoho && secrets && orgId && Math.abs(applied) > EPS) {
    try {
      const so = await loadZohoSalesOrder(secrets, orgId, soId);
      if (so) {
        const status = String(so.status || '').toLowerCase().replace(/\s+/g, '_');
        if (status === 'draft' || status === 'pending') {
          const stripped = removeFreightDiffFromLines(zohoLinesToOrderLines(so), applied);
          const notes = stripFreightAdjustRemarks(so.notes || '');
          await pushZohoLinesAndNotes(secrets, orgId, soId, stripped.lines, notes);
        }
      }
    } catch (err) {
      console.warn(`releaseFreightDiffReservation Zoho strip failed for ${soId}:`, err?.message || err);
    }
  }

  await ledgerRef.set({
    remainingInr: remaining,
    reservedSalesOrderId: null,
    reservedSalesOrderNumber: null,
    reservedAppliedInr: 0,
    reservedBaseFreightInr: null,
    reservedAt: null,
    updatedAt: nowIso(),
  }, { merge: true });

  if (soSnap.exists) {
    await soSnap.ref.set({
      yesOneFreightAdjustInr: FieldValue.delete(),
      yesOneFreightAdjustSourceBookingId: FieldValue.delete(),
      yesOneFreightAdjustRemark: FieldValue.delete(),
      yesOneUpdatedAt: nowIso(),
    }, { merge: true });
  }

  return { released: true, remainingInr: remaining };
}

/**
 * Before invoicing: ensure this SO (if it has freight) holds the adjustment.
 * Moves from another reserved SO when needed; applies leftover remaining.
 */
export async function ensureFreightDiffOnInvoicingSalesOrder(db, {
  secrets,
  orgId,
  salesOrderId,
  zohoCustomerId: zohoCustomerIdHint = null,
}) {
  const soId = String(salesOrderId || '').trim();
  if (!soId || !secrets) return { changed: false };

  const soRef = db.collection('salesOrders').doc(soId);
  const soSnap = await soRef.get();
  const soData = soSnap.exists ? (soSnap.data() || {}) : {};
  const customerId = String(zohoCustomerIdHint || soData.customerId || '').trim();
  if (!customerId) return { changed: false };

  const zohoSo = await loadZohoSalesOrder(secrets, orgId, soId);
  if (!zohoSo) return { changed: false };

  let lines = zohoLinesToOrderLines(zohoSo);
  if (!lines.some(isFreightOrderLine)) {
    return { changed: false, reason: 'no_freight' };
  }

  await syncCustomerFreightSettlementLedger(db, customerId);
  const ledgerRef = settlementRef(db, customerId);
  const ledgerSnap = await ledgerRef.get();
  const ledger = ledgerSnap.exists ? (ledgerSnap.data() || {}) : {};

  const reservedSo = String(ledger.reservedSalesOrderId || '').trim();
  let remaining = round2(Number(ledger.remainingInr) || 0);
  let notes = String(zohoSo.notes || '');
  let changed = false;

  // Move off another reserved SO first.
  if (reservedSo && reservedSo !== soId) {
    const applied = round2(Number(ledger.reservedAppliedInr) || 0);
    await releaseFreightDiffReservation(db, {
      salesOrderId: reservedSo,
      secrets,
      orgId,
      stripZoho: true,
    });
    const refreshed = await ledgerRef.get();
    remaining = round2(Number(refreshed.data()?.remainingInr) || 0);
    changed = true;
  } else if (reservedSo === soId) {
    // Already reserved here — nothing to move; will settle later.
    return {
      changed: false,
      alreadyReserved: true,
      appliedInr: round2(Number(ledger.reservedAppliedInr) || 0),
    };
  }

  if (Math.abs(remaining) <= EPS) {
    return { changed, reason: 'nothing_pending' };
  }

  const appliedResult = applyFreightDiffToLines(lines, remaining);
  if (Math.abs(appliedResult.appliedInr) <= EPS) {
    return { changed, reason: 'nothing_applied' };
  }

  const remark = formatFreightAdjustRemark({
    appliedInr: appliedResult.appliedInr,
    invoiceNumber: ledger.sourceInvoiceNumber,
    lrn: ledger.sourceLrn,
  });
  notes = appendFreightAdjustRemark(notes, remark);
  lines = appliedResult.lines;

  try {
    const status = String(zohoSo.status || '').toLowerCase().replace(/\s+/g, '_');
    await pushZohoLinesAndNotes(
      secrets,
      orgId,
      soId,
      lines,
      notes,
      status !== 'draft' && status !== 'pending',
    );
  } catch (err) {
    console.warn(
      `ensureFreightDiff: could not update SO ${soId} lines:`,
      err?.message || err,
    );
  }

  await reserveFreightDiffOnSalesOrder(db, {
    zohoCustomerId: customerId,
    salesOrderId: soId,
    salesOrderNumber: zohoSo.salesorder_number ? String(zohoSo.salesorder_number) : null,
    apply: {
      appliedInr: appliedResult.appliedInr,
      remainingAfter: appliedResult.remainingInr,
      baseFreightInr: appliedResult.baseFreightInr,
      remark,
      sourceBookingId: ledger.sourceBookingId,
    },
  });

  return {
    changed: true,
    appliedInr: appliedResult.appliedInr,
    remainingInr: appliedResult.remainingInr,
  };
}

/**
 * After invoice created for SO: settle the reserved applied slice.
 */
export async function settleFreightDiffOnInvoice(db, {
  salesOrderId,
  invoiceId = null,
  invoiceNumber = null,
  zohoCustomerId: zohoCustomerIdHint = null,
}) {
  const soId = String(salesOrderId || '').trim();
  if (!soId) return { settled: false };

  const soRef = db.collection('salesOrders').doc(soId);
  const soSnap = await soRef.get();
  const soData = soSnap.exists ? (soSnap.data() || {}) : {};
  const customerId = String(zohoCustomerIdHint || soData.customerId || '').trim();
  if (!customerId) return { settled: false };

  const ledgerRef = settlementRef(db, customerId);
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) return { settled: false };
  const ledger = ledgerSnap.data() || {};

  if (String(ledger.reservedSalesOrderId || '').trim() !== soId) {
    return { settled: false, reason: 'not_reserved_on_this_so' };
  }

  const applied = round2(Number(ledger.reservedAppliedInr) || 0);
  const remaining = round2(Number(ledger.remainingInr) || 0);
  const at = nowIso();
  const invId = invoiceId || soData.zohoInvoiceId || null;
  const invNo = invoiceNumber || soData.zohoInvoiceNumber || null;

  await ledgerRef.set({
    reservedSalesOrderId: null,
    reservedSalesOrderNumber: null,
    reservedAppliedInr: 0,
    reservedBaseFreightInr: null,
    reservedAt: null,
    settledSalesOrderId: soId,
    settledInvoiceId: invId,
    settledInvoiceNumber: invNo,
    settledAppliedInr: applied,
    settledAt: at,
    updatedAt: at,
  }, { merge: true });

  await soRef.set({
    yesOneFreightAdjustSettledAt: at,
    yesOneFreightAdjustSettledInvoiceId: invId,
    yesOneUpdatedAt: at,
  }, { merge: true });

  // Fully cleared source when nothing left pending.
  if (Math.abs(remaining) <= EPS && ledger.sourceBookingId) {
    try {
      await db.collection('logisticsBookings').doc(String(ledger.sourceBookingId)).set({
        freightDiffSettledAt: at,
        freightDiffSettledInvoiceId: invId,
        freightDiffSettledSalesOrderId: soId,
        updatedAt: at,
      }, { merge: true });
    } catch (err) {
      console.warn('Could not stamp logistics booking freight settle:', err?.message || err);
    }
  }

  return {
    settled: true,
    appliedInr: applied,
    remainingInr: remaining,
    invoiceId: invId,
  };
}

/**
 * Convenience: ensure then settle around invoice creation.
 */
export async function settleFreightDiffForInvoicedSalesOrder(db, {
  secrets,
  orgId,
  salesOrderId,
  invoiceId = null,
  invoiceNumber = null,
  zohoCustomerId = null,
}) {
  const soId = String(salesOrderId || '').trim();
  const soSnap = soId ? await db.collection('salesOrders').doc(soId).get() : null;
  const soData = soSnap?.exists ? (soSnap.data() || {}) : {};
  // Already settled on this SO — do not re-apply leftover remaining.
  if (soData.yesOneFreightAdjustSettledAt) {
    return { settled: false, reason: 'already_settled_on_so' };
  }

  const ensure = await ensureFreightDiffOnInvoicingSalesOrder(db, {
    secrets,
    orgId,
    salesOrderId,
    zohoCustomerId,
  });
  if (ensure?.reason === 'no_freight') {
    return { settled: false, reason: 'no_freight', ensure };
  }
  const settled = await settleFreightDiffOnInvoice(db, {
    salesOrderId,
    invoiceId,
    invoiceNumber,
    zohoCustomerId,
  });
  return { ...settled, ensure };
}
