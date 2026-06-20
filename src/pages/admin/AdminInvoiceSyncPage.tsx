import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FileText, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  countOrgInvoicesInRange,
  fetchOrgInvoiceSyncStatus,
  orgSyncStatusLabel,
  runOrgInvoiceSync,
  type OrgInvoiceSyncStatus,
} from '../../lib/org-invoice-sync';

export const AdminInvoiceSyncPage: React.FC = () => {
  const [status, setStatus] = useState<OrgInvoiceSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'count' | 'sync' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const next = await fetchOrgInvoiceSyncStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sync status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [status?.status, loadStatus]);

  const handleCount = async () => {
    setBusy('count');
    setError('');
    setNotice('');
    try {
      const result = await countOrgInvoicesInRange();
      setNotice(
        `Found ${result.totalInRange.toLocaleString()} invoices in Zoho; `
        + `${result.pulledCount.toLocaleString()} already in Firestore.`,
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Count failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    setError('');
    setNotice('Pulling all invoice details — keep this tab open until complete (may take up to 60 minutes).');
    const poll = window.setInterval(() => {
      void loadStatus();
    }, 10_000);
    try {
      const result = await runOrgInvoiceSync();
      const parts = [
        `${result.newlyPulled.toLocaleString()} newly pulled`,
        `${result.unchangedCount.toLocaleString()} already cached`,
      ];
      if (result.failedCount) parts.push(`${result.failedCount} failed`);
      setNotice(
        result.message
        ?? (result.completed
          ? `Complete — ${parts.join(', ')}. All ${result.pulledCount.toLocaleString()} invoices are in Firestore.`
          : `${orgSyncStatusLabel(result.status)} — ${parts.join(', ')}. Click Pull now again to continue.`),
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
      await loadStatus();
    } finally {
      window.clearInterval(poll);
      setBusy(null);
    }
  };

  if (loading && !status) {
    return <FetchingLoader label="Loading invoice sync status…" />;
  }

  const total = status?.totalInRange;
  const pulled = status?.pulledCount ?? 0;
  const remaining = status?.remaining;
  const runInProgress = status?.status === 'running';
  const runNewlyPulled = status?.lastRunSummary?.inProgress
    ? status.lastRunSummary.newlyPulled
    : null;
  const progressPct = total && total > 0 ? Math.min(100, Math.round((pulled / total) * 100)) : null;

  return (
    <div className="page-content fade-in">
      <div className="mb-6">
        <h1>Invoice sync</h1>
        <p className="text-muted mt-2">
          Org-wide backfill from Zoho into Firestore — one document per invoice, details only (no PDFs).
          All organisation invoices, newest first.
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-4"
          disabled={busy !== null}
          onClick={() => { void loadStatus(); }}
        >
          <RefreshCw size={16} />
          Refresh status
        </button>
      </div>

      {error && (
        <div className="products-inline-error panel glass mb-4" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="panel glass mb-4" role="status">
          <span>{notice}</span>
        </div>
      )}

      <div className="stats-grid stats-grid--3 mb-6">
        <div className="stat-card glass">
          <div className="stat-icon"><FileText size={28} /></div>
          <div>
            <h3>Total in Zoho</h3>
            <div className="stat-value">
              {total == null ? '—' : total.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="stat-card glass">
          <div>
            <h3>Pulled to Firebase</h3>
            <div className="stat-value">{pulled.toLocaleString()}</div>
            {runInProgress && runNewlyPulled != null && (
              <div className="text-muted text-sm mt-1">
                +{runNewlyPulled.toLocaleString()} this run
              </div>
            )}
          </div>
        </div>
        <div className="stat-card glass">
          <div>
            <h3>Remaining</h3>
            <div className="stat-value">
              {remaining == null ? '—' : remaining.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {progressPct != null && (
        <div className="panel glass mb-6">
          <div className="mb-2" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Progress</strong>
            <span className="text-muted">{progressPct}%</span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: 'var(--border-subtle, rgba(255,255,255,0.08))',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--accent, #3b82f6)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      <div className="panel glass mb-6">
        <h2 className="mb-4">Status</h2>
        <ul className="text-muted" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li className="mb-2">
            <strong className="text-main">State:</strong> {orgSyncStatusLabel(status?.status ?? 'idle')}
          </li>
          <li className="mb-2">
            <strong className="text-main">Last run:</strong>{' '}
            {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('en-IN') : '—'}
            {status?.lastRunSummary?.newlyPulled != null && !status.lastRunSummary.inProgress && (
              <span className="text-muted">
                {' '}
                (+{status.lastRunSummary.newlyPulled.toLocaleString()} new,{' '}
                {status.lastRunSummary.unchanged?.toLocaleString() ?? 0} already cached)
              </span>
            )}
          </li>
          <li className="mb-2">
            <strong className="text-main">Counts updated:</strong>{' '}
            {status?.totalCountedAt
              ? new Date(status.totalCountedAt).toLocaleString('en-IN')
              : 'Not yet — run Count first'}
          </li>
          {runInProgress && (
            <li className="mb-2">
              <strong className="text-main">In progress:</strong> Pulling invoice details until all are stored.
            </li>
          )}
        </ul>
      </div>

      <div className="panel glass">
        <h2 className="mb-4">Actions</h2>
        <p className="text-muted mb-4">
          <strong>Count invoices</strong> lists every invoice in Zoho (~20k) and checks Firestore.
          <strong> Pull now</strong> fetches missing details and runs until finished or the 60-minute function limit.
          If interrupted, click Pull now again — it resumes from the last checkpoint.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => { void handleCount(); }}
          >
            {busy === 'count' ? <RotateCcw size={16} className="spin" /> : <RefreshCw size={16} />}
            Count invoices
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || status?.status === 'running'}
            onClick={() => { void handleSync(); }}
          >
            {busy === 'sync' ? <RotateCcw size={16} className="spin" /> : <Play size={16} />}
            Pull now
          </button>
        </div>
      </div>
    </div>
  );
};
