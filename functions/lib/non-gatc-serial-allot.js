/**
 * Non-GATC (dismantled) serials: warehouse picks unused serials from the
 * Settings → Serial numbers `non_gatc` pool. Invoice create/sync does not
 * auto-allot. Eligible: HSN 84238190 / 84238290 / 84231000 and not GATC-stamped.
 * Allot / unlink also PUT the Zoho invoice (line description).
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  authHeaders,
  getAccessToken,
  hasZohoJsonBody,
  resolveOrganizationId,
  ZOHO_API_BASE,
} from './zoho.js';
import {
  assertCanMutateSerialsAfterDelivery,
  isMandatorySerialExemptLine,
  lineIsMandatorySerialCategory,
} from './mandatory-serials.js';

export const NON_GATC_SERIES = 'non_gatc';
export const NON_GATC_MACHINE_HSN = Object.freeze(['84238190', '84238290', '84231000']);
export const NON_GATC_ALLOCATIONS = 'nonGatcSerialAllocations';
export const SERIAL_NUMBER_ALLOTMENT_DOC = 'appSettings/serialNumberAllotment';

const MACHINE_HSN = new Set(NON_GATC_MACHINE_HSN);

function str(value) {
  return value == null ? '' : String(value).trim();
}

function hsnDigits(value) {
  return str(value).replace(/\D/g, '');
}

export function compactSerialKey(raw) {
  return str(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isVoidInvoiceStatus(status) {
  const key = str(status).toLowerCase();
  return key === 'void' || key === 'cancelled' || key === 'canceled';
}

export function invoiceLineHasGatcTag(input) {
  if (Number(input?.gatcFeePerUnit) > 0) return true;
  if (str(input?.gatcStampingPriceId)) return true;
  const lower = str(input?.description).toLowerCase();
  if (!lower) return false;
  if (
    lower.includes('without stamping')
    || lower.includes('no stamping')
    || lower.includes('unstamped')
    || lower.includes('dismantled condition')
  ) {
    return false;
  }
  if (lower.includes('certified by gatc')) return true;
  if (lower.includes('verified, stamped')) return true;
  if (/\bwith\s+stamping\b/.test(lower)) return true;
  if (/stamping\s*:/.test(lower)) return true;
  return false;
}

export function isNonGatcSerialEligibleLine(line) {
  if (!line || typeof line !== 'object') return false;
  if (isMandatorySerialExemptLine(line)) return false;
  if (invoiceLineHasGatcTag(line)) return false;
  if (MACHINE_HSN.has(hsnDigits(line.hsn))) return true;
  return lineIsMandatorySerialCategory(line);
}

export function invoiceNeedsNonGatcSerials(lines) {
  return (Array.isArray(lines) ? lines : []).some(line => (
    isNonGatcSerialEligibleLine(line)
    && Math.max(0, Math.round(Number(line.quantity) || 0)) > (Array.isArray(line.serialNumbers) ? line.serialNumbers.length : 0)
  ));
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

function formatSerial(parsed, n) {
  return `${parsed.prefix}${padNumeric(n, parsed.width)}`;
}

const SERIAL_BLOCK_RE = /\n*Serial Numbers:\s*[^\n]*/gi;

function stripSerialBlockFromDescription(description) {
  return str(description).replace(SERIAL_BLOCK_RE, '').replace(/\s+$/g, '');
}

function withSerialBlockOnDescription(description, serials) {
  const base = stripSerialBlockFromDescription(description);
  const list = uniqueSerials(serials);
  if (!list.length) return base;
  const block = `Serial Numbers: ${list.join(', ')}`;
  return base ? `${base}\n${block}` : block;
}

export function applySerialsToLine(line, serials) {
  const serialNumbers = uniqueSerials(serials);
  return {
    ...line,
    serialNumbers,
    description: withSerialBlockOnDescription(line?.description, serialNumbers) || null,
  };
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

export function mergePreservedLineSerials(nextLines, existingLines) {
  const prevById = new Map(
    (Array.isArray(existingLines) ? existingLines : [])
      .map(line => [str(line?.id), line]),
  );
  return (Array.isArray(nextLines) ? nextLines : []).map(line => {
    const incoming = uniqueSerials(line?.serialNumbers);
    if (incoming.length) return applySerialsToLine(line, incoming);
    const prev = prevById.get(str(line?.id));
    const kept = uniqueSerials(prev?.serialNumbers);
    return kept.length ? applySerialsToLine(line, kept) : line;
  });
}

function expandNonGatcPool(allotments) {
  const out = [];
  for (const row of Array.isArray(allotments) ? allotments : []) {
    if (str(row?.series) !== NON_GATC_SERIES) continue;
    const from = parseSerialToken(row.from);
    const to = parseSerialToken(row.to);
    if (!from || !to || from.prefix !== to.prefix || from.n > to.n) continue;
    const width = Math.max(from.width, to.width);
    const canonical = { ...from, width };
    const missing = new Set((Array.isArray(row.missing) ? row.missing : []).map(compactSerialKey));
    for (let n = from.n; n <= to.n; n += 1) {
      const serial = formatSerial(canonical, n);
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

function lineNeed(line) {
  const qty = Math.max(0, Math.round(Number(line?.quantity) || 0));
  const have = uniqueSerials(line?.serialNumbers).length;
  return Math.max(0, qty - have);
}

export async function listAvailableNonGatcSerials(max = 2000) {
  const db = getFirestore();
  const allotSnap = await db.doc(SERIAL_NUMBER_ALLOTMENT_DOC).get();
  const pool = expandNonGatcPool(allotSnap.exists ? allotSnap.data()?.allotments : []);
  const taken = await loadTakenSerialKeys(db);
  const available = pool.filter(serial => !taken.has(compactSerialKey(serial)));
  const limit = Math.min(5000, Math.max(1, Number(max) || 2000));
  return available.slice(0, limit).map(serial => ({
    id: compactSerialKey(serial),
    serialNumber: serial,
  }));
}

async function loadTakenSerialKeys(db, exceptInvoiceId = '') {
  const taken = new Set();
  const snap = await db.collection(NON_GATC_ALLOCATIONS).get();
  snap.forEach(doc => {
    const data = doc.data() || {};
    if (exceptInvoiceId && str(data.invoiceId) === str(exceptInvoiceId)) return;
    taken.add(doc.id);
  });
  return taken;
}

async function releaseAllocationsForInvoice(db, invoiceId) {
  const snap = await db.collection(NON_GATC_ALLOCATIONS)
    .where('invoiceId', '==', str(invoiceId))
    .get();
  if (snap.empty) return [];
  const serials = [];
  const batch = db.batch();
  snap.forEach(doc => {
    serials.push(str(doc.data()?.serial) || doc.id);
    batch.delete(doc.ref);
  });
  await batch.commit();
  return serials;
}

/**
 * Release non-GATC pool serials and unlink GATC certificates for an invoice
 * that was voided, cancelled, or deleted in Zoho. Skips Zoho PUT so it still
 * works after the invoice is gone.
 */
export async function releaseInvoiceSerialLinks({
  customerId = '',
  invoiceId,
  invoiceNumber = '',
  data = {},
} = {}) {
  const db = getFirestore();
  const iid = str(invoiceId);
  let cid = str(customerId || data?.customerId);
  let invoiceData = data && typeof data === 'object' ? { ...data } : {};

  if (iid && !cid) {
    const indexSnap = await db.doc(`invoiceIndex/${iid}`).get();
    if (indexSnap.exists) cid = str(indexSnap.data()?.customerId);
  }
  if (iid && cid) {
    const snap = await db.doc(`zohoCustomers/${cid}/invoices/${iid}`).get();
    if (snap.exists) invoiceData = { ...snap.data(), ...invoiceData, id: iid, customerId: cid };
  }
  if (!str(invoiceData.invoiceNumber) && invoiceNumber) {
    invoiceData.invoiceNumber = str(invoiceNumber);
  }

  const released = iid ? await releaseAllocationsForInvoice(db, iid) : [];
  let gatcReleased = 0;
  try {
    const { releaseGatcStampedSerialsOnVoid } = await import('./yesgatc-stamped-serial-allot.js');
    const gatc = await releaseGatcStampedSerialsOnVoid({
      customerId: cid,
      invoiceId: iid,
      data: { id: iid, ...invoiceData },
      lines: Array.isArray(invoiceData.lineItems) ? invoiceData.lineItems : [],
    });
    gatcReleased = Number(gatc.released) || 0;
  } catch (err) {
    console.warn(`GATC unlink on invoice remove failed for ${iid}:`, err?.message ?? err);
  }

  return {
    released: released.length + gatcReleased,
    serials: released,
    gatcReleased,
  };
}

function isGoneInvoiceStatus(status) {
  return isVoidInvoiceStatus(status);
}

/** One-shot / webhook repair: allocations and GATC links whose invoice is gone or void. */
export async function releaseOrphanedInvoiceSerialLinks() {
  const db = getFirestore();
  const summary = {
    allocationsReleased: 0,
    certificatesUnlinked: 0,
    invoices: [],
  };

  const invoiceIds = new Set();
  const allocSnap = await db.collection(NON_GATC_ALLOCATIONS).get();
  allocSnap.forEach(doc => {
    const iid = str(doc.data()?.invoiceId);
    if (iid) invoiceIds.add(iid);
  });

  const collectInvoiceId = (value) => {
    const iid = str(value);
    if (iid) invoiceIds.add(iid);
  };

  const certSnap = await db.collection('yesgatcCertificates')
    .where('invoiceId', '>', '')
    .get()
    .catch(() => null);
  if (certSnap) {
    certSnap.forEach(doc => collectInvoiceId(doc.data()?.invoiceId));
  }

  const linkSnap = await db.collection('yesgatcSerialLinks')
    .where('invoiceId', '>', '')
    .get()
    .catch(() => null);
  if (linkSnap) {
    linkSnap.forEach(doc => collectInvoiceId(doc.data()?.invoiceId));
  }

  for (const invoiceId of invoiceIds) {
    const indexSnap = await db.doc(`invoiceIndex/${invoiceId}`).get();
    const cid = str(indexSnap.data()?.customerId);
    let gone = !indexSnap.exists || !cid;
    let invoiceData = {};
    if (!gone) {
      const snap = await db.doc(`zohoCustomers/${cid}/invoices/${invoiceId}`).get();
      if (!snap.exists || isGoneInvoiceStatus(snap.data()?.status)) {
        gone = true;
        invoiceData = snap.exists ? (snap.data() || {}) : {};
      }
    }
    if (!gone) continue;
    const result = await releaseInvoiceSerialLinks({
      customerId: cid,
      invoiceId,
      data: invoiceData,
    });
    if (result.released) {
      summary.allocationsReleased += (result.serials || []).length;
      summary.certificatesUnlinked += Number(result.gatcReleased) || 0;
      summary.invoices.push({
        invoiceId,
        customerId: cid || null,
        released: result.released,
        serials: result.serials,
      });
    }
  }

  return summary;
}

function stripReleasedSerials(lines, releasedKeys) {
  const keys = new Set((releasedKeys || []).map(compactSerialKey));
  if (!keys.size) return Array.isArray(lines) ? lines : [];
  return (Array.isArray(lines) ? lines : []).map(line => {
    const serials = uniqueSerials(line?.serialNumbers).filter(serial => !keys.has(compactSerialKey(serial)));
    return applySerialsToLine(line, serials);
  });
}

function isMachineScaleLine(line) {
  return MACHINE_HSN.has(hsnDigits(line?.hsn));
}

function serialsByMachineLineId(lines) {
  const map = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!isMachineScaleLine(line)) continue;
    map.set(str(line.id), uniqueSerials(line.serialNumbers));
  }
  return map;
}

function lineItemsForInvoiceSerialPut(zohoInvoice, serialsByLineId) {
  const items = Array.isArray(zohoInvoice?.line_items) ? zohoInvoice.line_items : [];
  return items.map(item => {
    const line = {
      item_id: item.item_id,
      name: item.name,
      rate: item.rate,
      quantity: item.quantity,
      unit: item.unit || 'pcs',
    };
    if (item.line_item_id) line.line_item_id = item.line_item_id;
    if (item.hsn_or_sac) line.hsn_or_sac = item.hsn_or_sac;
    if (item.tax_id) line.tax_id = item.tax_id;
    if (
      item.warehouse_id != null
      && String(item.warehouse_id).trim()
    ) {
      line.warehouse_id = String(item.warehouse_id).trim();
    }
    const key = str(item.line_item_id);
    if (serialsByLineId.has(key)) {
      line.description = withSerialBlockOnDescription(item.description, serialsByLineId.get(key));
    } else if (item.description) {
      line.description = item.description;
    }
    return line;
  }).filter(line => line.item_id && Number(line.quantity) > 0);
}

async function zohoInventoryJson(accessToken, orgId, path, { method = 'GET', body } = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  const sendBody = hasZohoJsonBody(body);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(sendBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(sendBody ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok || (payload?.code != null && payload.code !== 0)) {
    throw new Error(payload?.message || `Zoho invoice ${method} failed.`);
  }
  return payload;
}

async function resolveZohoAuth({ accessToken, orgId, secrets, configuredOrgId } = {}) {
  if (accessToken && orgId) return { accessToken, orgId };
  if (!secrets) return null;
  const token = await getAccessToken(secrets);
  return {
    accessToken: token,
    orgId: await resolveOrganizationId(token, configuredOrgId || orgId),
  };
}

async function pushSerialsToZohoInvoice({
  accessToken,
  orgId,
  secrets,
  configuredOrgId,
  invoiceId,
  lines,
} = {}) {
  const auth = await resolveZohoAuth({ accessToken, orgId, secrets, configuredOrgId });
  if (!auth) return { zohoPushed: false, zohoError: 'Zoho credentials missing.' };
  const payload = await zohoInventoryJson(
    auth.accessToken,
    auth.orgId,
    `/invoices/${encodeURIComponent(invoiceId)}`,
  );
  const zohoInvoice = payload?.invoice;
  if (!zohoInvoice) throw new Error('Zoho invoice not found.');
  await zohoInventoryJson(
    auth.accessToken,
    auth.orgId,
    `/invoices/${encodeURIComponent(invoiceId)}`,
    {
      method: 'PUT',
      body: {
        customer_id: zohoInvoice.customer_id,
        date: zohoInvoice.date,
        line_items: lineItemsForInvoiceSerialPut(zohoInvoice, serialsByMachineLineId(lines)),
      },
    },
  );
  try {
    const { refreshInvoicePdfFromZoho } = await import('./invoice-sync.js');
    await refreshInvoicePdfFromZoho(
      auth.accessToken,
      auth.orgId,
      String(zohoInvoice.customer_id || ''),
      invoiceId,
    );
  } catch (err) {
    console.warn(
      `Invoice PDF refresh after serial update failed for ${invoiceId}:`,
      err?.message ?? err,
    );
  }
  return { zohoPushed: true, zohoError: '' };
}

export async function pushSerialsToZohoInvoiceSafe(input) {
  try {
    return await pushSerialsToZohoInvoice(input);
  } catch (err) {
    const zohoError = err instanceof Error ? err.message : 'Could not update Zoho invoice.';
    console.warn(`Zoho invoice serial update failed for ${input?.invoiceId}:`, zohoError);
    return { zohoPushed: false, zohoError };
  }
}

export async function voidZohoInvoice({
  accessToken,
  orgId,
  secrets,
  configuredOrgId,
  invoiceId,
  reason = '',
} = {}) {
  const id = str(invoiceId);
  if (!id) throw new Error('Invoice is required.');
  const auth = await resolveZohoAuth({ accessToken, orgId, secrets, configuredOrgId });
  if (!auth) throw new Error('Zoho credentials missing.');
  const note = str(reason).slice(0, 500);
  try {
    await zohoInventoryJson(
      auth.accessToken,
      auth.orgId,
      `/invoices/${encodeURIComponent(id)}/status/void`,
      {
        method: 'POST',
        body: note ? { reason: note } : {},
      },
    );
  } catch (err) {
    const message = str(err?.message);
    if (!/already\s+void/i.test(message)) throw err;
  }
  return { invoiceId: id, status: 'void' };
}

export async function applyNonGatcSerialAllotmentOnInvoice({
  customerId,
  invoiceId,
  actorName = 'YESWEIGH',
  force = false,
  forceRelease = false,
  serials = [],
  lineId = '',
  allowWhenDelivered = false,
  accessToken,
  orgId,
  secrets,
  configuredOrgId,
} = {}) {
  const db = getFirestore();
  const invoiceRef = db.doc(`zohoCustomers/${customerId}/invoices/${invoiceId}`);
  const snap = await invoiceRef.get();
  if (!snap.exists) {
    throw new Error('Invoice not found.');
  }
  const data = snap.data() || {};
  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  if (!forceRelease) assertCanMutateSerialsAfterDelivery(data, allowWhenDelivered);

  if (isVoidInvoiceStatus(data.status) || forceRelease) {
    const released = await releaseAllocationsForInvoice(db, invoiceId);
    let workingLines = lines;
    let gatcReleased = 0;
    try {
      const { releaseGatcStampedSerialsOnVoid } = await import('./yesgatc-stamped-serial-allot.js');
      const gatc = await releaseGatcStampedSerialsOnVoid({
        customerId,
        invoiceId,
        data,
        lines: workingLines,
      });
      workingLines = gatc.lineItems || workingLines;
      gatcReleased = Number(gatc.released) || 0;
    } catch (err) {
      console.warn(`GATC stamped unlink on void failed for ${invoiceId}:`, err?.message ?? err);
    }
    if (!released.length && !gatcReleased && !Array.isArray(data.nonGatcAllocatedSerials)) {
      return { allotted: 0, released: 0, shortage: 0, voided: true, lineItems: workingLines };
    }
    const nextLines = stripReleasedSerials(
      workingLines,
      released.concat(data.nonGatcAllocatedSerials || []),
    );
    await invoiceRef.set({
      lineItems: nextLines,
      nonGatcAllocatedSerials: [],
      nonGatcSerialAllottedAt: null,
      gatcStampedAllocatedSerials: [],
      gatcStampedSerialAllottedAt: null,
      gatcStampedSerialAllottedBy: null,
      yesgatcLinks: [],
      yesgatcLinkedAt: null,
    }, { merge: true });
    const zoho = await pushSerialsToZohoInvoiceSafe({
      accessToken,
      orgId,
      secrets,
      configuredOrgId,
      invoiceId,
      lines: nextLines,
    });
    return {
      allotted: 0,
      released: released.length + gatcReleased,
      shortage: 0,
      voided: true,
      lineItems: nextLines,
      ...zoho,
    };
  }

  const eligible = lines.filter(isNonGatcSerialEligibleLine);
  const needed = eligible.reduce((sum, line) => sum + lineNeed(line), 0);
  const selected = uniqueSerials(serials);
  if (!selected.length) {
    return { allotted: 0, released: 0, shortage: needed, voided: false, lineItems: lines };
  }
  if (!needed && !force) {
    return { allotted: 0, released: 0, shortage: 0, voided: false, lineItems: lines };
  }

  const allotSnap = await db.doc(SERIAL_NUMBER_ALLOTMENT_DOC).get();
  const pool = expandNonGatcPool(allotSnap.exists ? allotSnap.data()?.allotments : []);
  const poolKeys = new Set(pool.map(compactSerialKey));
  const taken = await loadTakenSerialKeys(db, invoiceId);
  for (const line of lines) {
    for (const serial of uniqueSerials(line?.serialNumbers)) {
      taken.add(compactSerialKey(serial));
    }
  }

  const available = [];
  const seenPick = new Set();
  for (const serial of selected) {
    const key = compactSerialKey(serial);
    if (!key || seenPick.has(key)) continue;
    if (!poolKeys.has(key)) {
      throw new Error(`${serial} is not in the non-GATC allotted list.`);
    }
    if (taken.has(key)) {
      throw new Error(`${serial} is already linked to an invoice.`);
    }
    seenPick.add(key);
    available.push(pool.find(item => compactSerialKey(item) === key) || serial);
  }
  if (!available.length) {
    return { allotted: 0, released: 0, shortage: needed, voided: false, lineItems: lines };
  }

  const targetLineId = str(lineId);
  const targetNeed = targetLineId
    ? lineNeed(lines.find(line => str(line.id) === targetLineId) || {})
    : needed;
  if (available.length !== targetNeed) {
    throw new Error(
      `Select exactly ${targetNeed} serial${targetNeed === 1 ? '' : 's'} from the available list.`,
    );
  }

  let cursor = 0;
  let allotted = 0;
  const newAllocations = [];
  const nextLines = lines.map(line => {
    if (!isNonGatcSerialEligibleLine(line)) return line;
    if (targetLineId && str(line.id) !== targetLineId) return line;
    const need = lineNeed(line);
    if (!need) return line;
    const take = available.slice(cursor, cursor + need);
    cursor += take.length;
    if (!take.length) return line;
    allotted += take.length;
    const serialNumbers = uniqueSerials([...(line.serialNumbers || []), ...take]);
    for (const serial of take) {
      newAllocations.push({
        serial,
        lineId: str(line.id),
      });
    }
    return applySerialsToLine(line, serialNumbers);
  });

  let rc = null;
  try {
    const { findLinkedRcForDealer } = await import('./yesgatc-rc-invoice-push.js');
    rc = await findLinkedRcForDealer(customerId);
  } catch {
    rc = null;
  }

  if (newAllocations.length) {
    const now = new Date().toISOString();
    let batch = db.batch();
    let count = 0;
    for (const row of newAllocations) {
      batch.set(db.collection(NON_GATC_ALLOCATIONS).doc(compactSerialKey(row.serial)), {
        serial: row.serial,
        invoiceId: str(invoiceId),
        invoiceNumber: str(data.invoiceNumber || data.zohoInvoiceNumber) || null,
        customerId: str(customerId),
        lineId: row.lineId,
        rcCode: rc?.rcCode || null,
        rcName: rc?.rcName || null,
        allottedAt: now,
        allottedBy: str(actorName) || 'YESWEIGH',
      });
      count += 1;
      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count) await batch.commit();
  }

  const allocatedSerials = uniqueSerials([
    ...(Array.isArray(data.nonGatcAllocatedSerials) ? data.nonGatcAllocatedSerials : []),
    ...newAllocations.map(row => row.serial),
  ]);

  if (allotted) {
    await invoiceRef.set({
      lineItems: nextLines,
      nonGatcAllocatedSerials: allocatedSerials,
      nonGatcSerialAllottedAt: FieldValue.serverTimestamp(),
      nonGatcSerialAllottedBy: str(actorName) || 'YESWEIGH',
      ...(rc ? {
        yesgatcRcCode: rc.rcCode,
        yesgatcRcName: rc.rcName,
      } : {}),
    }, { merge: true });
  }

  const pushLines = allotted ? nextLines : lines;
  const hasSerials = [...serialsByMachineLineId(pushLines).values()].some(list => list.length);
  const zoho = (allotted || (force && hasSerials))
    ? await pushSerialsToZohoInvoiceSafe({
      accessToken,
      orgId,
      secrets,
      configuredOrgId,
      invoiceId,
      lines: pushLines,
    })
    : { zohoPushed: false, zohoError: '' };

  let yesgatc = { pushed: false, skipped: rc ? null : 'not_rc' };
  if (allotted && rc) {
    const { pushRcInvoiceSerialsToYesGatcSafe } = await import('./yesgatc-rc-invoice-push.js');
    yesgatc = await pushRcInvoiceSerialsToYesGatcSafe({
      customerId,
      invoiceId,
      actorName,
      force: true,
    });
  }

  return {
    allotted,
    released: 0,
    shortage: Math.max(0, needed - allotted),
    voided: false,
    lineItems: allotted ? nextLines : lines,
    ...zoho,
    yesgatcPushed: Boolean(yesgatc.pushed),
    yesgatcSkipped: yesgatc.skipped || null,
    yesgatcError: yesgatc.error || null,
  };
}

export async function unlinkNonGatcSerialsFromInvoice({
  customerId,
  invoiceId,
  lineId = '',
  actorName = 'YESWEIGH',
  allowWhenDelivered = false,
  accessToken,
  orgId,
  secrets,
  configuredOrgId,
} = {}) {
  const db = getFirestore();
  const invoiceRef = db.doc(`zohoCustomers/${customerId}/invoices/${invoiceId}`);
  const snap = await invoiceRef.get();
  if (!snap.exists) {
    throw new Error('Invoice not found.');
  }
  const data = snap.data() || {};
  const lines = Array.isArray(data.lineItems) ? data.lineItems : [];
  assertCanMutateSerialsAfterDelivery(data, allowWhenDelivered);
  const targetLineId = str(lineId);

  const toRelease = [];
  for (const line of lines) {
    if (targetLineId && str(line.id) !== targetLineId) continue;
    if (!isNonGatcSerialEligibleLine(line) && !uniqueSerials(line?.serialNumbers).length) continue;
    toRelease.push(...uniqueSerials(line?.serialNumbers));
  }
  if (!toRelease.length && Array.isArray(data.nonGatcAllocatedSerials) && !targetLineId) {
    toRelease.push(...uniqueSerials(data.nonGatcAllocatedSerials));
  }

  const released = uniqueSerials(toRelease);
  if (!released.length) {
    return {
      allotted: 0,
      released: 0,
      shortage: 0,
      voided: isVoidInvoiceStatus(data.status),
      lineItems: lines,
      zohoPushed: false,
      zohoError: '',
    };
  }

  const releasedKeys = new Set(released.map(compactSerialKey));
  let batch = db.batch();
  let count = 0;
  for (const serial of released) {
    batch.delete(db.collection(NON_GATC_ALLOCATIONS).doc(compactSerialKey(serial)));
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();

  const nextLines = stripReleasedSerials(lines, released);
  const remaining = uniqueSerials([
    ...(Array.isArray(data.nonGatcAllocatedSerials) ? data.nonGatcAllocatedSerials : []),
  ]).filter(serial => !releasedKeys.has(compactSerialKey(serial)));

  await invoiceRef.set({
    lineItems: nextLines,
    nonGatcAllocatedSerials: remaining,
    nonGatcSerialAllottedAt: remaining.length ? data.nonGatcSerialAllottedAt ?? null : null,
    nonGatcSerialAllottedBy: remaining.length
      ? data.nonGatcSerialAllottedBy ?? (str(actorName) || 'YESWEIGH')
      : null,
    yesgatcRcPushedAt: null,
    yesgatcRcPushedBy: null,
    yesgatcRcCode: null,
    yesgatcRcName: null,
    yesgatcRcPushError: null,
  }, { merge: true });

  const zoho = await pushSerialsToZohoInvoiceSafe({
    accessToken,
    orgId,
    secrets,
    configuredOrgId,
    invoiceId,
    lines: nextLines,
  });

  let yesgatc = { pushed: false, skipped: null };
  const { pushRcInvoiceSerialsToYesGatcSafe } = await import('./yesgatc-rc-invoice-push.js');
  yesgatc = await pushRcInvoiceSerialsToYesGatcSafe({
    customerId,
    invoiceId,
    actorName,
    force: true,
    action: remaining.length ? 'upsert' : 'unlink',
  });

  return {
    allotted: 0,
    released: released.length,
    shortage: 0,
    voided: isVoidInvoiceStatus(data.status),
    lineItems: nextLines,
    ...zoho,
    yesgatcPushed: Boolean(yesgatc.pushed),
    yesgatcSkipped: yesgatc.skipped || null,
    yesgatcError: yesgatc.error || null,
  };
}
