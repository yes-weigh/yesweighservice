import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Activity, FileText, Play, RefreshCw, RotateCcw, Tags } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  countOrgPurchaseOrdersInRange,
  fetchOrgPurchaseOrderSyncStatus,
  fetchZohoApiUsage,
  orgSyncStatusLabel,
  reclassifyPurchaseOrderCategoriesFromCatalog,
  runOrgPurchaseOrderSync,
  zohoApiUsageLabel,
  zohoApiUsageTone,
  type OrgPurchaseOrderSyncStatus,
  type ZohoApiUsageStatus,
} from '../../lib/org-purchase-order-sync';

function formatLastRunSummary(status: OrgPurchaseOrderSyncStatus | null): string | null {
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

export const AdminPurchaseOrderSyncPage: React.FC = () => {
  const [status, setStatus] = useState<OrgPurchaseOrderSyncStatus | null>(null);
  const [apiUsage, setApiUsage] = useState<ZohoApiUsageStatus | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'count' | 'sync' | 'category' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actionFeedbackRef = useRef<HTMLDivElement | null>(null);

  useCatalogPageHeader({ title: 'Purchase order sync' }, true);

  const showActionFeedback = useCallback((nextNotice: string, nextError = '') => {
    setNotice(nextNotice);
    setError(nextError);
    window.requestAnimationFrame(() => {
      actionFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const next = await fetchOrgPurchaseOrderSyncStatus();
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
    showActionFeedback(
      'Counting purchase orders in Zoho… this can take a few minutes. Keep this tab open.',
    );
    try {
      const result = await countOrgPurchaseOrdersInRange();
      await loadStatus();
      const remaining = Math.max(0, result.totalInRange - result.pulledCount);
      showActionFeedback(
        `Count finished — ${result.totalInRange.toLocaleString()} in Zoho, `
        + `${result.pulledCount.toLocaleString()} in Firestore`
        + (remaining === 0
          ? ' (all pulled; Count only refreshes totals).'
          : ` (${remaining.toLocaleString()} remaining — use Pull now).`),
      );
    } catch (err) {
      showActionFeedback('', err instanceof Error ? err.message : 'Count failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleCategoryBackfill = async () => {
    setBusy('category');
    showActionFeedback(
      'Classifying purchase orders from line item → catalog (HSN/category)… no Zoho calls.',
    );
    try {
      const result = await reclassifyPurchaseOrderCategoriesFromCatalog();
      const counts = result.byCategory;
      const breakdown = counts
        ? [
          counts.product ? `${counts.product.toLocaleString()} product` : null,
          counts.spare ? `${counts.spare.toLocaleString()} spare` : null,
          counts.service ? `${counts.service.toLocaleString()} service` : null,
          counts.software_key ? `${counts.software_key.toLocaleString()} software key` : null,
        ].filter(Boolean).join(', ')
        : '';
      showActionFeedback(
        `Classification finished — scanned ${result.scanned.toLocaleString()}, `
        + `updated ${result.updated.toLocaleString()}, `
        + `unchanged ${(result.unchanged ?? 0).toLocaleString()}`
        + (breakdown ? ` (${breakdown}).` : '.'),
      );
    } catch (err) {
      showActionFeedback('', err instanceof Error ? err.message : 'Category classify failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleSync = () => {
    showActionFeedback(
      'Sync started on the server (Cloud Functions). You can close this tab — '
      + 'status refreshes automatically.',
    );
    void loadStatus();
    void runOrgPurchaseOrderSync()
      .then(result => {
        const parts = [
          `${result.newlyPulled.toLocaleString()} newly pulled`,
          `${result.unchangedCount.toLocaleString()} already cached`,
        ];
        if (result.failedCount) parts.push(`${result.failedCount} failed`);
        if (result.rateLimited) parts.push('stopped — Zoho rate limit');
        if (result.quotaReserved) parts.push('stopped — 30% quota reserved for daytime');
        showActionFeedback(
          result.message
          ?? (result.completed
            ? `Complete — ${parts.join(', ')}. All ${result.pulledCount.toLocaleString()} purchase orders are in Firestore.`
            : `${orgSyncStatusLabel(result.status)} — ${parts.join(', ')}. Click Pull now again to continue.`),
        );
        void loadStatus();
      })
      .catch(err => {
        showActionFeedback('', err instanceof Error ? err.message : 'Sync failed.');
        void loadStatus();
      });
  };

  if (loading && !status) {
    return <FetchingLoader label="Loading purchase order sync status…" />;
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
        <Link to="/super-admin/purchase-orders" className="text-muted text-sm admin-invoices-back">
          ← All purchase orders
        </Link>
        <h1 className="mt-2">Purchase order sync</h1>
        <p className="text-muted mt-2">
          Org-wide backfill from Zoho into Firestore — one document per purchase order, details only (no PDFs).
          Vendor name and id are stored on each document. A scheduled run at <strong>3:00 AM IST</strong> resumes
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
          On demand from Zoho Inventory. Each refresh uses 1 API call.
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
          </>
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
        </ul>
      </div>

      <div className="panel glass">
        <h2 className="mb-4">Actions</h2>
        <p className="text-muted mb-4">
          <strong>Count purchase orders</strong> only refreshes the totals above.
          {' '}
          <strong>Pull now</strong> downloads missing/changed POs from the checkpoint.
          {' '}
          <strong>Classify from catalog</strong> sets each PO category from its highest-value
          line item’s product id → catalog HSN/category (no Zoho).
        </p>
        <div ref={actionFeedbackRef}>
          {error && (
            <div className="products-inline-error panel glass mb-4" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          {(notice || busy === 'count') && (
            <div className="panel glass mb-4" role="status">
              <span>
                {busy === 'count' && !notice.includes('finished')
                  ? (notice || 'Counting purchase orders…')
                  : notice}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => { void handleCount(); }}
          >
            {busy === 'count' ? <RotateCcw size={16} className="spin" /> : <RefreshCw size={16} />}
            {busy === 'count' ? 'Counting…' : 'Count purchase orders'}
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
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => { void handleCategoryBackfill(); }}
          >
            {busy === 'category' ? <RotateCcw size={16} className="spin" /> : <Tags size={16} />}
            {busy === 'category' ? 'Classifying…' : 'Classify from catalog'}
          </button>
        </div>
      </div>
    </div>
  );
};
