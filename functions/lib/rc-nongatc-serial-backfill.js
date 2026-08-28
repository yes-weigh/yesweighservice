/**
 * Allot unused non-GATC pool serials (G-series) onto RC dealer invoices
 * after 1 Feb 2026 for machine HSNs, then push YesGATC.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  compactSerialKey,
  invoiceLineHasGatcTag,
  isNonGatcSerialEligibleLine,
  isVoidInvoiceStatus,
  NON_GATC_ALLOCATIONS,
  NON_GATC_MACHINE_HSN,
  NON_GATC_SERIES,
  SERIAL_NUMBER_ALLOTMENT_DOC,
} from './non-gatc-serial-allot.js';
import { applySerialsToLine } from './non-gatc-serial-allot.js';
import { YESGATC_DEALER_RC_OFFICES } from './yesgatc-rc-offices.js';
import { pushRcInvoiceSerialsToYesGatcSafe } from './yesgatc-rc-invoice-push.js';
import {
  postYesGatcWebhook,
  pushSerialAllotmentsToYesGatc,
  resolveYesGatcWebhookUrl,
  YESGATC_SERIAL_ALLOTMENT,
  YESGATC_SERIAL_ALLOTTED,
} from './yesgatc-serial-push.js';
import { loadWebhookSecret } from './yesgatc-webhook.js';

export const RC_NONGATC_MIN_DATE = '2026-02-01';
const TARGET_FROM = 'G0001';
const TARGET_TO = 'G1082';

/** Sold − OV from RC OV report — exact qty to allot per office. */
export const RC_ALLOT_CAPS = {
  ATL: 534,
  MZN: 49,
  DYI: 2,
  ACE: 96,
  KNR: 131,
  KTM: 100,
  KSR: 99,
  KLM: 71,
};

export function initRcBackfillAdmin(credential) {
  if (getApps().length) return;
  initializeApp({
    credential: credential || applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'yesweigh-service',
  });
}

function ensureAdmin() {
  initRcBackfillAdmin();
}

const MACHINE_HSN = new Set(NON_GATC_MACHINE_HSN);
const PAGE = 400;

function str(value) {
  return value == null ? '' : String(value).trim();
}

function hsnDigits(value) {
  return str(value).replace(/\D/g, '');
}

function invoiceDateKey(value) {
  const text = str(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

function uniqueSerials(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = str(value);
    const key = compactSerialKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function isTargetSerial(serial) {
  const parsed = parseSerialToken(serial);
  return Boolean(
    parsed
    && parsed.prefix.replace(/[^A-Za-z]/g, '').toUpperCase() === 'G'
    && parsed.n >= 1
    && parsed.n <= 1082,
  );
}

function lineNeed(line) {
  const qty = Math.max(0, Math.round(Number(line?.quantity) || 0));
  const have = uniqueSerials(line?.serialNumbers).filter(serial => !isTargetSerial(serial)).length;
  return Math.max(0, qty - have);
}

function parseSerialToken(raw) {
  const token = str(raw);
  if (!token) return null;
  const match = /^(.*?)(\d+)$/.exec(token);
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return { prefix: match[1], n, width: match[2].length };
}

function padNumeric(n, width) {
  const raw = String(n);
  return width > raw.length ? raw.padStart(width, '0') : raw;
}

function expandPool(allotments) {
  const wantedFrom = parseSerialToken(TARGET_FROM);
  const wantedTo = parseSerialToken(TARGET_TO);
  const out = [];
  for (const row of Array.isArray(allotments) ? allotments : []) {
    if (str(row?.series) !== NON_GATC_SERIES) continue;
    const from = parseSerialToken(row.from);
    const to = parseSerialToken(row.to);
    if (!from || !to || from.prefix !== to.prefix || from.n > to.n) continue;
    if (from.prefix.toUpperCase() !== 'G') continue;
    const width = Math.max(from.width, to.width, wantedFrom?.width || 0, wantedTo?.width || 0);
    const missing = new Set((Array.isArray(row.missing) ? row.missing : []).map(compactSerialKey));
    const start = Math.max(from.n, wantedFrom?.n || from.n);
    const end = Math.min(to.n, wantedTo?.n || to.n);
    if (start > end) continue;
    for (let n = start; n <= end; n += 1) {
      const serial = `G${padNumeric(n, width)}`;
      if (missing.has(compactSerialKey(serial))) continue;
      out.push(serial);
    }
  }
  const seen = new Set();
  return out.filter(serial => {
    const key = compactSerialKey(serial);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verificationKind(data) {
  const raw = data?.raw && typeof data.raw === 'object' ? data.raw : {};
  const text = str(data?.verificationType || raw.verificationType || raw.verification_type).toUpperCase();
  if (!text) return null;
  if (text === 'OV' || text.startsWith('ORIGINAL')) return 'OV';
  return null;
}

function certificateRcKeys(data) {
  const keys = new Set();
  const add = (value) => {
    const text = str(value).toUpperCase();
    if (text) keys.add(text);
  };
  const raw = data?.raw && typeof data.raw === 'object' ? data.raw : {};
  const nested = raw.rc && typeof raw.rc === 'object' ? raw.rc : {};
  add(data?.rcCode);
  add(data?.rcId);
  add(raw.rcCode);
  add(raw.rcId);
  add(nested.code);
  add(nested.rcCode);
  add(nested.id);
  return [...keys];
}

function isInvoiceLinkedCertificate(data) {
  return Boolean(str(data?.invoiceNumber) || str(data?.invoiceId));
}

async function loadOvStatsByRc(db, dealers) {
  const keyToCodes = new Map();
  const ov = new Map();
  const linked = new Map();
  for (const dealer of dealers) {
    ov.set(dealer.rcCode, 0);
    linked.set(dealer.rcCode, 0);
    for (const key of [dealer.rcCode, dealer.rcId].map(value => str(value).toUpperCase()).filter(Boolean)) {
      const list = keyToCodes.get(key) || [];
      if (!list.includes(dealer.rcCode)) list.push(dealer.rcCode);
      keyToCodes.set(key, list);
    }
  }
  const docs = await paginateCollection(db.collection('yesgatcCertificates'));
  for (const doc of docs) {
    const data = doc.data() || {};
    if (data.voided === true) continue;
    if (verificationKind(data) !== 'OV') continue;
    const hit = new Set();
    for (const key of certificateRcKeys(data)) {
      for (const code of keyToCodes.get(key) || []) hit.add(code);
    }
    const hasInvoice = isInvoiceLinkedCertificate(data);
    for (const code of hit) {
      ov.set(code, (ov.get(code) || 0) + 1);
      if (hasInvoice) linked.set(code, (linked.get(code) || 0) + 1);
    }
  }
  return { ov, linked };
}

async function loadOvCountByRc(db, dealers) {
  const stats = await loadOvStatsByRc(db, dealers);
  return stats.ov;
}

/** Sold / OV / linked / pending (Sold − OV) for each dealer RC. */
export async function loadYesGatcRcOvQuota(minDate = RC_NONGATC_MIN_DATE) {
  ensureAdmin();
  const db = getFirestore();
  const dealers = await loadRcDealers(db);
  const stats = await loadOvStatsByRc(db, dealers);
  const rows = [];
  for (const dealer of dealers) {
    const customerId = await resolveCustomerId(db, dealer.dealerId);
    const loaded = await loadDealerNeedInvoices(db, customerId, minDate);
    const sold = Number(loaded.sold) || 0;
    const ov = stats.ov.get(dealer.rcCode) || 0;
    const linked = stats.linked.get(dealer.rcCode) || 0;
    rows.push({
      rcCode: dealer.rcCode,
      rcName: dealer.rcName,
      dealerId: customerId,
      dealerName: dealer.dealerName,
      sold,
      ov,
      linked,
      pending: Math.max(0, sold - ov),
      bal: Math.max(0, sold - ov),
    });
  }
  return rows;
}

async function paginateCollection(ref) {
  const docs = [];
  let cursor = null;
  for (;;) {
    let query = ref.limit(PAGE);
    if (cursor) query = ref.startAfter(cursor).limit(PAGE);
    const snap = await query.get();
    docs.push(...snap.docs);
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
    if (!cursor) break;
  }
  return docs;
}

async function loadTakenKeys(db) {
  const taken = new Set();
  const snap = await db.collection(NON_GATC_ALLOCATIONS).get();
  snap.forEach(doc => {
    const serial = str(doc.data()?.serial || doc.id);
    if (isTargetSerial(serial) || isTargetSerial(doc.id)) return;
    taken.add(doc.id);
  });
  return taken;
}

async function loadRcDealers(db) {
  const [officeSnap, linkSnap, detailSnap] = await Promise.all([
    db.collection('yesgatcRcOffices').get(),
    db.collection('yesgatcRcDealerLinks').get(),
    db.collection('yesgatcRcDetails').get(),
  ]);
  const offices = new Map();
  for (const row of officeSnap.docs) {
    const data = row.data() || {};
    if (data.kind === 'company' || data.active === false) continue;
    offices.set(str(data.code || row.id).toUpperCase(), {
      code: str(data.code || row.id).toUpperCase(),
      name: str(data.name),
      sourceRcId: str(data.sourceRcId),
      dealerId: str(data.dealerId),
    });
  }
  const linksByRcId = new Map();
  for (const row of linkSnap.docs) {
    const data = row.data() || {};
    if (!str(data.dealerId)) continue;
    linksByRcId.set(row.id, {
      dealerId: str(data.dealerId),
      dealerName: str(data.dealerName),
      rcCode: str(data.rcCode).toUpperCase(),
    });
  }
  const detailsById = new Map();
  for (const row of detailSnap.docs) {
    detailsById.set(row.id, { id: row.id, ...row.data() });
  }

  const dealers = [];
  for (const office of YESGATC_DEALER_RC_OFFICES) {
    const stored = offices.get(office.code) || office;
    const sourceId = stored.sourceRcId;
    const link = (sourceId && linksByRcId.get(sourceId))
      || [...linksByRcId.values()].find(item => item.rcCode === office.code)
      || null;
    const detail = sourceId ? detailsById.get(sourceId) : null;
    const dealerId = str(link?.dealerId || stored.dealerId || detail?.dealerId);
    if (!dealerId) continue;
    dealers.push({
      rcCode: office.code,
      rcName: stored.name || office.name,
      rcId: sourceId || office.code,
      dealerId,
      dealerName: str(link?.dealerName || stored.dealerName || detail?.dealerName),
    });
  }
  return dealers;
}

async function resolveCustomerId(db, dealerId) {
  const invoices = await db.collection(`zohoCustomers/${dealerId}/invoices`).limit(1).get();
  if (!invoices.empty) return dealerId;
  const userSnap = await db.collection('users').doc(dealerId).get();
  return str(userSnap.data()?.zohoCustomerId) || dealerId;
}

function isMachineLine(line, catalogHsn) {
  const itemId = str(line?.itemId || line?.item_id);
  const hsn = hsnDigits(line?.hsn) || (itemId ? hsnDigits(catalogHsn.get(itemId)) : '');
  return MACHINE_HSN.has(hsn);
}

async function loadCatalogHsn(db, itemIds) {
  const map = new Map();
  const unique = [...new Set([...itemIds].map(str).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const snaps = await db.getAll(...chunk.map(id => db.collection('catalogProducts').doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const hsn = hsnDigits(snap.data()?.hsn);
      if (hsn) map.set(snap.id, hsn);
    }
  }
  return map;
}

export async function loadDealerNeedInvoices(db, customerId, minDate) {
  const docs = await paginateCollection(db.collection(`zohoCustomers/${customerId}/invoices`));
  const itemIds = [];
  const invoices = [];
  for (const doc of docs) {
    const data = doc.data() || {};
    if (isVoidInvoiceStatus(data.status)) continue;
    const date = invoiceDateKey(data.date);
    if (!date || date < minDate) continue;
    const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
    for (const line of lines) {
      const itemId = str(line?.itemId || line?.item_id);
      if (itemId && !hsnDigits(line?.hsn)) itemIds.push(itemId);
    }
    invoices.push({
      ref: doc.ref,
      id: str(data.id || doc.id),
      customerId,
      invoiceNumber: str(data.invoiceNumber || data.zohoInvoiceNumber),
      date,
      status: str(data.status),
      data,
      lines,
    });
  }
  const catalogHsn = await loadCatalogHsn(db, itemIds);
  const needed = [];
  let sold = 0;
  let allotted = 0;
  for (const invoice of invoices) {
    const seats = [];
    const fallbackSeats = [];
    for (const line of invoice.lines) {
      const withHsn = {
        ...line,
        hsn: hsnDigits(line?.hsn) || catalogHsn.get(str(line?.itemId || line?.item_id)) || line?.hsn,
      };
      if (!isMachineLine(withHsn, catalogHsn)) continue;
      sold += Math.max(0, Math.round(Number(line.quantity) || 0));
      allotted += uniqueSerials(line?.serialNumbers).length;
      const need = lineNeed(withHsn);
      if (!need) continue;
      const seat = {
        lineId: str(line.id),
        name: str(line.name),
        sku: str(line.sku) || null,
        hsn: hsnDigits(withHsn.hsn),
        qty: Math.round(Number(line.quantity) || 0),
        have: uniqueSerials(line.serialNumbers).filter(serial => !isTargetSerial(serial)).length,
        need,
      };
      if (invoiceLineHasGatcTag(withHsn)) fallbackSeats.push(seat);
      else seats.push(seat);
    }
    if (!seats.length && !fallbackSeats.length) continue;
    needed.push({
      ...invoice,
      seats,
      fallbackSeats,
      need: [...seats, ...fallbackSeats].reduce((sum, seat) => sum + seat.need, 0),
    });
  }
  needed.sort((a, b) => {
    const date = a.date.localeCompare(b.date);
    if (date) return date;
    return a.invoiceNumber.localeCompare(b.invoiceNumber, 'en', { sensitivity: 'base' });
  });
  return { invoices: needed, sold, allotted };
}

export async function planRcNonGatcSerialBackfill({
  minDate = RC_NONGATC_MIN_DATE,
} = {}) {
  ensureAdmin();
  const db = getFirestore();
  const allotSnap = await db.doc(SERIAL_NUMBER_ALLOTMENT_DOC).get();
  const allotments = Array.isArray(allotSnap.data()?.allotments) ? allotSnap.data().allotments : [];
  const pool = expandPool(allotments);
  const taken = await loadTakenKeys(db);
  const available = pool.filter(serial => !taken.has(compactSerialKey(serial)));
  const dealers = await loadRcDealers(db);
  const ovByRc = await loadOvCountByRc(db, dealers);

  let cursor = 0;
  const rcs = [];
  for (const dealer of dealers) {
    const customerId = await resolveCustomerId(db, dealer.dealerId);
    const loaded = await loadDealerNeedInvoices(db, customerId, minDate);
    const invoices = loaded.invoices || loaded;
    const sold = Number(loaded.sold) || invoices.reduce((sum, row) => sum + row.need, 0);
    const ov = ovByRc.get(dealer.rcCode) || 0;
    const cap = Math.max(0, Number(RC_ALLOT_CAPS[dealer.rcCode]) || 0);
    const assignments = [];
    const usedByInvoice = new Map();
    let allotted = 0;

    const takeSeats = (invoice, seats) => {
      if (allotted >= cap || cursor >= available.length) return;
      for (const seat of seats || []) {
        if (allotted >= cap || cursor >= available.length) break;
        const existing = usedByInvoice.get(invoice.id);
        const already = existing?.lines.find(row => row.lineId === seat.lineId)?.serials.length || 0;
        const remain = Math.min(seat.need - already, cap - allotted, available.length - cursor);
        if (remain <= 0) continue;
        const take = available.slice(cursor, cursor + remain);
        cursor += take.length;
        allotted += take.length;
        if (existing) {
          existing.allotted += take.length;
          const line = existing.lines.find(row => row.lineId === seat.lineId);
          if (line) line.serials.push(...take);
          else existing.lines.push({ ...seat, serials: take, need: take.length });
        } else {
          const row = {
            customerId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            date: invoice.date,
            need: invoice.need,
            allotted: take.length,
            lines: [{ ...seat, serials: take, need: take.length }],
          };
          assignments.push(row);
          usedByInvoice.set(invoice.id, row);
        }
      }
    };

    for (const invoice of invoices) takeSeats(invoice, invoice.seats);
    if (allotted < cap) {
      for (const invoice of invoices) takeSeats(invoice, invoice.fallbackSeats);
    }
    rcs.push({
      ...dealer,
      customerId,
      invoices,
      invoiceCount: invoices.length,
      sold,
      ov,
      cap,
      seatNeed: invoices.reduce((sum, row) => sum + row.need, 0),
      allotted,
      assignments,
    });
  }

  for (const rc of rcs) delete rc.invoices;

  return {
    minDate,
    poolSize: pool.length,
    available: available.length,
    used: cursor,
    leftover: Math.max(0, available.length - cursor),
    rcs,
    allotmentIds: allotments
      .filter(row => (
        str(row?.series) === NON_GATC_SERIES
        && compactSerialKey(row?.from) === compactSerialKey(TARGET_FROM)
        && compactSerialKey(row?.to) === compactSerialKey(TARGET_TO)
      ))
      .map(row => str(row.id))
      .filter(Boolean),
  };
}

async function resetTargetAllocations(db) {
  const snap = await db.collection(NON_GATC_ALLOCATIONS).get();
  const byInvoice = new Map();
  const toDelete = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    const serial = str(data.serial || doc.id);
    if (!isTargetSerial(serial) && !isTargetSerial(doc.id)) return;
    toDelete.push(doc.ref);
    const customerId = str(data.customerId);
    const invoiceId = str(data.invoiceId);
    if (!customerId || !invoiceId) return;
    const key = `${customerId}/${invoiceId}`;
    const slot = byInvoice.get(key) || { customerId, invoiceId, keys: new Set() };
    slot.keys.add(compactSerialKey(serial));
    slot.keys.add(compactSerialKey(doc.id));
    byInvoice.set(key, slot);
  });

  let resetInvoices = 0;
  for (const slot of byInvoice.values()) {
    const ref = db.doc(`zohoCustomers/${slot.customerId}/invoices/${slot.invoiceId}`);
    const invSnap = await ref.get();
    if (!invSnap.exists) continue;
    const data = invSnap.data() || {};
    const nextLines = (Array.isArray(data.lineItems) ? data.lineItems : []).map(line => {
      const kept = uniqueSerials(line.serialNumbers).filter(serial => (
        !slot.keys.has(compactSerialKey(serial)) && !isTargetSerial(serial)
      ));
      return applySerialsToLine(line, kept);
    });
    const remainingAlloc = uniqueSerials(data.nonGatcAllocatedSerials).filter(serial => (
      !slot.keys.has(compactSerialKey(serial)) && !isTargetSerial(serial)
    ));
    await ref.set({
      lineItems: nextLines,
      nonGatcAllocatedSerials: remainingAlloc,
      yesgatcRcPushedAt: null,
      yesgatcRcPushedAtServer: null,
    }, { merge: true });
    resetInvoices += 1;
  }

  let batch = db.batch();
  let count = 0;
  for (const ref of toDelete) {
    batch.delete(ref);
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();
  return { deletedAllocations: toDelete.length, resetInvoices };
}

async function writeInvoiceAssignment(db, { dealer, assignment, actorName }) {
  const invoiceRef = db.doc(`zohoCustomers/${assignment.customerId}/invoices/${assignment.invoiceId}`);
  const snap = await invoiceRef.get();
  if (!snap.exists) throw new Error(`Invoice ${assignment.invoiceNumber} not found.`);
  const data = snap.data() || {};
  const serialByLine = new Map(assignment.lines.map(line => [line.lineId, line.serials]));
  const nextLines = (Array.isArray(data.lineItems) ? data.lineItems : []).map(line => {
    const take = serialByLine.get(str(line.id));
    const kept = uniqueSerials(line.serialNumbers).filter(serial => !isTargetSerial(serial));
    if (!take?.length) {
      return kept.length === uniqueSerials(line.serialNumbers).length
        ? line
        : applySerialsToLine(line, kept);
    }
    return applySerialsToLine(line, uniqueSerials([...kept, ...take]));
  });
  const now = new Date().toISOString();
  let batch = db.batch();
  let count = 0;
  const allocated = [];
  for (const line of assignment.lines) {
    for (const serial of line.serials) {
      allocated.push(serial);
      batch.set(db.collection(NON_GATC_ALLOCATIONS).doc(compactSerialKey(serial)), {
        serial,
        invoiceId: assignment.invoiceId,
        invoiceNumber: assignment.invoiceNumber,
        customerId: assignment.customerId,
        lineId: line.lineId,
        rcCode: dealer.rcCode,
        rcName: dealer.rcName,
        allottedAt: now,
        allottedBy: actorName,
      });
      count += 1;
      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
  }
  if (count) await batch.commit();

  const existing = uniqueSerials(data.nonGatcAllocatedSerials).filter(serial => !isTargetSerial(serial));
  await invoiceRef.set({
    lineItems: nextLines,
    nonGatcAllocatedSerials: uniqueSerials([...existing, ...allocated]),
    nonGatcSerialAllottedAt: FieldValue.serverTimestamp(),
    nonGatcSerialAllottedBy: actorName,
    yesgatcRcCode: dealer.rcCode,
    yesgatcRcName: dealer.rcName,
  }, { merge: true });
}

export async function applyRcNonGatcSerialBackfill({
  minDate = RC_NONGATC_MIN_DATE,
  actorName = 'YESWEIGH',
  pushYesGatc = true,
} = {}) {
  ensureAdmin();
  const db = getFirestore();
  const reset = await resetTargetAllocations(db);
  const plan = await planRcNonGatcSerialBackfill({ minDate });
  const results = [];

  for (const rc of plan.rcs) {
    for (const assignment of rc.assignments) {
      await writeInvoiceAssignment(db, { dealer: rc, assignment, actorName });
      let yesgatc = { pushed: false, skipped: 'disabled' };
      if (pushYesGatc) {
        yesgatc = await pushRcInvoiceSerialsToYesGatcSafe({
          customerId: assignment.customerId,
          invoiceId: assignment.invoiceId,
          actorName,
          force: true,
        });
      }
      results.push({
        rcCode: rc.rcCode,
        invoiceNumber: assignment.invoiceNumber,
        invoiceId: assignment.invoiceId,
        allotted: assignment.allotted,
        yesgatcPushed: Boolean(yesgatc.pushed),
        yesgatcSkipped: yesgatc.skipped || null,
        yesgatcError: yesgatc.error || null,
      });
    }
  }

  const invoiceLinks = [];
  for (const rc of plan.rcs) {
    for (const assignment of rc.assignments) {
      const serialNumbers = assignment.lines.flatMap(line => line.serials);
      invoiceLinks.push({
        rcCode: rc.rcCode,
        rcName: rc.rcName,
        dealerId: rc.customerId,
        dealerName: rc.dealerName,
        invoiceId: assignment.invoiceId,
        invoiceNumber: assignment.invoiceNumber,
        invoiceDate: assignment.date,
        qty: assignment.allotted,
        startNumber: serialNumbers[0] || null,
        endNumber: serialNumbers[serialNumbers.length - 1] || null,
        serialNumbers,
        lines: assignment.lines.map(line => ({
          id: line.lineId,
          name: line.name,
          sku: line.sku,
          hsn: line.hsn,
          qty: line.serials.length,
          startNumber: line.serials[0] || null,
          endNumber: line.serials[line.serials.length - 1] || null,
          serialNumbers: line.serials,
        })),
      });
    }
  }

  if (plan.allotmentIds.length && invoiceLinks.length) {
    const allotRef = db.doc(SERIAL_NUMBER_ALLOTMENT_DOC);
    const allotSnap = await allotRef.get();
    const allotments = Array.isArray(allotSnap.data()?.allotments) ? allotSnap.data().allotments : [];
    await allotRef.set({
      allotments: allotments.map(row => (
        plan.allotmentIds.includes(str(row?.id))
          ? { ...row, invoiceLinks }
          : row
      )),
      updatedAt: new Date().toISOString(),
      updatedBy: actorName,
    }, { merge: true });
  }

  let rangePush = null;
  if (pushYesGatc) {
    try {
      rangePush = await pushRcSerialAllotmentSummary({
        actorName,
        plan,
        invoiceLinks,
      });
    } catch (err) {
      rangePush = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (plan.allotmentIds.length) {
      try {
        const marked = await pushSerialAllotmentsToYesGatc({
          mode: 'ids',
          ids: plan.allotmentIds,
          actorName,
        });
        rangePush = { ...rangePush, allotmentMarked: marked };
      } catch (err) {
        rangePush = {
          ...rangePush,
          allotmentError: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return {
    minDate,
    used: plan.used,
    leftover: plan.leftover,
    invoices: results.length,
    reset,
    rcs: plan.rcs.map(rc => ({
      rcCode: rc.rcCode,
      cap: rc.cap,
      allotted: rc.allotted,
      invoiceCount: rc.assignments.length,
    })),
    results,
    rangePush,
  };
}

async function pushRcSerialAllotmentSummary({ actorName, plan, invoiceLinks }) {
  const endpoint = await resolveYesGatcWebhookUrl();
  if (!endpoint) {
    throw new Error('Add a YesGATC webhook destination URL in Serial numbers first.');
  }
  const rcs = plan.rcs
    .filter(rc => rc.allotted)
    .map(rc => ({
      rcCode: rc.rcCode,
      rcName: rc.rcName,
      dealerId: rc.customerId,
      dealerName: rc.dealerName,
      qty: rc.allotted,
      invoiceCount: rc.assignments.length,
      invoices: rc.assignments.map(row => ({
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        qty: row.allotted,
        startNumber: row.lines[0]?.serials[0] || null,
        endNumber: row.lines.at(-1)?.serials.at(-1) || null,
        serialNumbers: row.lines.flatMap(line => line.serials),
      })),
    }));
  const payload = {
    event: YESGATC_SERIAL_ALLOTMENT,
    type: YESGATC_SERIAL_ALLOTTED,
    source: 'yesone',
    sentAt: new Date().toISOString(),
    series: NON_GATC_SERIES,
    seriesLabel: 'non GATC',
    from: invoiceLinks[0]?.startNumber || 'G0001',
    to: invoiceLinks[invoiceLinks.length - 1]?.endNumber || 'G1082',
    qty: plan.used,
    minDate: plan.minDate,
    rcCount: rcs.length,
    invoiceCount: invoiceLinks.length,
    allotments: rcs.map(rc => ({
      series: NON_GATC_SERIES,
      seriesLabel: 'non GATC',
      from: rc.invoices[0]?.startNumber || null,
      to: rc.invoices.at(-1)?.endNumber || null,
      count: rc.qty,
      qty: rc.qty,
      serialNumbers: rc.invoices.flatMap(row => row.serialNumbers),
      invoiceLinks: rc.invoices.map(row => ({
        rcCode: rc.rcCode,
        rcName: rc.rcName,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.date,
        qty: row.qty,
        startNumber: row.startNumber,
        endNumber: row.endNumber,
        serialNumbers: row.serialNumbers,
      })),
    })),
    rcs,
    invoiceLinks,
  };
  const secret = await loadWebhookSecret();
  await postYesGatcWebhook(endpoint, secret, payload);
  return { ok: true, event: payload.event, qty: plan.used, invoices: invoiceLinks.length };
}
