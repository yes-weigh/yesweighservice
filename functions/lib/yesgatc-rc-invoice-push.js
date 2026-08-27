/**
 * Push RC-dealer invoice serials + qty to the YesGATC destination URL
 * (same Settings → Serial numbers webhook).
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  isNonGatcSerialEligibleLine,
  isVoidInvoiceStatus,
} from './non-gatc-serial-allot.js';
import {
  normalizeHttpsWebhookUrl,
  postYesGatcWebhook,
  SERIAL_NUMBER_ALLOTMENT_DOC,
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
    dealerId: cid,
    dealerName: str(data.dealerName) || office.dealerName,
  };
}

function invoiceSerialPayload(invoice, rc) {
  const lines = (Array.isArray(invoice.lineItems) ? invoice.lineItems : [])
    .filter(line => isNonGatcSerialEligibleLine(line))
    .map(line => {
      const serialNumbers = uniqueSerials(line.serialNumbers);
      const qty = Math.max(serialNumbers.length, Math.round(Number(line.quantity) || 0));
      return {
        id: str(line.id),
        name: str(line.name),
        sku: str(line.sku) || null,
        hsn: str(line.hsn) || null,
        qty,
        serialNumbers,
      };
    })
    .filter(line => line.serialNumbers.length);
  const serialNumbers = uniqueSerials(lines.flatMap(line => line.serialNumbers));
  const qty = lines.reduce((sum, line) => sum + line.qty, 0) || serialNumbers.length;
  return {
    event: 'rc_invoice_serials',
    source: 'yesone',
    sentAt: new Date().toISOString(),
    rc: {
      id: rc.rcId,
      name: rc.rcName,
      code: rc.rcCode,
    },
    invoice: {
      id: str(invoice.id),
      number: str(invoice.invoiceNumber),
      date: invoice.date ? String(invoice.date).slice(0, 10) : null,
      customerId: rc.dealerId,
      customerName: str(invoice.customerName) || rc.dealerName,
      qty,
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
} = {}) {
  const db = getFirestore();
  const invoiceRef = db.doc(`zohoCustomers/${customerId}/invoices/${invoiceId}`);
  const snap = await invoiceRef.get();
  if (!snap.exists) throw new Error('Invoice not found.');
  const data = { id: invoiceId, ...snap.data() };

  if (isVoidInvoiceStatus(data.status)) {
    return { pushed: false, skipped: 'void', rc: null };
  }
  if (data.yesgatcRcPushedAt && !force) {
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

  const payload = invoiceSerialPayload(data, rc);
  if (!payload.invoice.serialNumbers.length) {
    return { pushed: false, skipped: 'no_serials', rc };
  }

  const allotSnap = await db.doc(SERIAL_NUMBER_ALLOTMENT_DOC).get();
  const endpoint = normalizeHttpsWebhookUrl(allotSnap.exists ? allotSnap.data()?.webhookUrl : '');
  if (!endpoint) {
    throw new Error('Add a YesGATC webhook destination URL in Serial numbers first.');
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
  await invoiceRef.set({
    yesgatcRcPushedAt: now,
    yesgatcRcPushedBy: str(actorName) || 'YESWEIGH',
    yesgatcRcPushError: null,
    yesgatcRcCode: rc.rcCode,
    yesgatcRcName: rc.rcName,
    yesgatcRcPushedAtServer: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    pushed: true,
    skipped: null,
    rc,
    qty: payload.invoice.qty,
    serials: payload.invoice.serialNumbers.length,
    pushedAt: now,
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
