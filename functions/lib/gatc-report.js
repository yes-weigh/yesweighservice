/**
 * Portal GATC stamping ledger: persist line meta on SOs and write
 * gatcReports/{invoiceId} when payment verification creates an invoice.
 */
import { getFirestore } from 'firebase-admin/firestore';

export const GATC_REPORTS = 'gatcReports';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function todayYmd() {
  return nowIso().slice(0, 10);
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

/**
 * Write gatcReports/{invoiceId} from SO portal meta.
 * Skips (with warning) when yesOneGatcLines is missing (legacy SOs).
 */
export async function writeGatcReportFromSalesOrder({
  soId,
  soData = {},
  invoiceId,
  invoiceNumber = null,
} = {}) {
  const invId = String(invoiceId || '').trim();
  const salesOrderId = String(soId || '').trim();
  if (!invId || !salesOrderId) {
    console.warn('writeGatcReportFromSalesOrder: missing invoiceId or soId');
    return null;
  }

  const rawLines = soData.yesOneGatcLines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    console.warn(
      `writeGatcReportFromSalesOrder: SO ${salesOrderId} has no yesOneGatcLines; skipping gatcReports/${invId}`,
    );
    return null;
  }

  const lineItems = rawLines.map(line => {
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

  const stamped = lineItems.filter(line => line.hasStamping);
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
    invoiceNumber: invoiceNumber != null ? String(invoiceNumber) : (soData.zohoInvoiceNumber ?? null),
    soId: salesOrderId,
    salesOrderNumber: soData.salesOrderNumber != null ? String(soData.salesOrderNumber) : null,
    customerId: soData.customerId != null ? String(soData.customerId) : null,
    customerName: soData.customerName != null ? String(soData.customerName) : null,
    salespersonId: soData.salespersonId != null ? String(soData.salespersonId) : null,
    salespersonName: soData.salespersonName != null ? String(soData.salespersonName) : null,
    invoiceDate: todayYmd(),
    soDate: soData.date != null ? String(soData.date).slice(0, 10) : null,
    referenceNumber: soData.referenceNumber != null ? String(soData.referenceNumber) : null,
    createdAt: nowIso(),
    source: 'portal_verify',
    hasStamping: totals.stampedLineCount > 0,
    lineItems,
    totals,
  };

  header.searchBlob = buildSearchBlob(header, lineItems);

  await getFirestore().doc(`${GATC_REPORTS}/${invId}`).set(header, { merge: true });
  return header;
}
