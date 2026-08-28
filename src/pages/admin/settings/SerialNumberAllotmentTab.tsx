import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Pencil, Plus, Send } from 'lucide-react';
import { CategoryThumbnail } from '../../../components/catalog/CategoryThumbnail';
import { useAuth } from '../../../context/AuthContext';
import {
  allotmentFromPreview,
  countLinkedUnused,
  loadInvoicedSerialKeys,
  loadSerialNumberAllotments,
  pendingSerialAllotmentCount,
  resetInboundYesGatcWebhookState,
  prepareSerialAllotments,
  previewSerialRange,
  pushSerialAllotmentsToYesGatc,
  saveSerialAllotmentWebhookUrl,
  saveSerialNumberAllotments,
  serialAllotmentRangeKey,
  SHALIMA_ALLOTMENT_CREATED_BY,
  totalAllottedCount,
} from '../../../lib/serialNumberAllotment';
import type { SerialNumberAllotment, SerialSeriesId } from '../../../types/serial-number-allotment';
import { DEFAULT_SERIAL_SERIES, SERIAL_SERIES } from '../../../types/serial-number-allotment';

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatAddedAt(iso: string | null | undefined): string {
  const raw = String(iso ?? '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace(',', '');
}

function seriesLabel(id: SerialSeriesId): string {
  return SERIAL_SERIES.find(option => option.id === id)?.label ?? id;
}

function AllotmentStat({
  label,
  value,
  tone = 'muted',
  error = false,
  action,
}: {
  label: string;
  value: string;
  tone?: 'qty' | 'linked' | 'unused' | 'start' | 'end' | 'series' | 'muted';
  error?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`settings-serial-allotment__stat settings-serial-allotment__stat--${tone}`}>
      <span>{label}</span>
      <strong className={error ? 'is-error' : undefined}>
        {value}
        {action}
      </strong>
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
  const [editingMissingId, setEditingMissingId] = useState<string | null>(null);
  const [editMissingText, setEditMissingText] = useState('');
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

  const visibleRows = useMemo(
    () => [...allotments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [allotments],
  );
  const totalCount = useMemo(() => totalAllottedCount(allotments), [allotments]);
  const pendingCount = useMemo(() => pendingSerialAllotmentCount(allotments), [allotments]);
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const doc = await resetInboundYesGatcWebhookState(actorName)
        .catch(() => loadSerialNumberAllotments());
      const cleaned = prepareSerialAllotments(doc.allotments);
      setAllotments(cleaned);
      setWebhookUrl(doc.webhookUrl || '');
      const namedMissing = doc.allotments.some(row => !row.createdBy);
      if (cleaned.length !== doc.allotments.length || namedMissing) {
        await saveSerialNumberAllotments(cleaned, SHALIMA_ALLOTMENT_CREATED_BY);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load serial number allotments.');
    } finally {
      setLoading(false);
    }
  }, [actorName]);

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
      setAllotments(prepareSerialAllotments(refreshed.allotments));
      setWebhookUrl(result.webhookUrl || refreshed.webhookUrl || savedUrl || '');
      setSuccess(
        result.sent
          ? `YesGATC test OK. Sent serial numbers and counts (${result.sent.toLocaleString('en-IN')} range${result.sent === 1 ? '' : 's'}).`
          : 'YesGATC test OK. Sent serial numbers and counts.',
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
    const rangeKey = serialAllotmentRangeKey(row);
    if (allotments.some(existing => serialAllotmentRangeKey(existing) === rangeKey)) {
      setError('This range is already allotted.');
      setSuccess('');
      return;
    }
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
      setAllotments(prepareSerialAllotments(refreshed.allotments));
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

  const startEditMissing = (row: SerialNumberAllotment) => {
    setError('');
    setSuccess('');
    setEditingMissingId(row.id);
    setEditMissingText(row.missing.join(', '));
  };

  const handleSaveMissing = async (row: SerialNumberAllotment) => {
    const nextPreview = previewSerialRange({
      from: row.from,
      to: row.to,
      missingText: editMissingText,
    });
    if (nextPreview.error) {
      setError(nextPreview.error);
      setSuccess('');
      return;
    }
    const next = allotments.map(item => (
      item.id === row.id
        ? {
          ...item,
          missing: nextPreview.missing,
          count: nextPreview.count,
          pushedAt: null,
          pushError: null,
        }
        : item
    ));
    const saved = await persist(
      next,
      nextPreview.missing.length
        ? `Updated ${nextPreview.missing.length.toLocaleString('en-IN')} missing serial${nextPreview.missing.length === 1 ? '' : 's'}.`
        : 'Cleared missing serials.',
    );
    if (!saved) return;
    setEditingMissingId(null);
    setEditMissingText('');
    if (nextPreview.ignoredMissing.length) {
      setError(`Ignored (outside range or invalid): ${nextPreview.ignoredMissing.join(', ')}`);
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
          RC invoice create/delete updates Sold. Warehouse serial allot sends serials with RC code and marks Pushed to YesGATC on success. Test sends serial.allotted / serial_allotment with serial numbers and counts only. OV / Linked / Balance stay on YesGATC and come back on the inbound webhook.
          {pendingCount
            ? ` ${pendingCount.toLocaleString('en-IN')} range${pendingCount === 1 ? '' : 's'} still pending.`
            : ''}
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
      ) : visibleRows.length > 0 ? (
        <ul className="settings-serial-allotment__list">
          {visibleRows.map(row => {
            const usage = countLinkedUnused(row, invoicedKeys);
            const addedAt = formatAddedAt(row.createdAt);
            return (
              <li key={row.id} className="settings-serial-allotment__row">
                <div className="settings-serial-allotment__metrics">
                  <div className="settings-serial-allotment__metrics-row">
                    {row.sku || row.imageUrl || row.productName ? (
                      <div className="settings-serial-allotment__stat settings-serial-allotment__stat--product">
                        <span>Product</span>
                        <strong>
                          <span className="settings-serial-allotment__product-media">
                            {row.imageUrl ? (
                              <CategoryThumbnail src={row.imageUrl} knockout={false} />
                            ) : (
                              <Package size={16} aria-hidden />
                            )}
                          </span>
                          <span className="settings-serial-allotment__product-copy">
                            <em>{row.sku || '—'}</em>
                            {row.productName ? <small>{row.productName}</small> : null}
                          </span>
                        </strong>
                      </div>
                    ) : (
                      <AllotmentStat label="Series" tone="series" value={seriesLabel(row.series)} />
                    )}
                    <AllotmentStat label="Start" tone="start" value={row.from} />
                    <AllotmentStat label="End" tone="end" value={row.to} />
                    <AllotmentStat label="Qty" tone="qty" value={formatCount(row.count)} />
                  </div>
                  <div className="settings-serial-allotment__metrics-row settings-serial-allotment__metrics-row--usage">
                    <AllotmentStat
                      label="Missing"
                      value={formatCount(row.missing.length)}
                      action={(
                        <button
                          type="button"
                          className="settings-serial-allotment__edit-missing"
                          disabled={busy || testing}
                          aria-label={`Edit missing serials for ${seriesLabel(row.series)}`}
                          onClick={() => startEditMissing(row)}
                        >
                          <Pencil size={13} strokeWidth={2.2} />
                        </button>
                      )}
                    />
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
                {editingMissingId === row.id ? (
                  <div className="settings-serial-allotment__missing-edit">
                    <textarea
                      className="settings-serial-allotment__missing"
                      rows={2}
                      value={editMissingText}
                      disabled={busy}
                      placeholder="2408010, 2408022"
                      autoFocus
                      onChange={e => setEditMissingText(e.target.value)}
                    />
                    <div className="settings-serial-allotment__missing-edit-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setEditingMissingId(null);
                          setEditMissingText('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void handleSaveMissing(row)}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : row.missing.length > 0 ? (
                  <p className="settings-serial-allotment__missing-list">
                    {row.missing.join(', ')}
                  </p>
                ) : null}
                <div className="settings-serial-allotment__added">
                  <div className="settings-serial-allotment__added-who">
                    <span>Added</span>
                    <strong>{row.createdBy || '—'}</strong>
                    {addedAt ? (
                      <time dateTime={row.createdAt}>{addedAt}</time>
                    ) : null}
                  </div>
                  <span className={`settings-serial-allotment__push ${row.pushedAt ? 'is-sent' : 'is-pending'}`}>
                    {row.pushedAt ? 'YesGATC sent' : 'YesGATC pending'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
};
