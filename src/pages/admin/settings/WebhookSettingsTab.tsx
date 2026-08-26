import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, Webhook } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import { copyTextToClipboard } from '../../../lib/clipboard';
import {
  YESGATC_WEBHOOK_FUNCTION_URL,
  ensureYesGatcWebhookSettings,
  rotateYesGatcWebhookSecret,
  type YesGatcWebhookSettings,
} from '../../../lib/yesgatcRecords';

function CopyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint ? <p className="text-muted text-sm">{hint}</p> : null}
    </div>
  );
}

export const WebhookSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<YesGatcWebhookSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const rotate = async () => {
    const ok = await confirm({
      title: 'Rotate webhook secret?',
      message: 'YesGATC must be updated with the new paste URL. The previous URL will stop working.',
      confirmLabel: 'Rotate',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      setSettings(await rotateYesGatcWebhookSecret(actorName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rotate the webhook secret.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Webhook</h3>
          <p className="text-muted text-sm">
            Paste this destination into YesGATC so certificates and RC details push into YesOne.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || loading}
          onClick={() => void rotate()}
        >
          <RefreshCw size={16} aria-hidden />
          Rotate secret
        </button>
      </header>

      {error ? <p className="settings-locations__error">{error}</p> : null}
      {loading ? (
        <p className="settings-locations__loading">Loading webhook…</p>
      ) : settings ? (
        <div className="yesgatc-webhook">
          <CopyField
            label="Paste this URL into YesGATC"
            value={settings.pasteUrl}
            hint="This URL already includes the secret. Certificates appear under Certificate; RC details appear in Settings → RC details."
          />
          <CopyField
            label="Destination (no secret)"
            value={settings.destinationUrl}
          />
          <CopyField
            label="Secret"
            value={settings.secret}
            hint="If YesGATC asks for a header, send X-YesGatc-Secret with this value."
          />
          <CopyField
            label="Direct Cloud Function URL"
            value={`${YESGATC_WEBHOOK_FUNCTION_URL}?key=${encodeURIComponent(settings.secret)}`}
          />

          <div className="yesgatc-webhook__example">
            <p className="yesgatc-webhook__example-title">
              <Webhook size={16} aria-hidden />
              Expected JSON
            </p>
            <pre>{`{
  "certificates": [
    {
      "certificateNumber": "GATC-123",
      "serialNumber": "YW12345",
      "dealerName": "ABC Scales",
      "productName": "Platform scale",
      "rcCode": "EKM",
      "pdfUrl": "https://…"
    }
  ],
  "rcDetails": [
    {
      "code": "EKM",
      "name": "Ernakulam RC",
      "city": "Kochi",
      "state": "Kerala",
      "phone": "0484…"
    }
  ]
}`}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
};
