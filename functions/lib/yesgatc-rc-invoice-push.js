/**
 * Push RC-dealer invoice serials + qty to the YesGATC destination URL
 * (same Settings → Serial numbers webhook).
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  isNonGatcSerialEligibleLine,
  isVoidInvoiceStatus,
  NON_GATC_MACHINE_HSN,
  NON_GATC_SERIES,
  SERIAL_NUMBER_ALLOTMENT_DOC,
} from './non-gatc-serial-allot.js';
import {
  postYesGatcWebhook,
  resolveYesGatcWebhookUrl,
  yesGatcSerialEvent,
} from './yesgatc-serial-push.js';
import { loadWebhookSecret } from './yesgatc-webhook.js';
import { loadDealerRcOffice } from './yesgatc-rc-offices.js';

function str(value) {
  return value == null ? '' : String(value).trim();
}

function isCompanyIwpRc(rc) {
  const code = str(rc?.code || rc?.rcCode).toUpperCase();
  if (code === 'IWP' || code.startsWith('IWP/') || code.startsWith('IWP-')) return true;
  const name = str(rc?.name || rc?.rcName).replace(/[\s\-_]+/g, '').toUpperCase();
  return name.includes('INTERWEIGHING');
}

function uniqueSerials(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = str(value);
    if (!text || seen.has(text.toUpperCase())) continue;
    seen.add(text.toUpperCase());
    out.push(text);
  }
  return out;
}

export async function findLinkedRcForDealer(customerId) {
  const db = getFirestore();
  const cid = str(customerId);
  if (!cid) return null;
  const snap = await db.collection('yesgatcRcDealerLinks')
    .where('dealerId', '==', cid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const link = snap.docs[0];
  const data = link.data() || {};
  const rcSnap = await db.collection('yesgatcRcDetails').doc(link.id).get();
  const rc = rcSnap.exists ? { id: rcSnap.id, ...rcSnap.data() } : { id: link.id, ...data };
  if (isCompanyIwpRc(rc) || isCompanyIwpRc(data)) return null;
  const office = await loadDealerRcOffice(db, {
    rcId: link.id,
    rcCode: data.rcCode || rc.code,
  });
  if (!office) return null;
  return {
    rcId: office.sourceRcId || link.id,
    rcCode: office.code,
    rcName: office.name,
    place: office.place || null,
    dealerId: cid,
    dealerName: str(data.dealerName) || office.dealerName,
  };
}

function lineIsDismantled(line) {
  return str(line?.description).toLowerCase().includes('dismantled condition')
    || isNonGatcSerialEligibleLine(line);
}

function parseSerialToken(raw) {
  const token = str(raw);
  if (!token) return null;
  const match = /^(.*?)(\d+)$/.exec(token);
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return { prefix: match[1], n };
}

function serialsInAllotmentRange(serials, row) {
  const from = parseSerialToken(row?.from);
  const to = parseSerialToken(row?.to);
  if (!from || !to || from.prefix !== to.prefix) return [];
  return (serials || []).filter(serial => {
    const parsed = parseSerialToken(serial);
    return parsed
      && parsed.prefix === from.prefix
      && parsed.n >= Math.min(from.n, to.n)
      && parsed.n <= Math.max(from.n, to.n);
  });
}

export async function syncAllotmentInvoiceLinks(db, {
  invoice,
  rc,
  serials = [],
  actorName = 'YESWEIGH',
  remove = false,
} = {}) {
  const ref = db.doc(SERIAL_NUMBER_ALLOTMENT_DOC);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() || {};
  const allotments = Array.isArray(data.allotments) ? data.allotments : [];
  const invoiceId = str(invoice?.id || invoice?.invoiceId);
  if (!invoiceId) return;
  const list = uniqueSerials(serials);
  let changed = false;
  const next = allotments.map(row => {
    if (str(row?.series) !== NON_GATC_SERIES) return row;
    const inRange = serialsInAllotmentRange(list, row);
    const links = Array.isArray(row.invoiceLinks) ? [...row.invoiceLinks] : [];
    const index = links.findIndex(link => str(link?.invoiceId) === invoiceId);
    if (remove || !inRange.length) {
      if (index < 0) return row;
      links.splice(index, 1);
      changed = true;
      return { ...row, invoiceLinks: links };
    }
    const link = {
      rcCode: str(rc?.rcCode) || null,
      rcName: str(rc?.rcName) || null,
      dealerId: str(rc?.dealerId) || null,
      dealerName: str(rc?.dealerName) || str(invoice?.customerName) || null,
      invoiceId,
      invoiceNumber: str(invoice?.invoiceNumber || invoice?.zohoInvoiceNumber) || null,
      invoiceDate: invoice?.date ? String(invoice.date).slice(0, 10) : null,
      qty: inRange.length,
      startNumber: inRange[0] || null,
      endNumber: inRange[inRange.length - 1] || null,
      serialNumbers: inRange,
    };
    if (index >= 0) links[index] = { ...links[index], ...link };
    else links.push(link);
    changed = true;
    return { ...row, invoiceLinks: links };
  });
  if (!changed) return;
  await ref.set({
    allotments: next,
    updatedAt: new Date().toISOString(),
    updatedBy: str(actorName) || 'YESWEIGH',
  }, { merge: true });
}

export function invoiceSerialPayload(invoice, rc, { action = 'upsert', alreadyPushed = false } = {}) {
  const machineHsn = new Set(NON_GATC_MACHINE_HSN);
  const lines = (Array.isArray(invoice.lineItems) ? invoice.lineItems : [])
    .filter(line => {
      const hsn = str(line?.hsn).replace(/\D/g, '');
      return isNonGatcSerialEligibleLine(line) || machineHsn.has(hsn);
    })
    .map(line => {
      const serialNumbers = uniqueSerials(line.serialNumbers);
      const qty = Math.max(serialNumbers.length, Math.round(Number(line.quantity) || 0));
      const dismantled = lineIsDismantled(line);
      return {
        id: str(line.id),
        name: str(line.name),
        sku: str(line.sku) || null,
        hsn: str(line.hsn) || null,
        qty,
        serialCount: serialNumbers.length,
        serialNumbers,
        startNumber: serialNumbers[0] || null,
        endNumber: serialNumbers[serialNumbers.length - 1] || null,
        dismantled,
        condition: dismantled ? 'dismantled' : null,
      };
    })
    .filter(line => action === 'unlink' || line.serialNumbers.length);
  const serialNumbers = uniqueSerials(lines.flatMap(line => line.serialNumbers));
  const qty = lines.reduce((sum, line) => sum + (line.serialCount || line.qty), 0) || serialNumbers.length;
  const event = yesGatcSerialEvent({ action, alreadyPushed });
  const invoiceLink = {
    rcCode: str(rc.rcCode) || null,
    rcName: str(rc.rcName) || null,
    dealerId: str(rc.dealerId) || null,
    dealerName: str(rc.dealerName) || str(invoice.customerName) || null,
    invoiceId: str(invoice.id) || null,
    invoiceNumber: str(invoice.invoiceNumber) || null,
    invoiceDate: invoice.date ? String(invoice.date).slice(0, 10) : null,
    qty,
    startNumber: serialNumbers[0] || null,
    endNumber: serialNumbers[serialNumbers.length - 1] || null,
    serialNumbers,
  };
  const allotment = {
    series: NON_GATC_SERIES,
    seriesLabel: 'non GATC',
    from: invoiceLink.startNumber,
    to: invoiceLink.endNumber,
    count: serialNumbers.length,
    qty,
    serialNumbers,
    invoiceLinks: [invoiceLink],
  };
  return {
    event,
    type: event,
    action,
    source: 'yesone',
    sentAt: new Date().toISOString(),
    condition: 'dismantled',
    series: NON_GATC_SERIES,
    seriesLabel: 'non GATC',
    allotments: [allotment],
    rc: {
      id: rc.rcId,
      name: rc.rcName,
      rcName: rc.rcName,
      code: rc.rcCode,
      rcCode: rc.rcCode,
      place: rc.place || null,
      dealerId: rc.dealerId || null,
      dealerName: rc.dealerName || str(invoice.customerName) || null,
    },
    invoice: {
      id: str(invoice.id),
      number: str(invoice.invoiceNumber),
      invoiceNumber: str(invoice.invoiceNumber),
      date: invoice.date ? String(invoice.date).slice(0, 10) : null,
      status: str(invoice.status) || null,
      customerId: rc.dealerId,
      customerName: str(invoice.customerName) || rc.dealerName,
      gstin: str(invoice.customerGstin) || null,
      shippingAddress: str(invoice.shippingAddress) || null,
      qty,
      serialCount: serialNumbers.length,
      startNumber: serialNumbers[0] || null,
      endNumber: serialNumbers[serialNumbers.length - 1] || null,
      serialNumbers,
      lines,
    },
  };
}

export async function pushRcInvoiceSerialsToYesGatc({
  customerId,
  invoiceId,
  actorName = 'YESWEIGH',
  force = false,
  action = 'upsert',
} = {}) {
  const db = getFirestore();
  const invoiceRef = db.doc(`zohoCustomers/${customerId}/invoices/${invoiceId}`);
  const snap = await invoiceRef.get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const data = { id: invoiceId, ...snap.data() };
  const kind = action === 'unlink' ? 'unlink' : 'upsert';

  if (isVoidInvoiceStatus(data.status) && kind !== 'unlink') {
    return { pushed: false, skipped: 'void', rc: null };
  }
  if (data.yesgatcRcPushedAt && !force && kind === 'upsert') {
    return {
      pushed: false,
      skipped: 'already_pushed',
      rc: {
        rcCode: str(data.yesgatcRcCode),
        rcName: str(data.yesgatcRcName),
      },
      pushedAt: data.yesgatcRcPushedAt,
    };
  }

  const rc = await findLinkedRcForDealer(customerId);
  if (!rc) {
    return { pushed: false, skipped: 'not_rc', rc: null };
  }

  const payload = invoiceSerialPayload(data, rc, {
    action: kind,
    alreadyPushed: Boolean(data.yesgatcRcPushedAt),
  });
  if (kind === 'upsert' && !payload.invoice.serialNumbers.length) {
    return { pushed: false, skipped: 'no_serials', rc };
  }

  const endpoint = await resolveYesGatcWebhookUrl();
  if (!endpoint) {
    return { pushed: false, skipped: 'no_webhook', rc };
  }

  const secret = await loadWebhookSecret();
  try {
    await postYesGatcWebhook(endpoint, secret, payload);
  } catch (err) {
    await invoiceRef.set({
      yesgatcRcPushError: String(err?.message || err).slice(0, 400),
    }, { merge: true });
    throw err;
  }

  const now = new Date().toISOString();
  const remaining = payload.invoice.serialNumbers;
  await invoiceRef.set(
    kind === 'unlink' && !remaining.length
      ? {
        yesgatcRcPushedAt: null,
        yesgatcRcPushedBy: null,
        yesgatcRcPushedAtServer: null,
        yesgatcRcPushError: null,
        yesgatcRcCode: rc.rcCode,
        yesgatcRcName: rc.rcName,
      }
      : {
        yesgatcRcPushedAt: now,
        yesgatcRcPushedBy: str(actorName) || 'YESWEIGH',
        yesgatcRcPushError: null,
        yesgatcRcCode: rc.rcCode,
        yesgatcRcName: rc.rcName,
        yesgatcRcPushedAtServer: FieldValue.serverTimestamp(),
      },
    { merge: true },
  );

  await syncAllotmentInvoiceLinks(db, {
    invoice: data,
    rc,
    serials: remaining,
    actorName,
    remove: kind === 'unlink' && !remaining.length,
  }).catch(err => {
    console.warn(`YesGATC allotment link sync failed for ${invoiceId}:`, err?.message ?? err);
  });

  return {
    pushed: true,
    skipped: null,
    action: kind,
    rc,
    qty: payload.invoice.qty,
    serials: remaining.length,
    invoiceNumber: str(data.invoiceNumber),
    invoiceDate: data.date ? String(data.date).slice(0, 10) : null,
    pushedAt: kind === 'unlink' && !remaining.length ? null : now,
  };
}

export async function pushRcInvoiceSerialsToYesGatcSafe(input) {
  try {
    return await pushRcInvoiceSerialsToYesGatc(input);
  } catch (err) {
    console.warn(
      `YesGATC RC invoice push failed for ${input?.invoiceId}:`,
      err?.message ?? err,
    );
    return {
      pushed: false,
      skipped: 'error',
      rc: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

