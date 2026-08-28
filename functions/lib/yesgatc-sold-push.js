/**
 * YesOne → YesGATC sold (allotted) qty per dealer RC.
 * Uses the event YesGATC already handles: rc.ov_quota.
 * Sends Sold only — YesGATC owns OV / Linked / Balance.
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  isVoidInvoiceStatus,
  NON_GATC_MACHINE_HSN,
} from './non-gatc-serial-allot.js';
import {
  loadDealerNeedInvoices,
  loadYesGatcRcOvQuota,
  RC_NONGATC_MIN_DATE,
} from './rc-nongatc-serial-backfill.js';
import { loadWebhookSecret } from './yesgatc-webhook.js';
import {
  postYesGatcWebhook,
  resolveYesGatcWebhookUrl,
} from './yesgatc-serial-push.js';

export const YESGATC_RC_OV_QUOTA = 'rc.ov_quota';

const MACHINE_HSN = new Set(NON_GATC_MACHINE_HSN);

function str(value) {
  return value == null ? '' : String(value).trim();
}

function invoiceDateKey(value) {
  const text = str(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

/** Machine HSN qty that counts toward RC Sold (from 1 Feb 2026, not void). */
export function invoiceMachineSoldQty(invoice) {
  if (!invoice || typeof invoice !== 'object') return 0;
  if (isVoidInvoiceStatus(invoice.status)) return 0;
  const date = invoiceDateKey(invoice.date);
  if (!date || date < RC_NONGATC_MIN_DATE) return 0;
  let qty = 0;
  for (const line of Array.isArray(invoice.lineItems) ? invoice.lineItems : []) {
    const hsn = str(line?.hsn).replace(/\D/g, '');
    if (!MACHINE_HSN.has(hsn)) continue;
    qty += Math.max(0, Math.round(Number(line.quantity) || 0));
  }
  return qty;
}

export async function pushRcSoldToYesGatc({ actorName = 'YESWEIGH' } = {}) {
  const endpoint = await resolveYesGatcWebhookUrl();
  if (!endpoint) {
    throw new Error('Paste the YesGATC webhook URL in Settings → Serial numbers first.');
  }

  const rows = await loadYesGatcRcOvQuota();
  const rcs = rows.map(row => ({
    rcCode: row.rcCode,
    rcName: row.rcName,
    dealerId: row.dealerId || null,
    dealerName: row.dealerName || null,
    allotted: Number(row.sold) || 0,
    sold: Number(row.sold) || 0,
    qty: Number(row.sold) || 0,
  }));

  const payload = {
    event: YESGATC_RC_OV_QUOTA,
    type: YESGATC_RC_OV_QUOTA,
    source: 'yesone',
    sentAt: new Date().toISOString(),
    sentBy: String(actorName || 'YESWEIGH').trim() || 'YESWEIGH',
    rcs,
    totals: {
      rcCount: rcs.length,
      sold: rcs.reduce((sum, row) => sum + (Number(row.sold) || 0), 0),
    },
  };

  const secret = await loadWebhookSecret();
  await postYesGatcWebhook(endpoint, secret, payload);
  return {
    ok: true,
    event: payload.event,
    rcCount: payload.totals.rcCount,
    sold: payload.totals.sold,
    rcs,
  };
}

/** One RC sold snapshot after an RC invoice is added, changed, or deleted. */
export async function pushOneRcSoldToYesGatc({
  rc,
  customerId,
  actorName = 'YESWEIGH',
  invoice = null,
  reason = null,
  delta = null,
} = {}) {
  const endpoint = await resolveYesGatcWebhookUrl();
  if (!endpoint) {
    return { pushed: false, skipped: 'no_webhook', sold: 0 };
  }
  const cid = str(customerId || rc?.dealerId);
  if (!cid || !str(rc?.rcCode)) {
    return { pushed: false, skipped: 'not_rc', sold: 0 };
  }

  const loaded = await loadDealerNeedInvoices(getFirestore(), cid, RC_NONGATC_MIN_DATE);
  const sold = Number(loaded.sold) || 0;
  const serialAllotted = Number(loaded.allotted) || 0;
  const row = {
    rcCode: str(rc.rcCode),
    rcName: str(rc.rcName) || null,
    dealerId: str(rc.dealerId) || cid,
    dealerName: str(rc.dealerName) || null,
    allotted: sold,
    sold,
    qty: sold,
    serialAllotted,
  };
  const payload = {
    event: YESGATC_RC_OV_QUOTA,
    type: YESGATC_RC_OV_QUOTA,
    source: 'yesone',
    sentAt: new Date().toISOString(),
    sentBy: str(actorName) || 'YESWEIGH',
    rcs: [row],
    invoice: invoice
      ? {
        id: str(invoice.id || invoice.invoiceId) || null,
        number: str(invoice.invoiceNumber || invoice.number) || null,
        invoiceNumber: str(invoice.invoiceNumber || invoice.number) || null,
        date: invoice.date ? String(invoice.date).slice(0, 10) : null,
      }
      : null,
    reason: reason || null,
    delta: Number.isFinite(Number(delta)) ? Number(delta) : null,
    totals: { rcCount: 1, sold },
  };

  const secret = await loadWebhookSecret();
  await postYesGatcWebhook(endpoint, secret, payload);
  return {
    pushed: true,
    skipped: null,
    sold,
    serialAllotted,
    rcCode: row.rcCode,
  };
}

export async function pushOneRcSoldToYesGatcSafe(input) {
  try {
    return await pushOneRcSoldToYesGatc(input);
  } catch (err) {
    console.warn(
      `YesGATC RC sold push failed for ${input?.rc?.rcCode || input?.customerId}:`,
      err?.message ?? err,
    );
    return {
      pushed: false,
      skipped: 'error',
      sold: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * RC dealers only: when a weighing-scale HSN invoice is added or deleted
 * (or its machine qty / void status changes), push the new Sold total.
 */
export async function notifyRcSoldAfterInvoiceChangeSafe({
  customerId,
  invoiceId,
  before = null,
  after = null,
  actorName = 'invoice-sync',
} = {}) {
  const cid = str(customerId);
  if (!cid) return { pushed: false, skipped: 'not_rc', delta: 0 };

  const { findLinkedRcForDealer } = await import('./yesgatc-rc-invoice-push.js');
  const rc = await findLinkedRcForDealer(cid);
  if (!rc) return { pushed: false, skipped: 'not_rc', delta: 0 };

  const prevQty = invoiceMachineSoldQty(before);
  const nextQty = invoiceMachineSoldQty(after);
  const delta = nextQty - prevQty;
  if (!delta) return { pushed: false, skipped: 'unchanged', delta: 0, rc };

  const reason = !before && after
    ? 'invoice_added'
    : !after && before
      ? 'invoice_removed'
      : delta > 0 ? 'invoice_qty_up' : 'invoice_qty_down';

  const result = await pushOneRcSoldToYesGatcSafe({
    rc,
    customerId: cid,
    actorName,
    invoice: after || before,
    reason,
    delta,
  });

  const id = str(invoiceId || after?.id || before?.id);
  if (result.pushed && after && id) {
    try {
      await getFirestore().doc(`zohoCustomers/${cid}/invoices/${id}`).set({
        yesgatcRcSoldPushedAt: new Date().toISOString(),
        yesgatcRcSoldPushedAtServer: FieldValue.serverTimestamp(),
        yesgatcRcSoldQty: result.sold,
        yesgatcRcCode: rc.rcCode,
        yesgatcRcName: rc.rcName,
      }, { merge: true });
    } catch (err) {
      console.warn(`YesGATC sold mark failed for ${id}:`, err?.message ?? err);
    }
  }

  return { ...result, delta, reason, rc };
}
