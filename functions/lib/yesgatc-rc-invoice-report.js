/**
 * Sales invoices that warehouse pushed to YesGATC (serials + RC).
 */
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import {
  isFreightLineItem,
  isQuantityExcludedLineItem,
  INVOICE_CATEGORY_HSN,
  normalizeHsn,
} from './invoice-category.js';
import { invoiceDateKey } from './yesgatc-invoice-link.js';

const PAGE = 400;
const MAX_ROWS = 5000;

function str(value) {
  return value == null ? '' : String(value).trim();
}

function uniqueSerials(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = str(value);
    if (!text) continue;
    const key = text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function isVoidInvoice(data) {
  const status = str(data?.status).toLowerCase();
  return status === 'void' || status === 'voided' || data?.voided === true;
}

function isFreightLine(line) {
  return isFreightLineItem(line?.name, line?.sku, line?.hsn);
}

function isReportProductLine(line) {
  if (isQuantityExcludedLineItem(line?.name, line?.sku, line?.hsn)) return false;
  if (isFreightLine(line)) return false;
  const hsn = normalizeHsn(line?.hsn);
  if (INVOICE_CATEGORY_HSN.service.includes(hsn)) return false;
  if (INVOICE_CATEGORY_HSN.software_key.includes(hsn)) return false;
  return true;
}

function lineQuantity(line, serialCount) {
  const qty = Math.round(Number(line?.quantity) || 0);
  return Math.max(qty > 0 ? qty : 0, serialCount);
}

function mapInvoiceLines(data) {
  const lines = (Array.isArray(data?.lineItems) ? data.lineItems : [])
    .filter(line => isReportProductLine(line))
    .map(line => {
      const serialNumbers = uniqueSerials(line?.serialNumbers);
      return {
        id: str(line?.id),
        itemId: str(line?.itemId) || null,
        name: str(line?.name) || 'Item',
        sku: str(line?.sku) || null,
        description: str(line?.description) || '',
        imageUrl: str(line?.imageUrl) || null,
        quantity: lineQuantity(line, serialNumbers.length),
        serialNumbers,
        max: str(line?.max) || '',
        e: str(line?.e) || '',
        certificateNumbers: [],
      };
    });
  const leftover = uniqueSerials([
    ...(Array.isArray(data?.gatcStampedAllocatedSerials) ? data.gatcStampedAllocatedSerials : []),
    ...(Array.isArray(data?.nonGatcAllocatedSerials) ? data.nonGatcAllocatedSerials : []),
  ]).filter(serial => !lines.some(line => line.serialNumbers.includes(serial)));
  if (leftover.length) {
    lines.push({
      id: 'allocated',
      itemId: null,
      name: 'Serials',
      sku: null,
      description: '',
      imageUrl: null,
      quantity: leftover.length,
      serialNumbers: leftover,
      max: '',
      e: '',
      certificateNumbers: [],
    });
  }
  return lines.filter(line => line.serialNumbers.length || line.itemId || line.quantity);
}

function mapReportRow(doc) {
  const data = doc.data() || {};
  if (!str(data.yesgatcRcPushedAt) && !str(data.yesgatcRcCode)) return null;
  if (isVoidInvoice(data)) return null;
  const lines = mapInvoiceLines(data);
  if (!lines.length) return null;
  const serialNumbers = uniqueSerials(lines.flatMap(line => line.serialNumbers));
  const customerId = str(data.customerId) || str(doc.ref.parent.parent?.id);
  return {
    id: doc.id,
    customerId,
    invoiceNumber: str(data.invoiceNumber) || doc.id,
    invoiceDate: invoiceDateKey(data.date || data.invoiceDate) || null,
    customerName: str(data.customerName) || null,
    rcCode: str(data.yesgatcRcCode).toUpperCase() || null,
    rcName: str(data.yesgatcRcName) || null,
    serialNumbers,
    serialCount: serialNumbers.length,
    pushedAt: str(data.yesgatcRcPushedAt) || null,
    lines,
  };
}

async function getAllDocs(db, refs) {
  const out = [];
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    out.push(...snaps);
  }
  return out;
}

async function attachCatalogImages(db, rows) {
  const ids = [...new Set(rows.flatMap(row => row.lines.map(line => line.itemId).filter(Boolean)))];
  if (!ids.length) return;
  const snaps = await getAllDocs(db, ids.map(id => db.collection('catalogProducts').doc(id)));
  const images = new Map();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const url = str(data.imageUrl)
      || (Array.isArray(data.imageUrls) ? str(data.imageUrls[0]) : '');
    if (url) images.set(snap.id, url);
  }
  for (const row of rows) {
    for (const line of row.lines) {
      if (!line.imageUrl && line.itemId) line.imageUrl = images.get(line.itemId) || null;
    }
  }
}

async function attachCertificateSpecs(db, rows) {
  const { serialLinkDocId, YESGATC_SERIAL_LINKS } = await import('./yesgatc-invoice-link.js');
  const serials = [...new Set(rows.flatMap(row => row.lines.flatMap(line => line.serialNumbers)))];
  if (!serials.length) return;
  const linkRefs = [];
  const linkSerials = [];
  for (const serial of serials) {
    const id = serialLinkDocId(serial);
    if (!id) continue;
    linkRefs.push(db.collection(YESGATC_SERIAL_LINKS).doc(id));
    linkSerials.push(serial);
  }
  const certIdBySerial = new Map();
  const linkSnaps = await getAllDocs(db, linkRefs);
  linkSnaps.forEach((snap, index) => {
    const certId = str(snap.data()?.certificateId);
    if (certId) certIdBySerial.set(linkSerials[index].toUpperCase(), certId);
  });
  const certIds = [...new Set(certIdBySerial.values())];
  if (!certIds.length) return;
  const certSnaps = await getAllDocs(
    db,
    certIds.map(id => db.collection('yesgatcCertificates').doc(id)),
  );
  const certById = new Map();
  for (const snap of certSnaps) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    certById.set(snap.id, {
      max: str(data.max),
      e: str(data.e),
      certificateNumber: str(data.certificateNumber),
    });
  }
  for (const row of rows) {
    for (const line of row.lines) {
      const specs = line.serialNumbers
        .map(serial => certById.get(certIdBySerial.get(serial.toUpperCase()) || ''))
        .filter(Boolean);
      if (!line.max) line.max = specs.find(item => item.max)?.max || '';
      if (!line.e) line.e = specs.find(item => item.e)?.e || '';
      line.certificateNumbers = [...new Set(
        specs.map(item => item.certificateNumber).filter(Boolean),
      )];
    }
  }
}

async function forEachPaged(startQuery, onDocs) {
  let last = null;
  for (;;) {
    let q = startQuery.limit(PAGE);
    if (last) q = startQuery.startAfter(last).limit(PAGE);
    const snap = await q.get();
    if (snap.empty) break;
    const stop = onDocs(snap.docs);
    if (stop || snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
}

function inDateWindow(date, dateStart, dateEnd) {
  if (!date) return !dateStart && !dateEnd;
  if (dateStart && date < dateStart) return false;
  if (dateEnd && date > dateEnd) return false;
  return true;
}

export async function listYesGatcRcInvoiceReport({
  rcCode = '',
  dateStart = '',
  dateEnd = '',
  max = MAX_ROWS,
} = {}) {
  const cap = Math.min(MAX_ROWS, Math.max(1, Number(max) || MAX_ROWS));
  const wantedRc = str(rcCode).toUpperCase();
  const start = str(dateStart).slice(0, 10);
  const end = str(dateEnd).slice(0, 10);
  const db = getFirestore();
  const col = db.collectionGroup('invoices');
  const rows = [];
  const seen = new Set();

  const take = docs => {
    for (const doc of docs) {
      if (rows.length >= cap) return true;
      if (seen.has(doc.id)) continue;
      const row = mapReportRow(doc);
      if (!row) continue;
      if (wantedRc && row.rcCode !== wantedRc) continue;
      if (!inDateWindow(row.invoiceDate || '', start, end)) continue;
      seen.add(doc.id);
      rows.push(row);
    }
    return rows.length >= cap;
  };

  try {
    if (wantedRc) {
      await forEachPaged(col.where('yesgatcRcCode', '==', wantedRc), take);
    } else {
      await forEachPaged(
        col.where('yesgatcRcPushedAt', '!=', '').orderBy('yesgatcRcPushedAt'),
        take,
      );
    }
  } catch (err) {
    console.warn('YesGATC RC invoice report indexed query failed, scanning:', err?.message ?? err);
    try {
      await forEachPaged(col.orderBy(FieldPath.documentId()), take);
    } catch {
      await forEachPaged(col, take);
    }
  }

  rows.sort((a, b) => {
    const dateCmp = String(b.invoiceDate || '').localeCompare(String(a.invoiceDate || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.invoiceNumber).localeCompare(String(b.invoiceNumber), 'en');
  });

  await attachCatalogImages(db, rows);
  await attachCertificateSpecs(db, rows);

  return {
    ok: true,
    rcCode: wantedRc || null,
    dateStart: start || null,
    dateEnd: end || null,
    truncated: rows.length >= cap,
    rows,
  };
}
