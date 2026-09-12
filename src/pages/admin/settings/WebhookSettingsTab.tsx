import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { copyTextToClipboard } from '../../../lib/clipboard';
import {
  ensureYesGatcWebhookSettings,
  type YesGatcWebhookSettings,
} from '../../../lib/yesgatcRecords';
import {
  loadZohoWebhookSettings,
  refreshZohoApiUsage,
  setZohoWebhookEnforce,
  subscribeZohoApiUsage,
  type ZohoApiUsage,
  type ZohoWebhookSettings,
} from '../../../lib/zohoApiUsage';

function CopyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyTextToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="yesgatc-webhook__field">
      <span>{label}</span>
      <div className="yesgatc-webhook__copy-row">
        <input readOnly value={value} onFocus={event => event.currentTarget.select()} />
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export const WebhookSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<YesGatcWebhookSettings | null>(null);
  const [zoho, setZoho] = useState<ZohoWebhookSettings | null>(null);
  const [usage, setUsage] = useState<ZohoApiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zohoBusy, setZohoBusy] = useState(false);
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [gatc, zohoSettings] = await Promise.all([
        ensureYesGatcWebhookSettings(actorName),
        loadZohoWebhookSettings().catch(() => null),
      ]);
      setSettings(gatc);
      setZoho(zohoSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load webhook settings.');
    } finally {
      setLoading(false);
    }
  }, [actorName]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeZohoApiUsage(setUsage), []);

  const handleEnforce = async (enforce: boolean) => {
    setZohoBusy(true);
    setError('');
    try {
      const next = await setZohoWebhookEnforce(enforce);
      setZoho(current => (current ? { ...current, ...next } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Zoho signature enforcement.');
    } finally {
      setZohoBusy(false);
    }
  };

  const handleRefreshUsage = async () => {
    setZohoBusy(true);
    setError('');
    try {
      setUsage(await refreshZohoApiUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh Zoho API usage.');
    } finally {
      setZohoBusy(false);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <h3>Webhook</h3>
      </header>

      {error ? <p className="settings-locations__error">{error}</p> : null}
      {loading ? (
        <p className="settings-locations__loading">Loading webhook…</p>
      ) : (
        <>
          <div className="yesgatc-webhook">
            <h4>Zoho Books / Inventory</h4>
            {usage ? (
              <p className="text-muted text-sm">
                Today: {usage.callsToday.toLocaleString('en-IN')} / {usage.dailyLimit.toLocaleString('en-IN')}
                {' '}({usage.remaining.toLocaleString('en-IN')} left, {usage.status}).
              </p>
            ) : (
              <p className="text-muted text-sm">Usage appears after the first Zoho API call today.</p>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={zohoBusy}
              onClick={() => { void handleRefreshUsage(); }}
            >
              Refresh usage
            </button>
            {zoho ? (
              <>
                <CopyField label="Sales order webhook URL" value={zoho.urls.salesorder} />
                <CopyField label="Invoice webhook URL" value={zoho.urls.invoice} />
                <CopyField label="Purchase order webhook URL" value={zoho.urls.purchaseorder} />
                <CopyField label="Goods receipt webhook URL" value={zoho.urls.goodsreceipt} />
                <CopyField label="Item webhook URL" value={zoho.urls.item} />
                <CopyField label="Customer webhook URL" value={zoho.urls.customer} />
                <CopyField label="Shared webhook secret" value={zoho.secret} />
                <p className="text-muted text-sm">
                  Paste the secret into each Zoho webhook (additional authentication / HMAC).
                  Then turn on verification. {zoho.envSecretConfigured
                    ? 'Firebase env ZOHO_WEBHOOK_SECRET is already set and takes priority.'
                    : 'Verification stays off until you confirm the secret is in Zoho.'}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={zohoBusy || zoho.envSecretConfigured}
                  onClick={() => { void handleEnforce(!zoho.enforceSignature); }}
                >
                  {zoho.enforceSignature ? 'Turn off signature check' : 'I pasted this in Zoho — turn on verification'}
                </button>
              </>
            ) : (
              <p className="text-muted text-sm">Zoho webhook settings need a super-admin session.</p>
            )}
          </div>

          {settings ? (
            <div className="yesgatc-webhook">
              <h4>YesGATC</h4>
              <CopyField
                label="Paste this URL into YesGATC"
                value={settings.pasteUrl}
              />
              <div className="yesgatc-webhook__example">
                <p className="yesgatc-webhook__example-title">Webhook rules</p>
                <p className="text-muted text-sm">
                  For RC dealers, a new or deleted weighing-scale invoice (HSN
                  {' '}
                  84238190 / 84238290 / 84231000
                  ) updates Sold and sends
                  {' '}
                  <code>rc.ov_quota</code>
                  .
                  Warehouse serial allot sends serials with RC code
                  {' '}
                  (<code>serial.allotted</code>
                  {' / '}
                  <code>serial.updated</code>
                  {' / '}
                  <code>serial.cancelled</code>
                  ) and marks the invoice pushed on success.
                  Non-RC invoices stay on Zoho only. Do not send OV, Linked, or
                  Balance from YesOne. YesGATC posts OV done per RC; YesOne updates
                  the RC OV report from that inbound payload.
                </p>
                <pre>{`{
  "event": "rc_ov",
  "rcs": [
    { "rcCode": "ATL", "ov": 589, "linked": 589 }
  ]
}`}</pre>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};
