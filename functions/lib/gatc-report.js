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
 * When salesOrderId is missing (org sync), resolve portal SO by zohoInvoiceId.
 */
export async function maybeWriteGatcReportAfterInvoiceUpsert(invoice) {
  const invId = String(invoice?.id || invoice?.invoiceId || '').trim();
  if (!invId) return null;

  const db = getFirestore();
  let soId = String(invoice?.salesOrderId || '').trim();
  let soData = null;

  if (soId) {
    const soSnap = await db.doc(`${SALES_ORDERS}/${soId}`).get();
    if (soSnap.exists) soData = soSnap.data() || {};
  }

  if (!soData) {
    const byInv = await db.collection(SALES_ORDERS)
      .where('zohoInvoiceId', '==', invId)
      .limit(1)
      .get();
    if (byInv.empty) return null;
    soId = byInv.docs[0].id;
    soData = byInv.docs[0].data() || {};
  }

  return writeGatcReportForInvoice({
    invoice: { id: invId, ...invoice },
    invoiceId: invId,
    soId,
    soData,
    source: 'invoice_sync',
  });
}

/**
 * Rebuild gatcReports from portal SOs that already have a Zoho invoice id
 * (+ refresh header from mirrored invoice when present).
 *
 * Note: most org-synced invoices have salesOrderId=null, so scanning invoices
 * alone rarely finds stamping. Portal SOs with zohoInvoiceId are the source of truth.
 */
export async function backfillGatcReportsFromInvoices({
  dryRun = false,
  pageSize = 200,
} = {}) {
  const db = getFirestore();
  const size = Math.max(50, Math.min(500, Number(pageSize) || 200));

  let scannedSalesOrders = 0;
  let scannedInvoices = 0;
  let wrote = 0;
  let soIndexed = 0;
  let invoiceJoinIndexed = 0;
  let skippedNoInvoice = 0;
  let skippedNoStamping = 0;
  let skippedNoSo = 0;
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

  /** @type {Map<string, { soId: string, soData: object }>} */
  const stampedByInvoiceId = new Map();

  // Primary: portal sales orders that were invoiced with stamping meta.
  let lastSoDoc = null;
  for (;;) {
    let q = db.collection(SALES_ORDERS).limit(size);
    if (lastSoDoc) q = q.startAfter(lastSoDoc);
    const snap = await q.get();
    if (snap.empty) break;
    lastSoDoc = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      scannedSalesOrders += 1;
      const soData = doc.data() || {};
      const invId = String(soData.zohoInvoiceId || '').trim();
      if (!invId) {
        skippedNoInvoice += 1;
        continue;
      }
      const lines = mapGatcReportLineItems(soData.yesOneGatcLines);
      if (!lines.some(line => line.hasStamping)) {
        skippedNoStamping += 1;
        continue;
      }
      stampedByInvoiceId.set(invId, { soId: doc.id, soData });
    }
    if (snap.size < size) break;
  }

  for (const [invId, { soId, soData }] of stampedByInvoiceId) {
    try {
      const invoice = await loadInvoiceDocById(invId);
      if (!dryRun) {
        await writeGatcReportForInvoice({
          invoice,
          invoiceId: invId,
          invoiceNumber: soData.zohoInvoiceNumber || invoice?.invoiceNumber || null,
          soId,
          soData,
          source: invoice ? 'backfill_invoice' : 'backfill_so',
        });
      }
      soIndexed += 1;
      wrote += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        `backfillGatcReportsFromInvoices: SO ${soId} → invoice ${invId}:`,
        err?.message || err,
      );
    }
  }

  // Secondary: invoices that still carry salesOrderId (webhook / non-skip sync).
  let lastInvoiceDoc = null;
  for (;;) {
    let q = db.collectionGroup('invoices').limit(size);
    if (lastInvoiceDoc) q = q.startAfter(lastInvoiceDoc);
    const snap = await q.get();
    if (snap.empty) break;
    lastInvoiceDoc = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      scannedInvoices += 1;
      if (stampedByInvoiceId.has(doc.id)) continue;
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
        invoiceJoinIndexed += 1;
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

  return {
    dryRun: Boolean(dryRun),
    scannedSalesOrders,
    scannedInvoices,
    wrote,
    soIndexed,
    invoiceJoinIndexed,
    soFallbackWrote: soIndexed,
    skippedNoInvoice,
    skippedNoSo,
    skippedNoStamping,
    skippedMissingSo,
    deletedZero,
    errors,
  };
}
