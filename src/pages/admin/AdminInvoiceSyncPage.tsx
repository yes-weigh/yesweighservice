import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Activity, FileText, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  countOrgInvoicesInRange,
  fetchOrgInvoiceSyncStatus,
  fetchZohoApiUsage,
  orgSyncStatusLabel,
  runOrgInvoiceSync,
  zohoApiUsageLabel,
  zohoApiUsageTone,
  type OrgInvoiceSyncStatus,
  type ZohoApiUsageStatus,
} from '../../lib/org-invoice-sync';

function formatLastRunSummary(status: OrgInvoiceSyncStatus | null): string | null {
  const summary = status?.lastRunSummary;
  if (!summary || summary.inProgress) return null;
  const parts: string[] = [];
  if (summary.newlyPulled != null) parts.push(`${summary.newlyPulled.toLocaleString()} newly pulled`);
  if (summary.unchanged != null) parts.push(`${summary.unchanged.toLocaleString()} already cached`);
  if (summary.failed) parts.push(`${summary.failed.toLocaleString()} failed`);
  if (summary.rateLimited) parts.push('stopped — Zoho rate limit');
  if (summary.quotaReserved) parts.push('stopped — 30% quota reserved for daytime');
  if (!parts.length) return null;
  return parts.join(', ');
}

function usageBarColor(tone: 'ok' | 'warn' | 'danger'): string {
  if (tone === 'danger') return '#ef4444';
  if (tone === 'warn') return '#f59e0b';
  return 'var(--accent, #3b82f6)';
}

export const AdminInvoiceSyncPage: React.FC = () => {
  const [status, setStatus] = useState<OrgInvoiceSyncStatus | null>(null);
  const [apiUsage, setApiUsage] = useState<ZohoApiUsageStatus | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
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

  const loadApiUsage = useCallback(async (forceRefresh = true) => {
    setUsageError('');
    setUsageLoading(true);
    try {
      const next = await fetchZohoApiUsage({ forceRefresh });
      setApiUsage(next);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Could not load Zoho API usage.');
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 5_000);
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

  const handleSync = () => {
    setError('');
    setNotice(
      'Sync started on the server (Cloud Functions). You can close this tab — '
      + 'status refreshes automatically.',
    );
    void loadStatus();
    void runOrgInvoiceSync()
      .then(result => {
        const parts = [
          `${result.newlyPulled.toLocaleString()} newly pulled`,
          `${result.unchangedCount.toLocaleString()} already cached`,
        ];
        if (result.failedCount) parts.push(`${result.failedCount} failed`);
        if (result.rateLimited) parts.push('stopped — Zoho rate limit');
        if (result.quotaReserved) parts.push('stopped — 30% quota reserved for daytime');
        setNotice(
          result.message
          ?? (result.completed
            ? `Complete — ${parts.join(', ')}. All ${result.pulledCount.toLocaleString()} invoices are in Firestore.`
            : `${orgSyncStatusLabel(result.status)} — ${parts.join(', ')}. Click Pull now again to continue.`),
        );
        void loadStatus();
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Sync failed.');
        void loadStatus();
      });
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
  const lastRunText = formatLastRunSummary(status);
  const usageLoaded = apiUsage != null;
  const usageTone = zohoApiUsageTone(apiUsage?.status ?? 'ok');
  const usagePct = apiUsage?.usagePct ?? 0;

  return (
    <div className="page-content fade-in">
      <div className="mb-6">
        <Link to="/super-admin/invoices" className="text-muted text-sm admin-invoices-back">
          ← All invoices
        </Link>
        <h1 className="mt-2">Invoice sync</h1>
        <p className="text-muted mt-2">
          Org-wide backfill from Zoho into Firestore — one document per invoice, details only (no PDFs).
          All organisation invoices, newest first. A scheduled run at <strong>2:00 AM IST</strong> resumes
          from the checkpoint and uses at most <strong>70%</strong> of the daily Zoho API quota (30% kept for daytime).
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

      <div className="panel glass mb-6 admin-zoho-usage">
        <div className="admin-zoho-usage__head">
          <div className="admin-zoho-usage__title">
            <Activity size={20} aria-hidden />
            <h2 className="mb-0">Zoho API usage (today)</h2>
          </div>
          <div className="admin-zoho-usage__actions">
            {usageLoaded && (
              <span className={`admin-zoho-usage__badge admin-zoho-usage__badge--${usageTone}`}>
                {zohoApiUsageLabel(apiUsage?.status ?? 'ok')}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={usageLoading || busy !== null}
              onClick={() => { void loadApiUsage(true); }}
            >
              {usageLoading ? <RotateCcw size={14} className="spin" /> : <RefreshCw size={14} />}
              {usageLoaded ? 'Refresh from Zoho' : 'Load from Zoho'}
            </button>
          </div>
        </div>
        <p className="text-muted text-sm mt-2 mb-4">
          On demand from Zoho Inventory (all API clients — portal, scripts, other apps).
          Each refresh uses 1 API call; click only when you need current numbers.
        </p>
        {usageError && (
          <div className="products-inline-error mb-4" role="alert">
            <AlertCircle size={16} />
            <span>{usageError}</span>
          </div>
        )}
        {!usageLoaded && !usageLoading && (
          <p className="text-muted text-sm mb-0">
            Not loaded yet — click <strong>Load from Zoho</strong> before Pull now if you want to check quota.
          </p>
        )}
        {usageLoaded && (
          <>
        <div className="admin-zoho-usage__stats">
          <div>
            <span className="text-muted text-sm">Used today</span>
            <div className="admin-zoho-usage__value">
              {apiUsage.callsToday.toLocaleString()}
              <span className="text-muted text-sm">
                {' '}/ {apiUsage.dailyLimit.toLocaleString()}
              </span>
            </div>
          </div>
          <div>
            <span className="text-muted text-sm">Remaining</span>
            <div className="admin-zoho-usage__value">
              {apiUsage.remaining.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-muted text-sm">Burst limit</span>
            <div className="admin-zoho-usage__value text-base">
              {apiUsage.windowRemaining != null
                ? `${apiUsage.windowRemaining.toLocaleString()} left this minute`
                : 'Not reported by Zoho'}
            </div>
          </div>
        </div>
        <div className="mb-2 mt-4" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>Daily quota</strong>
          <span className="text-muted">{usagePct}%</span>
        </div>
        <div className="admin-zoho-usage__bar-track">
          <div
            className="admin-zoho-usage__bar-fill"
            style={{ width: `${usagePct}%`, background: usageBarColor(usageTone) }}
          />
        </div>
        <ul className="text-muted text-sm mt-4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {apiUsage.resetAt && (
            <li>Daily quota resets: {new Date(apiUsage.resetAt).toLocaleString('en-IN')}</li>
          )}
          {apiUsage.fetchedAt && (
            <li>Last fetched from Zoho: {new Date(apiUsage.fetchedAt).toLocaleString('en-IN')}</li>
          )}
          {apiUsage.lastError && (
            <li style={{ color: 'var(--warning, #d97706)' }}>Fetch note: {apiUsage.lastError}</li>
          )}
        </ul>
          </>
        )}
        {apiUsage?.userDetails && apiUsage.userDetails.length > 0 && (
          <div className="mt-4">
            <strong className="text-sm">By user</strong>
            <ul className="text-muted text-sm mt-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {apiUsage.userDetails.map(user => (
                <li key={user.email ?? user.name ?? 'user'} className="mb-2">
                  {user.name ?? user.email ?? 'User'} — {user.total.toLocaleString()} calls
                  {user.hosts.length > 0 && (
                    <span className="text-muted">
                      {' '}
                      ({user.hosts.map(h => `${h.ip ?? '?'}: ${h.count.toLocaleString()}`).join(', ')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
          <div className="admin-zoho-usage__bar-track">
            <div
              className="admin-zoho-usage__bar-fill"
              style={{ width: `${progressPct}%`, background: 'var(--accent, #3b82f6)' }}
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
            <strong className="text-main">Checkpoint:</strong>{' '}
            page {status?.checkpointPage ?? 1}, index {status?.checkpointIndex ?? 0}
          </li>
          <li className="mb-2">
            <strong className="text-main">Last run:</strong>{' '}
            {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('en-IN') : '—'}
            {lastRunText && (
              <span className="text-muted"> ({lastRunText})</span>
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
              <strong className="text-main">In progress:</strong> Running on the server — safe to close this tab.
            </li>
          )}
          {(apiUsage?.status === 'daily_limit' || apiUsage?.status === 'throttled') && (
            <li className="mb-2">
              <strong className="text-main">Zoho quota:</strong>{' '}
              Pull is paused until API usage recovers. Avoid catalog sync while backfilling invoices.
            </li>
          )}
        </ul>
      </div>

      <div className="panel glass">
        <h2 className="mb-4">Actions</h2>
        <p className="text-muted mb-4">
          <strong> Count invoices</strong> scans Zoho and Firestore to refresh totals (run after a long Pull).
          <strong> Pull now</strong> resumes from the saved checkpoint (manual — no 30% reserve; up to 60 minutes per run).
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
            disabled={busy !== null || status?.status === 'running' || apiUsage?.status === 'daily_limit' || (apiUsage?.remaining ?? 1) <= 0}
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
