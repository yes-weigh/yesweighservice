import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FileText, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  countOrgInvoicesInRange,
  fetchOrgInvoiceSyncStatus,
  formatOrgSyncDate,
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

  const handleCount = async () => {
    setBusy('count');
    setError('');
    setNotice('');
    try {
      const result = await countOrgInvoicesInRange();
      setNotice(
        `Counted ${result.totalInRange.toLocaleString()} invoices in range; `
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
    setNotice('');
    try {
      const result = await runOrgInvoiceSync();
      const parts = [
        `${result.newlyPulled.toLocaleString()} newly pulled`,
        `${result.unchangedCount.toLocaleString()} unchanged`,
      ];
      if (result.failedCount) parts.push(`${result.failedCount} failed`);
      setNotice(
        `${orgSyncStatusLabel(result.status)} — ${parts.join(', ')} `
        + `(${result.apiCallsUsed.toLocaleString()} Zoho calls this run).`,
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) {
    return <FetchingLoader label="Loading invoice sync status…" />;
  }

  const total = status?.totalInRange;
  const pulled = status?.pulledCount ?? 0;
  const remaining = status?.remaining;
  const progressPct = total && total > 0 ? Math.min(100, Math.round((pulled / total) * 100)) : null;

  return (
    <div className="page-content fade-in">
      <div className="mb-6">
        <h1>Invoice sync</h1>
        <p className="text-muted mt-2">
          Org-wide backfill from Zoho into Firestore — one document per invoice, details only (no PDFs).
          Newest first, from today back to {formatOrgSyncDate(status?.dateFrom ?? '2025-04-01')}.
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

      <div className="stats-grid stats-grid--4 mb-6">
        <div className="stat-card glass">
          <div className="stat-icon"><FileText size={28} /></div>
          <div>
            <h3>Total in range</h3>
            <div className="stat-value">
              {total == null ? '—' : total.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="stat-card glass">
          <div>
            <h3>Pulled to Firebase</h3>
            <div className="stat-value">{pulled.toLocaleString()}</div>
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
        <div className="stat-card glass">
          <div>
            <h3>Today&apos;s API use</h3>
            <div className="stat-value">
              {(status?.apiCallsToday ?? 0).toLocaleString()}
              <span className="text-muted text-sm"> / {(status?.dailyApiCap ?? 8000).toLocaleString()}</span>
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
            <strong className="text-main">Date range:</strong>{' '}
            {formatOrgSyncDate(status?.dateFrom)} → {formatOrgSyncDate(status?.dateTo)}
          </li>
          <li className="mb-2">
            <strong className="text-main">API remaining today:</strong>{' '}
            {(status?.apiRemainingToday ?? 0).toLocaleString()} calls
          </li>
          <li className="mb-2">
            <strong className="text-main">Last run:</strong>{' '}
            {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('en-IN') : '—'}
          </li>
          <li className="mb-2">
            <strong className="text-main">Counts updated:</strong>{' '}
            {status?.totalCountedAt
              ? new Date(status.totalCountedAt).toLocaleString('en-IN')
              : 'Not yet — run Count first'}
          </li>
          {status?.status === 'paused_quota' && (
            <li className="mb-2">
              <strong className="text-main">Queued:</strong> Continues automatically tomorrow (2 AM IST scheduled run)
            </li>
          )}
        </ul>
      </div>

      <div className="panel glass">
        <h2 className="mb-4">Actions</h2>
        <p className="text-muted mb-4">
          Run <strong>Count</strong> once to load total vs pulled from Zoho + Firestore.
          Then <strong>Pull now</strong> to sync as many invoices as today&apos;s 8,000-call cap allows (~3 days for a full backfill).
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
