import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  allotmentFromPreview,
  countLinkedUnused,
  loadInvoicedSerialKeys,
  loadSerialNumberAllotments,
  pendingSerialAllotmentCount,
  previewSerialRange,
  pushSerialAllotmentsToYesGatc,
  saveSerialAllotmentWebhookUrl,
  saveSerialNumberAllotments,
  totalAllottedCount,
} from '../../../lib/serialNumberAllotment';
import type { SerialNumberAllotment, SerialSeriesId } from '../../../types/serial-number-allotment';
import { DEFAULT_SERIAL_SERIES, SERIAL_SERIES } from '../../../types/serial-number-allotment';

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function seriesLabel(id: SerialSeriesId): string {
  return SERIAL_SERIES.find(option => option.id === id)?.label ?? id;
}

function AllotmentStat({
  label,
  value,
  tone = 'muted',
  error = false,
}: {
  label: string;
  value: string;
  tone?: 'qty' | 'linked' | 'unused' | 'muted';
  error?: boolean;
}) {
  return (
    <div className={`settings-serial-allotment__stat settings-serial-allotment__stat--${tone}`}>
      <span>{label}</span>
      <strong className={error ? 'is-error' : undefined}>{value}</strong>
    </div>
  );
}

export const SerialNumberAllotmentTab: React.FC = () => {
  const { user } = useAuth();
  const [allotments, setAllotments] = useState<SerialNumberAllotment[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [series, setSeries] = useState<SerialSeriesId>(DEFAULT_SERIAL_SERIES);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [missingText, setMissingText] = useState('');
  const [invoicedKeys, setInvoicedKeys] = useState<Set<string>>(() => new Set());
  const [usageReady, setUsageReady] = useState(false);

  const preview = useMemo(
    () => previewSerialRange({ from, to, missingText }),
    [from, to, missingText],
  );

  const previewUsage = useMemo(
    () => countLinkedUnused({
      from: preview.from,
      to: preview.to,
      missing: preview.missing,
      count: preview.count,
    }, invoicedKeys),
    [invoicedKeys, preview.count, preview.from, preview.missing, preview.to],
  );

  const seriesRows = useMemo(
    () => allotments.filter(row => row.series === series),
    [allotments, series],
  );
  const totalCount = useMemo(() => totalAllottedCount(seriesRows), [seriesRows]);
  const pendingCount = useMemo(() => pendingSerialAllotmentCount(allotments), [allotments]);
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const doc = await loadSerialNumberAllotments();
      setAllotments(doc.allotments);
      setWebhookUrl(doc.webhookUrl || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load serial number allotments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void loadInvoicedSerialKeys()
      .then(keys => {
        if (!cancelled) setInvoicedKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setInvoicedKeys(new Set());
      })
      .finally(() => {
        if (!cancelled) setUsageReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: SerialNumberAllotment[], message: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const saved = await saveSerialNumberAllotments(next, actorName);
      setAllotments(saved.allotments);
      setSuccess(message);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save serial number allotments.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveWebhookUrl = async () => {
    try {
      const saved = await saveSerialAllotmentWebhookUrl(webhookUrl, actorName);
      setWebhookUrl(saved);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the webhook URL.');
      return null;
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    setSuccess('');
    try {
      const savedUrl = await handleSaveWebhookUrl();
      if (savedUrl == null) return;
      if (!savedUrl) {
        setError('Add a YesGATC webhook destination URL first.');
        return;
      }
      const result = await pushSerialAllotmentsToYesGatc({
        mode: 'test',
        webhookUrl: savedUrl,
        actorName,
      });
      const refreshed = await loadSerialNumberAllotments();
      setAllotments(refreshed.allotments);
      setWebhookUrl(result.webhookUrl || refreshed.webhookUrl || savedUrl);
      setSuccess(
        result.sent
          ? `YesGATC test OK. Sent ${result.sent.toLocaleString('en-IN')} pending range${result.sent === 1 ? '' : 's'}.`
          : 'YesGATC test OK. Nothing pending to send.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the YesGATC webhook.');
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = async () => {
    if (preview.error) {
      setError(preview.error);
      setSuccess('');
      return;
    }
    if (!preview.from || !preview.to || preview.count < 0) {
      setError('Enter a valid starting and end number.');
      setSuccess('');
      return;
    }
    const row = allotmentFromPreview(preview, series, actorName);
    const next = [row, ...allotments];
    const saved = await persist(
      next,
      `Saved ${preview.count.toLocaleString('en-IN')} allotted serial${preview.count === 1 ? '' : 's'}.`,
    );
    if (!saved) return;
    setFrom('');
    setTo('');
    setMissingText('');
    const destination = webhookUrl.trim();
    if (!destination) {
      setSuccess(
        `Saved ${preview.count.toLocaleString('en-IN')} allotted serial${preview.count === 1 ? '' : 's'}. Pending until you add a webhook URL and tap Test.`,
      );
      return;
    }
    setBusy(true);
    try {
      await saveSerialAllotmentWebhookUrl(destination, actorName);
      const result = await pushSerialAllotmentsToYesGatc({
        mode: 'ids',
        ids: [row.id],
        webhookUrl: destination,
        actorName,
      });
      const refreshed = await loadSerialNumberAllotments();
      setAllotments(refreshed.allotments);
      setSuccess(
        `Saved and sent ${preview.count.toLocaleString('en-IN')} serial${preview.count === 1 ? '' : 's'} to YesGATC.`
        + (result.pending ? ` ${result.pending} still pending.` : ''),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Saved locally. YesGATC push failed — tap Test to retry. ${err.message}`
          : 'Saved locally. YesGATC push failed — tap Test to retry.',
      );
    } finally {
      setBusy(false);
    }
  };

  const previewError = Boolean(preview.error && (from.trim() || to.trim()));
  const usageValue = (value: number) => (usageReady ? formatCount(value) : '…');

  return (
    <section className="settings-locations panel glass settings-serial-allotment">
      <header className="settings-locations__header settings-serial-allotment__header">
        <h3>Serial number allotment</h3>
        <div className="settings-serial-allotment__total" aria-live="polite">
          <span>Allotted</span>
          <strong>{loading ? '…' : formatCount(totalCount)}</strong>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}
      {success && <p className="settings-locations__success text-sm">{success}</p>}

      <div className="settings-serial-allotment__webhook">
        <label className="settings-serial-allotment__field settings-serial-allotment__field--webhook">
          <span>YesGATC webhook URL</span>
          <input
            type="url"
            value={webhookUrl}
            disabled={busy || testing}
            placeholder="https://yesgatc.in/webhooks/yesone"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setWebhookUrl(e.target.value)}
            onBlur={() => {
              if (!webhookUrl.trim()) return;
              void handleSaveWebhookUrl();
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || testing || loading || !webhookUrl.trim()}
          onClick={() => void handleTest()}
        >
          <Send size={15} aria-hidden />
          {testing ? 'Sending…' : 'Test'}
        </button>
        <p className="text-muted text-sm settings-serial-allotment__webhook-hint">
          {pendingCount
            ? `${pendingCount.toLocaleString('en-IN')} range${pendingCount === 1 ? '' : 's'} pending. Test sends them now; new Add also pushes live.`
            : 'New ranges push as soon as you tap Add. Test pings YesGATC and sends anything still pending.'}
        </p>
      </div>

      <div className="settings-serial-allotment__form">
        <div className="settings-serial-allotment__range">
          <label className="settings-serial-allotment__field settings-serial-allotment__field--series">
            <span>Series</span>
            <select
              value={series}
              disabled={busy}
              aria-label="Serial series"
              onChange={e => setSeries(e.target.value as SerialSeriesId)}
            >
              {SERIAL_SERIES.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-serial-allotment__field">
            <span>Start</span>
            <input
              type="text"
              inputMode="numeric"
              value={from}
              disabled={busy}
              placeholder="2408001"
              onChange={e => setFrom(e.target.value)}
            />
          </label>
          <label className="settings-serial-allotment__field">
            <span>End</span>
            <input
              type="text"
              inputMode="numeric"
              value={to}
              disabled={busy}
              placeholder="2408500"
              onChange={e => setTo(e.target.value)}
            />
          </label>
          <AllotmentStat
            label="Qty"
            tone="qty"
            error={previewError}
            value={previewError ? '—' : formatCount(preview.count)}
          />
        </div>
        <label className="settings-serial-allotment__field settings-serial-allotment__missing-field">
          <span>Missing</span>
          <textarea
            className="settings-serial-allotment__missing"
            rows={2}
            value={missingText}
            disabled={busy}
            placeholder="2408010, 2408022"
            onChange={e => setMissingText(e.target.value)}
          />
        </label>
        <div className="settings-serial-allotment__usage">
          <AllotmentStat
            label="Linked"
            tone="linked"
            value={previewError ? '—' : usageValue(previewUsage.linked)}
          />
          <AllotmentStat
            label="Unused"
            tone="unused"
            value={previewError ? '—' : usageValue(previewUsage.unused)}
          />
        </div>
        <div className="settings-serial-allotment__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || testing || Boolean(preview.error) || !from.trim() || !to.trim()}
            onClick={() => void handleAdd()}
          >
            <Plus size={15} aria-hidden />
            Add
          </button>
        </div>
      </div>

      {preview.ignoredMissing.length > 0 ? (
        <p className="text-muted text-sm settings-serial-allotment__ignored">
          Ignored (outside range or invalid): {preview.ignoredMissing.join(', ')}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-locations__loading text-muted text-sm">Loading allotments…</p>
      ) : seriesRows.length > 0 ? (
        <ul className="settings-serial-allotment__list">
          {seriesRows.map(row => {
            const usage = countLinkedUnused(row, invoicedKeys);
            return (
              <li key={row.id} className="settings-serial-allotment__row">
                <div className="settings-serial-allotment__metrics">
                  <div className="settings-serial-allotment__metrics-row">
                    <AllotmentStat label="Series" value={seriesLabel(row.series)} />
                    <AllotmentStat label="Start" value={row.from} />
                    <AllotmentStat label="End" value={row.to} />
                    <AllotmentStat label="Qty" tone="qty" value={formatCount(row.count)} />
                  </div>
                  <div className="settings-serial-allotment__metrics-row settings-serial-allotment__metrics-row--usage">
                    <AllotmentStat label="Missing" value={formatCount(row.missing.length)} />
                    <AllotmentStat
                      label="Linked"
                      tone="linked"
                      value={usageValue(usage.linked)}
                    />
                    <AllotmentStat
                      label="Unused"
                      tone="unused"
                      value={usageValue(usage.unused)}
                    />
                  </div>
                </div>
                {row.missing.length > 0 ? (
                  <p className="settings-serial-allotment__missing-list">
                    {row.missing.join(', ')}
                  </p>
                ) : null}
                <p className="settings-serial-allotment__added">
                  <span>Added</span>
                  <strong>{row.createdBy || '—'}</strong>
                  <span className={`settings-serial-allotment__push ${row.pushedAt ? 'is-sent' : 'is-pending'}`}>
                    {row.pushedAt ? 'YesGATC sent' : 'YesGATC pending'}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
};
