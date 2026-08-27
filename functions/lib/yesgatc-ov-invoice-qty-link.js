/**
 * Fill remaining GATC OV certificates onto RC-linked dealer invoices by HSN machine qty.
 * Serial-number matches are left alone; this only assigns unlinked OVs.
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { invoiceDateKey, invoiceFieldsFromLink } from './yesgatc-invoice-link.js';

const YESGATC_CERTIFICATES = 'yesgatcCertificates';
const YESGATC_RC_DETAILS = 'yesgatcRcDetails';
const YESGATC_RC_DEALER_LINKS = 'yesgatcRcDealerLinks';

export const YESGATC_OV_INVOICE_MIN_DATE = '2026-02-01';
export const YESGATC_OV_MACHINE_HSN = Object.freeze([
  '84238190',
  '84238290',
  '84239020',
  '84231000',
]);

const MACHINE_HSN = new Set(YESGATC_OV_MACHINE_HSN);
const MAX_BATCH = 400;
const PAGE = 400;
const VOID_STATUSES = new Set(['void', 'cancelled', 'canceled']);

function str(value) {
  return value == null ? '' : String(value).trim();
}

function upper(value) {
  return str(value).toUpperCase();
}

function recordFromUnknown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function hsnDigits(value) {
  return str(value).replace(/\D/g, '');
}

function verificationKind(data) {
  const raw = recordFromUnknown(data?.raw);
  const text = upper(
    data?.verificationType
    || raw?.verificationType
    || raw?.verification_type
    || data?.verification_type,
  );
  if (!text) return null;
  if (text === 'OV' || text.startsWith('ORIGINAL')) return 'OV';
  if (text === 'RV' || text.startsWith('RE')) return 'RV';
  return null;
}

function isVoidedCertificate(data) {
  if (data?.voided === true) return true;
  const raw = recordFromUnknown(data?.raw);
  return raw?.voided === true;
}

function isVoidInvoice(data) {
  return VOID_STATUSES.has(str(data?.status).toLowerCase());
}

function certificateRcIndexKeys(data) {
  const keys = new Set();
  const add = (value) => {
    const text = upper(value);
    if (text) keys.add(text);
  };
  const raw = recordFromUnknown(data?.raw);
  const nestedRc = recordFromUnknown(raw?.rc)
    || recordFromUnknown(raw?.rcOffice)
    || recordFromUnknown(raw?.regionalCenter);
  add(data?.rcCode);
  add(data?.rcId);
  add(raw?.rcId);
  add(raw?.rcCode);
  add(nestedRc?.id);
  add(nestedRc?.code);
  add(nestedRc?.rcCode);
  return [...keys];
}

function certSortKey(row) {
  return [
    str(row.issuedAt) || '9999',
    str(row.receivedAt) || '9999',
    str(row.certificateNumber),
    row.id,
  ].join('|');
}

function invoiceSortKey(invoice) {
  return [
    invoice.invoiceDate || '9999',
    str(invoice.invoiceNumber),
    invoice.invoiceId,
  ].join('|');
}

function lineMachineQty(line, catalogHsnByItemId) {
  const itemId = str(line?.itemId || line?.item_id);
  const lineHsn = hsnDigits(line?.hsn ?? line?.hsnOrSac ?? line?.hsn_or_sac);
  const catalogHsn = itemId ? hsnDigits(catalogHsnByItemId.get(itemId)) : '';
  const hsn = lineHsn || catalogHsn;
  if (!MACHINE_HSN.has(hsn)) return 0;
  const qty = Number(line?.quantity ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round(qty);
}

function invoiceMachineQty(data, catalogHsnByItemId) {
  const lines = Array.isArray(data?.lineItems)
    ? data.lineItems
    : (Array.isArray(data?.line_items) ? data.line_items : []);
  let qty = 0;
  for (const line of lines) qty += lineMachineQty(line, catalogHsnByItemId);
  return qty;
}

async function paginateQuery(queryBase) {
  const docs = [];
  let last = null;
  for (;;) {
    let q = queryBase.limit(PAGE);
    if (last) q = queryBase.startAfter(last).limit(PAGE);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
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

async function loadCatalogHsn(itemIds) {
  const db = getFirestore();
  const map = new Map();
  const unique = [...new Set(itemIds.map(id => str(id)).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map(id => db.collection('catalogProducts').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const hsn = hsnDigits(snap.data()?.hsn);
      if (hsn) map.set(snap.id, hsn);
    }
  }
  return map;
}

async function resolveZohoCustomerId(dealerId) {
  const id = str(dealerId);
  if (!id) return '';
  const db = getFirestore();
  const invoices = await db.collection(`zohoCustomers/${id}/invoices`).limit(1).get();
  if (!invoices.empty) return id;
  const userSnap = await db.collection('users').doc(id).get();
  const zoho = str(userSnap.data()?.zohoCustomerId);
  return zoho || id;
}

async function loadLinkedDealers() {
  const db = getFirestore();
  const [rcSnap, linkSnap] = await Promise.all([
    db.collection(YESGATC_RC_DETAILS).get(),
    db.collection(YESGATC_RC_DEALER_LINKS).get(),
  ]);
  const linksByRcId = new Map();
  for (const row of linkSnap.docs) {
    const data = row.data() || {};
    const dealerId = str(data.dealerId);
    if (!dealerId) continue;
    linksByRcId.set(row.id, {
      dealerId,
      dealerName: str(data.dealerName),
      rcCode: upper(data.rcCode),
    });
  }

  const dealers = [];
  const keyToRcIds = new Map();
  const skipped = [];
  for (const row of rcSnap.docs) {
    const data = row.data() || {};
    const code = upper(data.code);
    const link = linksByRcId.get(row.id);
    const keys = [upper(row.id), code].filter(Boolean);
    for (const key of keys) {
      const list = keyToRcIds.get(key) ?? [];
      if (!list.includes(row.id)) list.push(row.id);
      keyToRcIds.set(key, list);
    }
    if (!link) {
      skipped.push({ rcId: row.id, rcCode: code || null, rcName: str(data.name) });
      continue;
    }
    dealers.push({
      rcId: row.id,
      rcCode: code || link.rcCode || null,
      rcName: str(data.name),
      dealerId: link.dealerId,
      dealerName: link.dealerName,
    });
  }
  return { dealers, keyToRcIds, skipped };
}

async function loadDealerInvoices(customerId, minDate) {
  const db = getFirestore();
  const docs = await paginateQuery(db.collection(`zohoCustomers/${customerId}/invoices`));
  const invoices = [];
  const itemIds = [];
  for (const doc of docs) {
    const data = doc.data() || {};
    if (isVoidInvoice(data)) continue;
    const date = invoiceDateKey(data.date);
    if (date && date < minDate) continue;
    const invoiceNumber = str(data.invoiceNumber || data.zohoInvoiceNumber);
    const invoiceId = str(data.id || doc.id);
    if (!invoiceId || !invoiceNumber) continue;
    const lines = Array.isArray(data.lineItems)
      ? data.lineItems
      : (Array.isArray(data.line_items) ? data.line_items : []);
    for (const line of lines) {
      const itemId = str(line?.itemId || line?.item_id);
      if (itemId) itemIds.push(itemId);
    }
    invoices.push({
      invoiceId,
      invoiceNumber,
      invoiceDate: date || null,
      customerId,
      data,
    });
  }
  return { invoices, itemIds };
}

function firstMatchingRcId(data, keyToRcIds) {
  for (const key of certificateRcIndexKeys(data)) {
    const ids = keyToRcIds.get(key);
    if (ids?.length) return ids[0];
  }
  return '';
}

function isoFromAdmin(value) {
  if (value == null || value === '') return '';
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return '';
    }
  }
  return str(value);
}

function mapCert(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    data,
    certificateNumber: str(data.certificateNumber),
    serialNumber: str(data.serialNumber),
    invoiceId: str(data.invoiceId),
    invoiceNumber: str(data.invoiceNumber),
    issuedAt: isoFromAdmin(data.issuedAt),
    receivedAt: isoFromAdmin(data.receivedAt),
  };
}

async function loadCertificates() {
  const db = getFirestore();
  const docs = await paginateQuery(db.collection(YESGATC_CERTIFICATES));
  return docs.map(mapCert);
}

function assignmentWrites(cert, invoice) {
  const link = {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    invoiceCustomerId: invoice.customerId,
  };
  return {
    certWrite: {
      path: `${YESGATC_CERTIFICATES}/${cert.id}`,
      data: {
        ...invoiceFieldsFromLink(link),
        invoiceLinkSource: 'ov_qty',
      },
    },
    invoiceCert: {
      path: `zohoCustomers/${invoice.customerId}/invoices/${invoice.invoiceId}`,
      cert: {
        certificateId: cert.id,
        certificateNumber: cert.certificateNumber,
        serialNumber: cert.serialNumber,
      },
    },
  };
}

function fillInvoiceSlots(invoices, unlinkedCerts) {
  const assigned = [];
  let certIndex = 0;
  for (const invoice of invoices) {
    while (invoice.remaining > 0 && certIndex < unlinkedCerts.length) {
      const cert = unlinkedCerts[certIndex];
      certIndex += 1;
      assigned.push({ cert, invoice });
      invoice.remaining -= 1;
    }
  }
  return assigned;
}

async function slotsForDealer({ dealer, occupiedByInvoiceId, minDate, catalogCache }) {
  const customerId = await resolveZohoCustomerId(dealer.dealerId);
  if (!customerId) return { customerId: '', invoices: [], slots: 0 };
  const { invoices: rawInvoices, itemIds } = await loadDealerInvoices(customerId, minDate);
  const missing = itemIds.filter(id => !catalogCache.has(id));
  if (missing.length) {
    const extra = await loadCatalogHsn(missing);
    for (const [id, hsn] of extra) catalogCache.set(id, hsn);
  }
  const invoices = [];
  let slots = 0;
  for (const row of rawInvoices) {
    const capacity = invoiceMachineQty(row.data, catalogCache);
    if (capacity <= 0) continue;
    const occupied = occupiedByInvoiceId.get(row.invoiceId) || 0;
    const remaining = Math.max(0, capacity - occupied);
    if (remaining <= 0) continue;
    invoices.push({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      customerId,
      capacity,
      occupied,
      remaining,
    });
    slots += remaining;
  }
  invoices.sort((a, b) => invoiceSortKey(a).localeCompare(invoiceSortKey(b)));
  return { customerId, invoices, slots };
}

async function writeAssignments(assigned) {
  const writes = [];
  const invoicePatches = new Map();
  for (const { cert, invoice } of assigned) {
    const { certWrite, invoiceCert } = assignmentWrites(cert, invoice);
    writes.push(certWrite);
    const list = invoicePatches.get(invoiceCert.path) || [];
    list.push(invoiceCert.cert);
    invoicePatches.set(invoiceCert.path, list);
  }
  for (const [path, certs] of invoicePatches) {
    writes.push(await mergeInvoiceGatcLinks(path, certs));
  }
  const written = writes.length ? await commitChunks(writes) : 0;
  return written;
}

/**
 * Assign unlinked OV certificates to open HSN machine slots on RC dealer invoices.
 */
export async function linkYesGatcOvCertificatesByInvoiceQty({
  minDate = YESGATC_OV_INVOICE_MIN_DATE,
} = {}) {
  const startDate = str(minDate) || YESGATC_OV_INVOICE_MIN_DATE;
  const { dealers, keyToRcIds, skipped } = await loadLinkedDealers();
  const certs = await loadCertificates();
  const occupiedByInvoiceId = new Map();
  const unlinkedByRc = new Map();
  let alreadyLinked = 0;
  let unlinkedOv = 0;

  for (const cert of certs) {
    if (isVoidedCertificate(cert.data)) continue;
    if (cert.invoiceNumber) {
      alreadyLinked += 1;
      if (cert.invoiceId && verificationKind(cert.data) === 'OV') {
        occupiedByInvoiceId.set(cert.invoiceId, (occupiedByInvoiceId.get(cert.invoiceId) || 0) + 1);
      }
      continue;
    }
    if (verificationKind(cert.data) !== 'OV') continue;
    const rcId = firstMatchingRcId(cert.data, keyToRcIds);
    if (!rcId) continue;
    unlinkedOv += 1;
    const list = unlinkedByRc.get(rcId) ?? [];
    list.push(cert);
    unlinkedByRc.set(rcId, list);
  }

  const catalogCache = new Map();
  const byDealer = [];
  const assigned = [];
  for (const dealer of dealers) {
    const { customerId, invoices, slots } = await slotsForDealer({
      dealer,
      occupiedByInvoiceId,
      minDate: startDate,
      catalogCache,
    });
    const pool = (unlinkedByRc.get(dealer.rcId) ?? [])
      .slice()
      .sort((a, b) => certSortKey(a).localeCompare(certSortKey(b)));
    const matches = fillInvoiceSlots(invoices, pool);
    assigned.push(...matches);
    byDealer.push({
      rcId: dealer.rcId,
      rcCode: dealer.rcCode,
      dealerId: customerId || dealer.dealerId,
      dealerName: dealer.dealerName,
      unlinkedOv: pool.length,
      openSlots: slots,
      assigned: matches.length,
    });
  }

  const written = await writeAssignments(assigned);
  return {
    ok: true,
    minDate: startDate,
    hsn: [...MACHINE_HSN],
    dealers: dealers.length,
    skippedUnlinkedRcs: skipped,
    certificatesScanned: certs.length,
    alreadyLinked,
    unlinkedOv,
    assigned: assigned.length,
    written,
    byDealer,
  };
}

/**
 * After ingest: if an OV cert still has no invoice, fill the next open HSN slot.
 */
export async function attachOvQtyInvoiceToCertificateWrites(writes) {
  const certWrites = writes.filter(row => row.path.startsWith(`${YESGATC_CERTIFICATES}/`));
  if (!certWrites.length) return writes;

  const db = getFirestore();
  const pending = [];
  for (const row of certWrites) {
    if (str(row.data?.invoiceNumber)) continue;
    if (verificationKind(row.data) !== 'OV') continue;
    const certId = row.path.split('/')[1];
    if (!certId) continue;
    const existing = await db.doc(row.path).get();
    if (str(existing.data()?.invoiceNumber)) continue;
    pending.push({ row, certId, existing: existing.data() || {} });
  }
  if (!pending.length) return writes;

  const { dealers, keyToRcIds } = await loadLinkedDealers();
  const dealerByRcId = new Map(dealers.map(row => [row.rcId, row]));
  const catalogCache = new Map();
  const occupiedByInvoiceId = new Map();
  const assigned = [];
  const usedCertIds = new Set();
  const slotsByRc = new Map();

  for (const item of pending) {
    const data = { ...item.existing, ...item.row.data };
    const rcId = firstMatchingRcId(data, keyToRcIds);
    const dealer = rcId ? dealerByRcId.get(rcId) : null;
    if (!dealer) continue;
    if (!slotsByRc.has(rcId)) {
      const customerId = await resolveZohoCustomerId(dealer.dealerId);
      const linked = customerId
        ? await db.collection(YESGATC_CERTIFICATES)
          .where('invoiceCustomerId', '==', customerId)
          .get()
          .catch(() => null)
        : null;
      if (linked) {
        for (const doc of linked.docs) {
          const invoiceId = str(doc.data()?.invoiceId);
          if (!invoiceId) continue;
          occupiedByInvoiceId.set(invoiceId, (occupiedByInvoiceId.get(invoiceId) || 0) + 1);
        }
      }
      slotsByRc.set(rcId, await slotsForDealer({
        dealer,
        occupiedByInvoiceId,
        minDate: YESGATC_OV_INVOICE_MIN_DATE,
        catalogCache,
      }));
    }
    const slotSet = slotsByRc.get(rcId);
    const invoice = slotSet.invoices.find(row => row.remaining > 0);
    if (!invoice) continue;
    const cert = {
      id: item.certId,
      certificateNumber: str(item.row.data?.certificateNumber || item.existing.certificateNumber),
      serialNumber: str(item.row.data?.serialNumber || item.existing.serialNumber),
    };
    if (usedCertIds.has(cert.id)) continue;
    usedCertIds.add(cert.id);
    assigned.push({ cert, invoice });
    invoice.remaining -= 1;
    Object.assign(item.row.data, invoiceFieldsFromLink({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      invoiceCustomerId: invoice.customerId,
    }), { invoiceLinkSource: 'ov_qty' });
  }

  if (!assigned.length) return writes;
  const extra = [];
  const invoicePatches = new Map();
  for (const { cert, invoice } of assigned) {
    const path = `zohoCustomers/${invoice.customerId}/invoices/${invoice.invoiceId}`;
    const list = invoicePatches.get(path) || [];
    list.push({
      certificateId: cert.id,
      certificateNumber: cert.certificateNumber,
      serialNumber: cert.serialNumber,
    });
    invoicePatches.set(path, list);
  }
  for (const [path, certs] of invoicePatches) {
    extra.push(await mergeInvoiceGatcLinks(path, certs));
  }
  return extra.length ? [...writes, ...extra] : writes;
}
