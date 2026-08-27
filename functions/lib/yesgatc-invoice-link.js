/**
 * Link YesGATC certificates to invoices by machine serial number.
 * Prefers the Serial Number workbook, then scanned invoice / sales-order text.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { authHeaders, getAccessToken, resolveOrganizationId, ZOHO_API_BASE } from './zoho.js';

const YESGATC_CERTIFICATES = 'yesgatcCertificates';

export const YESGATC_SERIAL_LINKS = 'yesgatcSerialLinks';
/** Inclusive lower bound. User asked for invoices after 7-04; FY 26-27 starts Apr 2026. */
export const YESGATC_INVOICE_MIN_DATE = '2026-04-07';

const MAX_BATCH = 400;
const PAGE = 400;

/** Case-insensitive; drops spaces and punctuation (Y 10 310 → Y10310). */
export function normalizeSerial(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function serialLinkDocId(serial) {
  const key = normalizeSerial(serial);
  return key ? key.replace(/[/\\]+/g, '_').slice(0, 700) : '';
}

function normalizeInvoiceNumber(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

let excelSerialInvoiceMap;
export function loadExcelSerialInvoiceMap() {
  if (excelSerialInvoiceMap) return excelSerialInvoiceMap;
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../data/yesgatc-serial-invoices.json');
    excelSerialInvoiceMap = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    excelSerialInvoiceMap = {};
  }
  return excelSerialInvoiceMap;
}

export function excelLinkForSerial(serial) {
  const key = normalizeSerial(serial);
  const row = key ? loadExcelSerialInvoiceMap()[key] : null;
  if (!row?.invoiceNumber) return null;
  return {
    serial: row.serial || key,
    invoiceId: row.invoiceId ?? null,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate ?? null,
    invoiceCustomerId: row.invoiceCustomerId ?? null,
    dealerName: row.dealerName ?? null,
  };
}

export function invoiceDateKey(value) {
  if (value == null || value === '') return '';
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

export function invoiceOnOrAfter(date, minDate = YESGATC_INVOICE_MIN_DATE) {
  const key = invoiceDateKey(date);
  if (!key) return true;
  return key >= minDate;
}

/** Y10111, y 10310, Y-10-310, YZ 00317 */
const YESWEIGH_SERIAL = /(?:^|[^A-Z0-9])(Y[A-Z]?(?:[^A-Z0-9]*\d){3,})/gi;
const SERIAL_LABEL_LIST = /(?:serial(?:\s*no\.?s?|\s*numbers?)?|s\/n|s\.n\.|sn)\s*[:#-]?\s*([^\n]+)/gi;

function isMachineSerialKey(key) {
  return /^Y[A-Z]?\d{3,}$/.test(key);
}

function pushSerial(into, raw) {
  const key = normalizeSerial(raw);
  if (isMachineSerialKey(key)) {
    into.add(key);
    return;
  }
  const text = String(raw ?? '');
  if (!text) return;
  YESWEIGH_SERIAL.lastIndex = 0;
  let match = YESWEIGH_SERIAL.exec(text);
  while (match) {
    const nested = normalizeSerial(match[1] || match[0]);
    if (isMachineSerialKey(nested)) into.add(nested);
    match = YESWEIGH_SERIAL.exec(text);
  }
}

function extractSerialsFromText(text, into) {
  const str = String(text ?? '');
  if (!str) return;
  YESWEIGH_SERIAL.lastIndex = 0;
  let match = YESWEIGH_SERIAL.exec(str);
  while (match) {
    pushSerial(into, match[1] || match[0]);
    match = YESWEIGH_SERIAL.exec(str);
  }
  SERIAL_LABEL_LIST.lastIndex = 0;
  match = SERIAL_LABEL_LIST.exec(str);
  while (match) {
    for (const part of String(match[1] ?? '').split(/[,;|]+/)) pushSerial(into, part);
    match = SERIAL_LABEL_LIST.exec(str);
  }
}

function walkUnknownForSerials(value, into, depth = 0) {
  if (value == null || depth > 6) return;
  if (typeof value === 'string') {
    extractSerialsFromText(value, into);
    pushSerial(into, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 400)) walkUnknownForSerials(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const name = key.toLowerCase();
      if (name.includes('pdf') || name.includes('url') || name === 'raw') continue;
      walkUnknownForSerials(nested, into, depth + 1);
    }
  }
}

export function serialsFromInvoiceData(data) {
  const found = new Set();
  if (!data || typeof data !== 'object') return [];
  walkUnknownForSerials(data.searchBlob, found);
  walkUnknownForSerials(data.notes, found);
  walkUnknownForSerials(data.referenceNumber, found);
  walkUnknownForSerials(data.lineItems ?? data.line_items, found);
  walkUnknownForSerials(data.custom_fields ?? data.customFields, found);
  walkUnknownForSerials(data.description, found);
  return [...found];
}

function customerIdFromInvoiceDoc(doc) {
  const data = doc.data() || {};
  if (data.customerId) return String(data.customerId);
  const parts = doc.ref.path.split('/');
  const index = parts.indexOf('zohoCustomers');
  return index >= 0 ? String(parts[index + 1] || '') : '';
}

function preferNewer(current, next) {
  if (!current) return next;
  const a = invoiceDateKey(current.invoiceDate);
  const b = invoiceDateKey(next.invoiceDate);
  if (b && (!a || b > a)) return next;
  return current;
}

export const YESGATC_MANUAL_INVOICE_MIN_DATE = '2026-04-05';

export async function manualLinkYesGatcCertificateInvoice({
  certificateId,
  serialNumber,
  invoiceId,
  invoiceNumber,
  invoiceDate,
  invoiceCustomerId,
} = {}) {
  const certId = String(certificateId ?? '').trim();
  const number = String(invoiceNumber ?? '').trim();
  if (!certId) throw new Error('Certificate is required.');
  if (!number) throw new Error('Invoice number is required.');
  const dateKey = invoiceDateKey(invoiceDate);
  if (!dateKey || dateKey < YESGATC_MANUAL_INVOICE_MIN_DATE) {
    throw new Error('Choose an invoice dated on or after 5 Apr 2026.');
  }

  const snap = await getFirestore().collection(YESGATC_CERTIFICATES).doc(certId).get();
  if (!snap.exists) throw new Error('Certificate not found.');
  const cert = snap.data() || {};
  const serial = String(serialNumber || cert.serialNumber || '').trim();
  const link = {
    invoiceId: invoiceId ? String(invoiceId) : null,
    invoiceNumber: number,
    invoiceDate: invoiceDateKey(invoiceDate) || null,
    invoiceCustomerId: invoiceCustomerId ? String(invoiceCustomerId) : null,
  };

  const writes = [{
    path: `${YESGATC_CERTIFICATES}/${certId}`,
    data: {
      serialKey: normalizeSerial(serial),
      ...invoiceFieldsFromLink(link),
    },
  }];
  if (serial) {
    writes.push({
      path: `${YESGATC_SERIAL_LINKS}/${serialLinkDocId(serial)}`,
      data: {
        serialNumber: serial,
        serialKey: normalizeSerial(serial),
        ...link,
        certificateId: certId,
        certificateNumber: String(cert.certificateNumber ?? ''),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }
  if (link.invoiceCustomerId && link.invoiceId) {
    writes.push(await mergeInvoiceGatcLinks(
      `zohoCustomers/${link.invoiceCustomerId}/invoices/${link.invoiceId}`,
      [{
        certificateId: certId,
        certificateNumber: String(cert.certificateNumber ?? ''),
        serialNumber: serial,
      }],
    ));
  }
  await commitChunks(writes);
  return { ok: true, ...link };
}

export function invoiceFieldsFromLink(link) {
  if (!link?.invoiceNumber) return {};
  return {
    invoiceId: link.invoiceId != null ? String(link.invoiceId) : null,
    invoiceNumber: String(link.invoiceNumber),
    invoiceDate: link.invoiceDate != null ? String(link.invoiceDate) : null,
    invoiceCustomerId: link.invoiceCustomerId != null ? String(link.invoiceCustomerId) : null,
    invoiceLinkedAt: FieldValue.serverTimestamp(),
  };
}

function coalesceWrites(writes) {
  const merged = new Map();
  for (const row of writes) {
    const prev = merged.get(row.path);
    merged.set(row.path, prev ? { path: row.path, data: { ...prev.data, ...row.data } } : row);
  }
  return [...merged.values()];
}

async function commitChunks(writes) {
  const db = getFirestore();
  const unique = coalesceWrites(writes);
  let written = 0;
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const chunk = unique.slice(i, i + MAX_BATCH);
    const batch = db.batch();
    for (const row of chunk) {
      batch.set(db.doc(row.path), row.data, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

async function paginateQuery(queryBase, pageSize = PAGE) {
  const docs = [];
  let last = null;
  for (;;) {
    let q = queryBase.limit(pageSize);
    if (last) q = queryBase.startAfter(last).limit(pageSize);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    if (snap.size < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}

async function forEachPaged(startQuery, onDocs) {
  let last = null;
  for (;;) {
    let q = startQuery.limit(PAGE);
    if (last) q = startQuery.startAfter(last).limit(PAGE);
    const snap = await q.get();
    if (snap.empty) break;
    onDocs(snap.docs);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
}

async function forEachInvoicePage(onDocs) {
  const db = getFirestore();
  try {
    await forEachPaged(db.collectionGroup('invoices').orderBy(FieldPath.documentId()), onDocs);
  } catch {
    await forEachPaged(db.collectionGroup('invoices'), onDocs);
  }
}

async function forEachInvoiceSummaryPage(onDocs) {
  const db = getFirestore();
  try {
    await forEachPaged(db.collectionGroup('invoiceSummaries').orderBy(FieldPath.documentId()), onDocs);
  } catch {
    await forEachPaged(db.collectionGroup('invoiceSummaries'), onDocs);
  }
}

async function forEachSalesOrderPage(onDocs) {
  const db = getFirestore();
  try {
    await forEachPaged(db.collection('salesOrders').orderBy(FieldPath.documentId()), onDocs);
  } catch {
    await forEachPaged(db.collection('salesOrders'), onDocs);
  }
}

function invoiceHaystack(data) {
  const parts = [];
  const visit = (value, depth = 0) => {
    if (value == null || depth > 8) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 400)) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') return;
      for (const [key, nested] of Object.entries(value)) {
        const name = key.toLowerCase();
        if (name.includes('pdf') || name.includes('url') || name === 'raw') continue;
        visit(nested, depth + 1);
      }
    }
  };
  visit(data);
  return normalizeSerial(parts.join(' '));
}

export async function lookupSerialLinks(serials) {
  const db = getFirestore();
  const ids = [...new Set(serials.map(serialLinkDocId).filter(Boolean))];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map(id => db.collection(YESGATC_SERIAL_LINKS).doc(id));
    if (!refs.length) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      found.set(snap.id, { id: snap.id, ...snap.data() });
    }
  }
  const excel = loadExcelSerialInvoiceMap();
  for (const serial of serials) {
    const key = serialLinkDocId(serial);
    if (!key || found.has(key)) continue;
    const row = excel[key];
    if (row?.invoiceNumber) found.set(key, { id: key, ...row });
  }
  return found;
}

export async function lookupSerialLink(serial) {
  const key = serialLinkDocId(serial);
  if (!key) return null;
  const map = await lookupSerialLinks([serial]);
  return map.get(key) ?? null;
}

async function findCertificatesForSerial(serial) {
  const db = getFirestore();
  const key = normalizeSerial(serial);
  if (!key) return [];
  const seen = new Map();
  const queries = [
    db.collection(YESGATC_CERTIFICATES).where('serialKey', '==', key).get(),
    db.collection(YESGATC_CERTIFICATES).where('serialNumber', '==', serial).get(),
    db.collection(YESGATC_CERTIFICATES).where('serialNumber', '==', key).get(),
  ];
  const upper = String(serial).trim().toUpperCase();
  if (upper && upper !== serial && upper !== key) {
    queries.push(db.collection(YESGATC_CERTIFICATES).where('serialNumber', '==', upper).get());
  }
  const snaps = await Promise.all(queries.map(q => q.catch(() => null)));
  for (const snap of snaps) {
    if (!snap) continue;
    for (const doc of snap.docs) {
      if (!seen.has(doc.id)) seen.set(doc.id, doc);
    }
  }
  return [...seen.values()];
}

function invoiceLinkPayload(invoice) {
  return {
    invoiceId: String(invoice.invoiceId || invoice.id || ''),
    invoiceNumber: String(invoice.invoiceNumber || ''),
    invoiceDate: invoiceDateKey(invoice.date) || null,
    invoiceCustomerId: invoice.customerId != null ? String(invoice.customerId) : null,
  };
}

async function writeSerialLinksForInvoice(invoice, serials, certBySerial = new Map()) {
  const writes = [];
  const payload = invoiceLinkPayload(invoice);
  if (!payload.invoiceId || !payload.invoiceNumber) return writes;
  for (const serial of serials) {
    const id = serialLinkDocId(serial);
    if (!id) continue;
    const cert = certBySerial.get(normalizeSerial(serial));
    writes.push({
      path: `${YESGATC_SERIAL_LINKS}/${id}`,
      data: {
        serialNumber: serial,
        serialKey: id,
        ...payload,
        ...(cert
          ? { certificateId: cert.id, certificateNumber: cert.certificateNumber || '' }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }
  return writes;
}

/**
 * After an invoice upsert: index its serials and stamp matching certificates.
 */
export async function syncYesGatcLinksAfterInvoiceUpsert(invoice) {
  if (!invoiceOnOrAfter(invoice?.date)) return { skipped: true, reason: 'before-min-date' };
  const serials = serialsFromInvoiceData(invoice);
  if (!serials.length) return { skipped: true, reason: 'no-serials' };

  const payload = invoiceLinkPayload(invoice);
  if (!payload.invoiceId || !payload.invoiceNumber) {
    return { skipped: true, reason: 'missing-invoice-number' };
  }

  const certBySerial = new Map();
  const certLinks = [];
  for (const serial of serials) {
    const docs = await findCertificatesForSerial(serial);
    for (const doc of docs) {
      const data = doc.data() || {};
      const row = {
        id: doc.id,
        certificateNumber: String(data.certificateNumber ?? ''),
        serialNumber: String(data.serialNumber ?? serial),
      };
      certBySerial.set(normalizeSerial(serial), row);
      certLinks.push(row);
    }
  }

  const writes = await writeSerialLinksForInvoice(invoice, serials, certBySerial);
  for (const cert of certLinks) {
    writes.push({
      path: `${YESGATC_CERTIFICATES}/${cert.id}`,
      data: {
        serialKey: normalizeSerial(cert.serialNumber),
        ...invoiceFieldsFromLink(payload),
      },
    });
  }
  if (certLinks.length && payload.invoiceCustomerId) {
    writes.push(await mergeInvoiceGatcLinks(
      `zohoCustomers/${payload.invoiceCustomerId}/invoices/${payload.invoiceId}`,
      certLinks.map(row => ({
        certificateId: row.id,
        certificateNumber: row.certificateNumber,
        serialNumber: row.serialNumber,
      })),
    ));
  }

  const written = writes.length ? await commitChunks(writes) : 0;
  return { skipped: false, serials: serials.length, certificates: certLinks.length, written };
}

/**
 * After a certificate ingest: attach invoice fields from the serial index
 * and stamp the invoice with the certificate id.
 */
export async function attachInvoiceFieldsToCertificateWrites(writes) {
  const certWrites = writes.filter(row => row.path.startsWith(`${YESGATC_CERTIFICATES}/`));
  if (!certWrites.length) return writes;

  const serials = certWrites
    .map(row => row.data?.serialNumber)
    .filter(Boolean);
  const links = await lookupSerialLinks(serials);
  const invoicePatches = new Map();

  for (const row of certWrites) {
    const serial = row.data?.serialNumber;
    const key = serialLinkDocId(serial);
    if (key) row.data.serialKey = key;
    const link = key ? links.get(key) : null;
    if (!link?.invoiceNumber) continue;
    Object.assign(row.data, invoiceFieldsFromLink(link));
    const customerId = link.invoiceCustomerId;
    if (!customerId) continue;
    const invoicePath = `zohoCustomers/${customerId}/invoices/${link.invoiceId}`;
    const current = invoicePatches.get(invoicePath) || [];
    current.push({
      certificateId: row.path.split('/')[1],
      certificateNumber: String(row.data.certificateNumber ?? ''),
      serialNumber: String(serial ?? ''),
    });
    invoicePatches.set(invoicePath, current);
  }

  const extra = [];
  for (const [path, certs] of invoicePatches) {
    extra.push(await mergeInvoiceGatcLinks(path, certs));
  }
  return extra.length ? [...writes, ...extra] : writes;
}

async function mergeInvoiceGatcLinks(path, certs) {
  const snap = await getFirestore().doc(path).get();
  const existing = Array.isArray(snap.data()?.yesgatcLinks) ? snap.data().yesgatcLinks : [];
  const map = new Map(
    existing
      .filter(row => row && row.certificateId)
      .map(row => [String(row.certificateId), row]),
  );
  for (const row of certs) {
    if (row?.certificateId) map.set(String(row.certificateId), row);
  }
  return {
    path,
    data: {
      yesgatcLinks: [...map.values()],
      yesgatcLinkedAt: FieldValue.serverTimestamp(),
    },
  };
}

async function zohoGetJson(accessToken, orgId, path, params = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  url.searchParams.set('organization_id', orgId);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok || (payload?.code != null && payload.code !== 0)) return null;
  return payload;
}

function linkFromZohoInvoice(raw, serial) {
  if (!raw) return null;
  const haystack = invoiceHaystack(raw);
  const key = normalizeSerial(serial);
  const extracted = serialsFromInvoiceData({
    ...raw,
    lineItems: raw.line_items ?? raw.lineItems,
    searchBlob: haystack,
  });
  if (!extracted.includes(key) && !haystack.includes(key)) return null;
  return {
    serial: key,
    invoiceId: String(raw.invoice_id ?? raw.id ?? ''),
    invoiceNumber: String(raw.invoice_number ?? raw.invoiceNumber ?? ''),
    invoiceDate: invoiceDateKey(raw.date) || null,
    invoiceCustomerId: raw.customer_id != null ? String(raw.customer_id) : null,
  };
}

async function findZohoInvoiceForSerial(accessToken, orgId, serial) {
  const queries = [...new Set([
    normalizeSerial(serial),
    String(serial).trim(),
  ])].filter(Boolean);
  for (const q of queries) {
    const payload = await zohoGetJson(accessToken, orgId, '/invoices', {
      search_text: q,
      per_page: '15',
    });
    for (const summary of payload?.invoices ?? []) {
      const id = summary.invoice_id ?? summary.id;
      if (!id) continue;
      const detail = await zohoGetJson(accessToken, orgId, `/invoices/${id}`);
      const link = linkFromZohoInvoice(detail?.invoice ?? summary, serial);
      if (link?.invoiceNumber) return link;
    }
    const soPayload = await zohoGetJson(accessToken, orgId, '/salesorders', {
      search_text: q,
      per_page: '10',
    });
    for (const so of soPayload?.salesorders ?? []) {
      const invoiceNumber = so.invoice_number || '';
      const soId = so.salesorder_id ?? so.id;
      const soDetail = soId ? await zohoGetJson(accessToken, orgId, `/salesorders/${soId}`) : null;
      const raw = soDetail?.salesorder ?? so;
      const haystack = invoiceHaystack(raw);
      const key = normalizeSerial(serial);
      if (!haystack.includes(key) && !serialsFromInvoiceData({
        ...raw,
        lineItems: raw.line_items ?? raw.lineItems,
      }).includes(key)) continue;
      const number = String(raw.invoice_number ?? raw.zohoInvoiceNumber ?? invoiceNumber ?? '').trim();
      if (!number) continue;
      return {
        serial: key,
        invoiceId: String(raw.invoice_id ?? raw.invoices?.[0]?.invoice_id ?? ''),
        invoiceNumber: number,
        invoiceDate: invoiceDateKey(raw.date) || null,
        invoiceCustomerId: raw.customer_id != null ? String(raw.customer_id) : null,
      };
    }
  }
  return null;
}

/**
 * One-shot: Excel map + invoice/SO scan, then Zoho search for leftovers.
 */
export async function linkYesGatcCertificatesToInvoices({
  minDate = YESGATC_INVOICE_MIN_DATE,
  zoho = null,
} = {}) {
  const db = getFirestore();
  const serialToInvoice = new Map();
  const invoiceByNumber = new Map();
  const haystacks = [];
  let invoicesScanned = 0;
  let invoicesWithSerials = 0;

  const indexRecord = (data, invoice, customerId) => {
    if (minDate && !invoiceOnOrAfter(invoice.date ?? data.date, minDate)) return;
    const payloadBase = invoiceLinkPayload({
      invoiceId: invoice.invoiceId || data.id,
      invoiceNumber: invoice.invoiceNumber || data.invoiceNumber || data.zohoInvoiceNumber,
      date: invoice.date ?? data.date,
      customerId: customerId || invoice.customerId || data.customerId,
    });
    if (!payloadBase.invoiceId || !payloadBase.invoiceNumber) return;
    invoiceByNumber.set(normalizeInvoiceNumber(payloadBase.invoiceNumber), payloadBase);
    invoicesScanned += 1;
    const serials = serialsFromInvoiceData(data);
    if (serials.length) {
      invoicesWithSerials += 1;
      for (const serial of serials) {
        const key = normalizeSerial(serial);
        if (!key) continue;
        serialToInvoice.set(key, preferNewer(serialToInvoice.get(key), {
          serial,
          ...payloadBase,
        }));
      }
    }
    const haystack = invoiceHaystack(data);
    if (haystack.length >= 5) {
      haystacks.push({ haystack, payload: { serial: serials[0] || '', ...payloadBase } });
    }
  };

  await forEachInvoicePage(docs => {
    for (const doc of docs) {
      const data = doc.data() || {};
      indexRecord(data, {
        invoiceId: data.id || doc.id,
        invoiceNumber: data.invoiceNumber,
        date: data.date,
      }, customerIdFromInvoiceDoc(doc));
    }
  });

  await forEachInvoiceSummaryPage(docs => {
    for (const doc of docs) {
      const data = doc.data() || {};
      const parts = doc.ref.path.split('/');
      const zohoAt = parts.indexOf('zohoCustomers');
      indexRecord(data, {
        invoiceId: data.id || doc.id,
        invoiceNumber: data.invoiceNumber,
        date: data.date,
      }, zohoAt >= 0 ? parts[zohoAt + 1] : data.customerId);
    }
  });

  await forEachSalesOrderPage(docs => {
    for (const doc of docs) {
      const data = doc.data() || {};
      const invoiceNumber = data.zohoInvoiceNumber || data.invoiceNumber;
      if (!invoiceNumber) continue;
      indexRecord(data, {
        invoiceId: data.zohoInvoiceId || data.invoiceId || data.id || doc.id,
        invoiceNumber,
        date: data.date,
        customerId: data.customerId,
      }, data.customerId);
    }
  });

  const certDocs = await paginateQuery(db.collection(YESGATC_CERTIFICATES));
  const invoiceCerts = new Map();
  const writes = [];
  let matched = 0;
  let zohoMatched = 0;
  let zohoToken = null;
  let zohoOrg = null;

  function linkForSerial(serial, key) {
    const excel = key ? loadExcelSerialInvoiceMap()[key] : null;
    if (excel?.invoiceNumber) {
      const found = invoiceByNumber.get(normalizeInvoiceNumber(excel.invoiceNumber));
      return {
        serial,
        invoiceId: found?.invoiceId || null,
        invoiceNumber: excel.invoiceNumber,
        invoiceDate: found?.invoiceDate || excel.invoiceDate || null,
        invoiceCustomerId: found?.invoiceCustomerId || null,
      };
    }
    const direct = key ? serialToInvoice.get(key) : null;
    if (direct) return direct;
    if (!key || key.length < 5) return null;
    let best = null;
    for (const row of haystacks) {
      if (row.haystack.includes(key)) {
        best = preferNewer(best, { ...row.payload, serial });
      }
    }
    return best;
  }

  for (const doc of certDocs) {
    const data = doc.data() || {};
    const serial = String(data.serialNumber ?? '');
    const key = normalizeSerial(serial);
    let link = linkForSerial(serial, key);
    if (!link && zoho?.secrets && key) {
      try {
        if (!zohoToken) {
          zohoToken = await getAccessToken(zoho.secrets);
          zohoOrg = await resolveOrganizationId(zohoToken, zoho.orgId);
        }
        link = await findZohoInvoiceForSerial(zohoToken, zohoOrg, serial);
        if (link?.invoiceNumber) {
          zohoMatched += 1;
          serialToInvoice.set(key, link);
        } else {
          link = null;
        }
      } catch (err) {
        console.warn(`Zoho serial search failed for ${serial}:`, err?.message ?? err);
      }
    }
    if (key && data.serialKey !== key) {
      writes.push({
        path: `${YESGATC_CERTIFICATES}/${doc.id}`,
        data: { serialKey: key },
      });
    }
    if (!link) continue;
    matched += 1;
    writes.push({
      path: `${YESGATC_CERTIFICATES}/${doc.id}`,
      data: {
        serialKey: key,
        ...invoiceFieldsFromLink(link),
      },
    });
    writes.push({
      path: `${YESGATC_SERIAL_LINKS}/${serialLinkDocId(serial)}`,
      data: {
        serialNumber: serial || link.serial,
        serialKey: key,
        invoiceId: link.invoiceId,
        invoiceNumber: link.invoiceNumber,
        invoiceDate: link.invoiceDate,
        invoiceCustomerId: link.invoiceCustomerId,
        certificateId: doc.id,
        certificateNumber: String(data.certificateNumber ?? ''),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
    if (link.invoiceCustomerId && link.invoiceId) {
      const invoicePath = `zohoCustomers/${link.invoiceCustomerId}/invoices/${link.invoiceId}`;
      const list = invoiceCerts.get(invoicePath) || [];
      list.push({
        certificateId: doc.id,
        certificateNumber: String(data.certificateNumber ?? ''),
        serialNumber: serial,
      });
      invoiceCerts.set(invoicePath, list);
    }
  }

  for (const [key, link] of serialToInvoice) {
    const id = serialLinkDocId(key);
    if (!id) continue;
    writes.push({
      path: `${YESGATC_SERIAL_LINKS}/${id}`,
      data: {
        serialNumber: link.serial,
        serialKey: key,
        invoiceId: link.invoiceId,
        invoiceNumber: link.invoiceNumber,
        invoiceDate: link.invoiceDate,
        invoiceCustomerId: link.invoiceCustomerId,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  for (const [path, certs] of invoiceCerts) {
    writes.push({
      path,
      data: {
        yesgatcLinks: certs,
        yesgatcLinkedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  const written = writes.length ? await commitChunks(writes) : 0;
  return {
    ok: true,
    minDate,
    invoicesScanned,
    invoicesWithSerials,
    serialsIndexed: serialToInvoice.size,
    certificatesScanned: certDocs.length,
    excelRows: Object.keys(loadExcelSerialInvoiceMap()).length,
    matched,
    zohoMatched,
    written,
  };
}
