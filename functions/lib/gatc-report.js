/**
 * Portal GATC stamping ledger keyed by Zoho invoice id.
 * Fee splits still come from salesOrders.yesOneGatcLines (not on Zoho invoice lines).
 */
import { getFirestore } from 'firebase-admin/firestore';

export const GATC_REPORTS = 'gatcReports';
const INVOICE_INDEX = 'invoiceIndex';
const SALES_ORDERS = 'salesOrders';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function todayYmd() {
  return nowIso().slice(0, 10);
}

function ymd(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

/**
 * Normalize portal line objects into durable yesOneGatcLines entries.
 * @param {object[]} lines
 */
export function toYesOneGatcLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(line => {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    const unitRate = round2(line.rate ?? line.unitRate);
    const gatcFeePerUnit = round2(line.gatcFeePerUnit);
    const baseRate = line.baseRate != null
      ? round2(line.baseRate)
      : round2(unitRate - gatcFeePerUnit);
    const gatcStampingPriceId = String(line.gatcStampingPriceId ?? '').trim() || null;
    const gatcStampingRange = String(line.gatcStampingRange ?? '').trim() || null;
    return {
      productId: String(line.productId ?? '').trim() || null,
      itemId: String(line.itemId ?? '').trim() || null,
      sku: line.sku != null ? String(line.sku) : null,
      name: String(line.name ?? 'Item'),
      quantity: qty,
      baseRate,
      gatcFeePerUnit,
      gatcStampingPriceId,
      gatcStampingRange,
      unitRate,
      hasStamping: Boolean(gatcStampingPriceId && gatcFeePerUnit > 0),
    };
  });
}

/** Fields to merge onto salesOrders/{id} (outside Zoho lineItems). */
export function yesOneGatcPersistFields(lines) {
  return {
    yesOneGatcLines: toYesOneGatcLines(lines),
    yesOneGatcUpdatedAt: nowIso(),
  };
}

function buildSearchBlob(header, lineItems) {
  const parts = [
    header.invoiceNumber,
    header.salesOrderNumber,
    header.customerName,
    header.customerId,
    header.referenceNumber,
    header.salespersonName,
    ...lineItems.flatMap(line => [
      line.sku,
      line.name,
      line.gatcStampingRange,
      line.gatcStampingPriceId,
    ]),
  ];
  return parts
    .map(v => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function mapGatcReportLineItems(rawLines) {
  return (Array.isArray(rawLines) ? rawLines : []).map(line => {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    const baseRate = round2(line.baseRate);
    const gatcFeePerUnit = round2(line.gatcFeePerUnit);
    const unitRate = line.unitRate != null
      ? round2(line.unitRate)
      : round2(baseRate + gatcFeePerUnit);
    const gatcStampingPriceId = String(line.gatcStampingPriceId ?? '').trim() || null;
    const gatcStampingRange = String(line.gatcStampingRange ?? '').trim() || null;
    const hasStamping = Boolean(
      line.hasStamping
      ?? (gatcStampingPriceId && gatcFeePerUnit > 0),
    );
    return {
      productId: String(line.productId ?? '').trim() || null,
      itemId: String(line.itemId ?? '').trim() || null,
      sku: line.sku != null ? String(line.sku) : null,
      name: String(line.name ?? 'Item'),
      qty,
      baseRate,
      gatcFeePerUnit,
      gatcStampingPriceId,
      gatcStampingRange,
      unitRate,
      lineBaseTotal: round2(baseRate * qty),
      lineGatcTotal: round2(gatcFeePerUnit * qty),
      lineTotal: round2(unitRate * qty),
      hasStamping,
    };
  });
}

/** Load mirrored invoice doc via invoiceIndex. */
export async function loadInvoiceDocById(invoiceId) {
  const invId = String(invoiceId || '').trim();
  if (!invId) return null;
  const db = getFirestore();
  const indexSnap = await db.doc(`${INVOICE_INDEX}/${invId}`).get();
  if (!indexSnap.exists) return null;
  const customerId = String(indexSnap.data()?.customerId || '').trim();
  if (!customerId) return null;
  const invSnap = await db.doc(`zohoCustomers/${customerId}/invoices/${invId}`).get();
  if (!invSnap.exists) return null;
  return { id: invSnap.id, ...(invSnap.data() || {}) };
}

/**
 * Write gatcReports/{invoiceId} using invoice header + SO yesOneGatcLines.
 * Skips when there are no stamped lines.
 */
export async function writeGatcReportForInvoice({
  invoice = null,
  invoiceId = null,
  invoiceNumber = null,
  soId = null,
  soData = {},
  source = 'invoice',
} = {}) {
  const invId = String(invoice?.id || invoiceId || '').trim();
  const salesOrderId = String(
    soId
    || invoice?.salesOrderId
    || soData.salesOrderId
    || '',
  ).trim();
  if (!invId) {
    console.warn('writeGatcReportForInvoice: missing invoiceId');
    return null;
  }

  const rawLines = soData.yesOneGatcLines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    console.warn(
      `writeGatcReportForInvoice: no yesOneGatcLines for invoice ${invId}`
      + (salesOrderId ? ` (SO ${salesOrderId})` : ''),
    );
    return null;
  }

  const lineItems = mapGatcReportLineItems(rawLines);
  const stamped = lineItems.filter(line => line.hasStamping);
  if (stamped.length === 0) {
    return null;
  }

  const totals = {
    lineCount: lineItems.length,
    stampedLineCount: stamped.length,
    stampedQty: stamped.reduce((sum, line) => sum + line.qty, 0),
    baseTotal: round2(lineItems.reduce((sum, line) => sum + line.lineBaseTotal, 0)),
    gatcFeeTotal: round2(lineItems.reduce((sum, line) => sum + line.lineGatcTotal, 0)),
    lineTotal: round2(lineItems.reduce((sum, line) => sum + line.lineTotal, 0)),
  };

  const header = {
    invoiceId: invId,
    invoiceNumber: invoice?.invoiceNumber != null
      ? String(invoice.invoiceNumber)
      : (invoiceNumber != null
        ? String(invoiceNumber)
        : (soData.zohoInvoiceNumber != null ? String(soData.zohoInvoiceNumber) : null)),
    soId: salesOrderId || null,
    salesOrderNumber: invoice?.salesOrderNumber != null
      ? String(invoice.salesOrderNumber)
      : (soData.salesOrderNumber != null ? String(soData.salesOrderNumber) : null),
    customerId: invoice?.customerId != null
      ? String(invoice.customerId)
      : (soData.customerId != null ? String(soData.customerId) : null),
    customerName: invoice?.customerName != null
      ? String(invoice.customerName)
      : (soData.customerName != null ? String(soData.customerName) : null),
    salespersonId: invoice?.salespersonId != null
      ? String(invoice.salespersonId)
      : (soData.salespersonId != null ? String(soData.salespersonId) : null),
    salespersonName: invoice?.salespersonName != null
      ? String(invoice.salespersonName)
      : (soData.salespersonName != null ? String(soData.salespersonName) : null),
    invoiceDate: ymd(invoice?.date) || ymd(soData.zohoInvoiceDate) || todayYmd(),
    soDate: ymd(soData.date) || ymd(invoice?.salesOrderDate) || null,
    referenceNumber: invoice?.referenceNumber != null
      ? String(invoice.referenceNumber)
      : (soData.referenceNumber != null ? String(soData.referenceNumber) : null),
    createdAt: nowIso(),
    source: String(source || 'invoice'),
    hasStamping: true,
    lineItems,
    totals,
  };

  header.searchBlob = buildSearchBlob(header, lineItems);

  await getFirestore().doc(`${GATC_REPORTS}/${invId}`).set(header, { merge: true });
  return header;
}

/**
 * Compatibility wrapper for payment-verify / manual mark paths.
 * Prefer invoice doc fields when available.
 */
export async function writeGatcReportFromSalesOrder({
  soId,
  soData = {},
  invoiceId,
  invoiceNumber = null,
  invoice = null,
  source = 'portal_verify',
} = {}) {
  let invoiceDoc = invoice;
  if (!invoiceDoc) {
    try {
      invoiceDoc = await loadInvoiceDocById(invoiceId);
    } catch (err) {
      console.warn(
        `writeGatcReportFromSalesOrder: could not load invoice ${invoiceId}:`,
        err?.message || err,
      );
    }
  }
  return writeGatcReportForInvoice({
    invoice: invoiceDoc,
    invoiceId,
    invoiceNumber,
    soId,
    soData,
    source,
  });
}

/**
 * After an invoice mirror upsert: join linked SO and index stamped GATC fees.
 */
export async function maybeWriteGatcReportAfterInvoiceUpsert(invoice) {
  const invId = String(invoice?.id || invoice?.invoiceId || '').trim();
  if (!invId) return null;
  const soId = String(invoice?.salesOrderId || '').trim();
  if (!soId) return null;

  const soSnap = await getFirestore().doc(`${SALES_ORDERS}/${soId}`).get();
  if (!soSnap.exists) return null;
  const soData = soSnap.data() || {};
  return writeGatcReportForInvoice({
    invoice: { id: invId, ...invoice },
    invoiceId: invId,
    soId,
    soData,
    source: 'invoice_sync',
  });
}

/**
 * Rebuild gatcReports from mirrored invoices (+ SO yesOneGatcLines).
 * Also removes legacy non-stamping report docs.
 */
export async function backfillGatcReportsFromInvoices({
  dryRun = false,
  pageSize = 200,
} = {}) {
  const db = getFirestore();
  const size = Math.max(50, Math.min(500, Number(pageSize) || 200));

  let scannedInvoices = 0;
  let wrote = 0;
  let skippedNoSo = 0;
  let skippedNoStamping = 0;
  let skippedMissingSo = 0;
  let deletedZero = 0;
  let errors = 0;

  // Drop legacy zero-fee rows.
  let zeroCursor = null;
  for (;;) {
    let q = db.collection(GATC_REPORTS).where('hasStamping', '==', false).limit(size);
    if (zeroCursor) q = q.startAfter(zeroCursor);
    const snap = await q.get();
    if (snap.empty) break;
    zeroCursor = snap.docs[snap.docs.length - 1];
    if (!dryRun) {
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    }
    deletedZero += snap.size;
    if (snap.size < size) break;
  }

  let lastInvoiceDoc = null;
  for (;;) {
    let q = db.collectionGroup('invoices').limit(size);
    if (lastInvoiceDoc) q = q.startAfter(lastInvoiceDoc);
    const snap = await q.get();
    if (snap.empty) break;
    lastInvoiceDoc = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      scannedInvoices += 1;
      const invoice = { id: doc.id, ...(doc.data() || {}) };
      const soId = String(invoice.salesOrderId || '').trim();
      if (!soId) {
        skippedNoSo += 1;
        continue;
      }
      try {
        const soSnap = await db.doc(`${SALES_ORDERS}/${soId}`).get();
        if (!soSnap.exists) {
          skippedMissingSo += 1;
          continue;
        }
        const soData = soSnap.data() || {};
        const lines = mapGatcReportLineItems(soData.yesOneGatcLines);
        if (!lines.some(line => line.hasStamping)) {
          skippedNoStamping += 1;
          continue;
        }
        if (!dryRun) {
          await writeGatcReportForInvoice({
            invoice,
            invoiceId: doc.id,
            soId,
            soData,
            source: 'backfill_invoice',
          });
        }
        wrote += 1;
      } catch (err) {
        errors += 1;
        console.warn(
          `backfillGatcReportsFromInvoices: invoice ${doc.id}:`,
          err?.message || err,
        );
      }
    }

    if (snap.size < size) break;
  }

  // Fallback: completed portal SOs with invoice id when invoice mirror lacks salesOrderId.
  const soSnap = await db.collection(SALES_ORDERS)
    .where('yesOneStage', '==', 'completed')
    .get();

  let soFallbackWrote = 0;
  for (const doc of soSnap.docs) {
    const soData = doc.data() || {};
    const invId = String(soData.zohoInvoiceId || '').trim();
    if (!invId) continue;
    const lines = mapGatcReportLineItems(soData.yesOneGatcLines);
    if (!lines.some(line => line.hasStamping)) continue;
    const existing = await db.doc(`${GATC_REPORTS}/${invId}`).get();
    if (existing.exists && existing.data()?.hasStamping) continue;
    try {
      const invoice = await loadInvoiceDocById(invId);
      if (!dryRun) {
        await writeGatcReportForInvoice({
          invoice,
          invoiceId: invId,
          invoiceNumber: soData.zohoInvoiceNumber || null,
          soId: doc.id,
          soData,
          source: invoice ? 'backfill_invoice' : 'backfill_so',
        });
      }
      soFallbackWrote += 1;
      wrote += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        `backfillGatcReportsFromInvoices: SO fallback ${doc.id}:`,
        err?.message || err,
      );
    }
  }

  return {
    dryRun: Boolean(dryRun),
    scannedInvoices,
    wrote,
    soFallbackWrote,
    skippedNoSo,
    skippedNoStamping,
    skippedMissingSo,
    deletedZero,
    errors,
  };
}
