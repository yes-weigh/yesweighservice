import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Hash, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  allotmentFromPreview,
  loadSerialNumberAllotments,
  previewSerialRange,
  saveSerialNumberAllotments,
  totalAllottedCount,
} from '../../../lib/serialNumberAllotment';
import type { SerialNumberAllotment } from '../../../types/serial-number-allotment';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SerialNumberAllotmentTab: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [allotments, setAllotments] = useState<SerialNumberAllotment[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [missingText, setMissingText] = useState('');

  const preview = useMemo(
    () => previewSerialRange({ from, to, missingText }),
    [from, to, missingText],
  );

  const totalCount = useMemo(() => totalAllottedCount(allotments), [allotments]);
  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const doc = await loadSerialNumberAllotments();
      setAllotments(doc.allotments);
      setUpdatedAt(doc.updatedAt);
      setUpdatedBy(doc.updatedBy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load serial number allotments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: SerialNumberAllotment[], message: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const saved = await saveSerialNumberAllotments(next, actorName);
      setAllotments(saved.allotments);
      setUpdatedAt(saved.updatedAt);
      setUpdatedBy(saved.updatedBy);
      setSuccess(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save serial number allotments.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (preview.error) {
      setError(preview.error);
      setSuccess('');
      return;
    }
    if (!preview.from || !preview.to || preview.count < 0) {
      setError('Enter a valid From and To range.');
      setSuccess('');
      return;
    }
    const row = allotmentFromPreview(preview);
    const next = [row, ...allotments];
    await persist(
      next,
      `Saved ${preview.count.toLocaleString('en-IN')} allotted serial${preview.count === 1 ? '' : 's'}.`,
    );
    setFrom('');
    setTo('');
    setMissingText('');
  };

  const handleRemove = async (row: SerialNumberAllotment) => {
    const ok = await confirm({
      title: 'Remove allotment?',
      message: `Remove ${row.from}–${row.to} (${row.count.toLocaleString('en-IN')} allotted)?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await persist(
      allotments.filter(item => item.id !== row.id),
      'Allotment removed.',
    );
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Serial number allotment</h3>
          <p className="text-muted text-sm">
            Define allotted ranges and list missing serials. Count is range size minus those missing numbers.
          </p>
        </div>
        <div className="settings-serial-allotment__total" aria-live="polite">
          <span>Allotted</span>
          <strong>{loading ? '…' : totalCount.toLocaleString('en-IN')}</strong>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}
      {success && <p className="settings-locations__success text-sm">{success}</p>}

      <div className="settings-locations__add-form settings-serial-allotment__form">
        <label className="settings-locations__field">
          <span>From</span>
          <input
            type="text"
            inputMode="text"
            value={from}
            disabled={busy}
            placeholder="2408001"
            onChange={e => setFrom(e.target.value)}
          />
        </label>
        <label className="settings-locations__field">
          <span>To</span>
          <input
            type="text"
            inputMode="text"
            value={to}
            disabled={busy}
            placeholder="2408500"
            onChange={e => setTo(e.target.value)}
          />
        </label>
        <label className="settings-locations__field settings-locations__field--grow">
          <span>Missing</span>
          <textarea
            className="settings-serial-allotment__missing"
            rows={2}
            value={missingText}
            disabled={busy}
            placeholder="e.g. 2408010, 2408022, 2408105"
            onChange={e => setMissingText(e.target.value)}
          />
        </label>
        <div className="settings-serial-allotment__count" aria-live="polite">
          <span>Count</span>
          {preview.error && (from.trim() || to.trim()) ? (
            <strong className="is-error">—</strong>
          ) : (
            <strong>{preview.count.toLocaleString('en-IN')}</strong>
          )}
          <small>
            {preview.rangeSize > 0
              ? `${preview.rangeSize.toLocaleString('en-IN')} in range − ${preview.missingCount.toLocaleString('en-IN')} missing`
              : 'Range − missing'}
          </small>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || Boolean(preview.error) || !from.trim() || !to.trim()}
          onClick={() => void handleAdd()}
        >
          <Plus size={15} aria-hidden />
          Add
        </button>
      </div>

      {preview.ignoredMissing.length > 0 ? (
        <p className="text-muted text-sm settings-serial-allotment__ignored">
          Ignored (outside range or invalid): {preview.ignoredMissing.join(', ')}
        </p>
      ) : null}

      {loading ? (
        <p className="settings-locations__loading text-muted text-sm">Loading allotments…</p>
      ) : allotments.length === 0 ? (
        <p className="settings-locations__empty text-muted text-sm">
          No allotments yet. Enter a range, list any missing serials, then Add.
        </p>
      ) : (
        <ul className="settings-serial-allotment__list">
          {allotments.map(row => (
            <li key={row.id} className="settings-serial-allotment__row">
              <span className="settings-serial-allotment__icon" aria-hidden>
                <Hash size={16} />
              </span>
              <div className="settings-serial-allotment__copy">
                <strong>
                  {row.from}
                  {' – '}
                  {row.to}
                </strong>
                {row.missing.length > 0 ? (
                  <span className="settings-serial-allotment__missing-list">
                    Missing {row.missing.join(', ')}
                  </span>
                ) : (
                  <span className="text-muted text-sm">No missing serials</span>
                )}
              </div>
              <div className="settings-serial-allotment__row-count">
                <strong>{row.count.toLocaleString('en-IN')}</strong>
                <span>allotted</span>
              </div>
              <button
                type="button"
                className="settings-spare-boxes__remove"
                disabled={busy}
                aria-label={`Remove ${row.from} to ${row.to}`}
                onClick={() => void handleRemove(row)}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {updatedAt ? (
        <p className="text-muted text-sm settings-serial-allotment__meta">
          Last saved {formatWhen(updatedAt)}
          {updatedBy ? ` · ${updatedBy}` : ''}
        </p>
      ) : null}
    </section>
  );
};
