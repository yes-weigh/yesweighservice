/**
 * YesOne → YesGATC sold (allotted) qty per dealer RC.
 * Uses the event YesGATC already handles: rc.ov_quota.
 * Sends Sold only — YesGATC owns OV / Linked / Balance.
 */
import { loadYesGatcRcOvQuota } from './rc-nongatc-serial-backfill.js';
import { loadWebhookSecret } from './yesgatc-webhook.js';
import {
  postYesGatcWebhook,
  resolveYesGatcWebhookUrl,
} from './yesgatc-serial-push.js';

export const YESGATC_RC_OV_QUOTA = 'rc.ov_quota';

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
