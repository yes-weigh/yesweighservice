import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { copyTextToClipboard } from '../../../lib/clipboard';
import {
  ensureYesGatcWebhookSettings,
  type YesGatcWebhookSettings,
} from '../../../lib/yesgatcRecords';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(await ensureYesGatcWebhookSettings(actorName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load webhook settings.');
    } finally {
      setLoading(false);
    }
  }, [actorName]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <h3>Webhook</h3>
      </header>

      {error ? <p className="settings-locations__error">{error}</p> : null}
      {loading ? (
        <p className="settings-locations__loading">Loading webhook…</p>
      ) : settings ? (
        <div className="yesgatc-webhook">
          <CopyField
            label="Paste this URL into YesGATC"
            value={settings.pasteUrl}
          />
          <div className="yesgatc-webhook__example">
            <p className="yesgatc-webhook__example-title">Webhook rules</p>
            <p className="text-muted text-sm">
              YesOne sends serial numbers and qty when they are added or deducted.
              Do not send OV, Linked, or Balance from YesOne. YesGATC posts OV done
              per RC; YesOne updates the RC OV report from that inbound payload.
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
    </section>
  );
};
