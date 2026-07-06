import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatStockQuantity } from '../../lib/catalog';
import { fetchCatalogProductAuditLogs } from '../../lib/catalogProductAudit/data';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import { formatQtyDifference } from '../../lib/yesStore/inventoryAudit';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogProductAuditLog, CatalogProductAuditSnapshot } from '../../types/catalog-product-audit';
import { resolveAdjustedAuditDisplay } from '../../lib/catalogProductAudit/display';

function triggerLabel(trigger: CatalogProductAuditLog['trigger']): string {
  if (trigger === 'warehouse_count') return 'Warehouse count';
  if (trigger === 'cochin_inventory') return 'Cochin locations';
  return 'Manual';
}

export const ProductAuditHistory: React.FC<{
  product: CatalogProduct;
  snapshot?: CatalogProductAuditSnapshot | null;
  livePhysicalQty: number | null;
  canRecord?: boolean;
  onSnapshotChange?: (snapshot: CatalogProductAuditSnapshot) => void;
}> = ({
  product,
  snapshot = product.auditSnapshot ?? null,
  livePhysicalQty,
  canRecord = false,
  onSnapshotChange,
}) => {
  const [logs, setLogs] = useState<CatalogProductAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjusted = resolveAdjustedAuditDisplay({
    currentZohoQty: product.stock,
    snapshot,
    livePhysicalQty,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchCatalogProductAuditLogs(product.id)
      .then(rows => {
        if (active) setLogs(rows);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load audit history.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [product.id, snapshot?.lastAuditedAt]);

  const handleRecord = async () => {
    setRecording(true);
    setError(null);
    try {
      const { recordCatalogProductAudit } = await import('../../lib/catalogProductAudit/data');
      const result = await recordCatalogProductAudit(product.id, 'manual');
      if (!result.skipped && result.log) {
        const nextSnapshot: CatalogProductAuditSnapshot = {
          lastAuditLogId: result.log.id,
          lastAuditedAt: result.log.auditedAt,
          lastAuditedByUid: result.log.auditedByUid,
          lastAuditedByName: result.log.auditedByName,
          baselineDifference: result.log.baselineDifference,
          physicalQtyAtAudit: result.log.physicalQty,
          zohoQtyAtAudit: result.log.zohoQtyAtAudit,
          mode: result.log.mode,
          headOfficeQtyAtAudit: result.log.headOfficeQty,
          cochinQtyAtAudit: result.log.cochinQty,
        };
        onSnapshotChange?.(nextSnapshot);
        setLogs(prev => [result.log, ...prev.filter(row => row.id !== result.log.id)]);
      } else {
        void fetchCatalogProductAuditLogs(product.id).then(setLogs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record audit.');
    } finally {
      setRecording(false);
    }
  };

  if (!adjusted.hasAuditSnapshot && logs.length === 0 && !loading && !canRecord) {
    return null;
  }

  return (
    <div className="product-audit-history">
      <div className="product-audit-history__head">
        <h2 className="product-detail-page__stock-locations-title">Audit history</h2>
        {canRecord && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={recording}
            onClick={() => void handleRecord()}
          >
            {recording ? <RefreshCw size={14} className="spin-icon" aria-hidden /> : null}
            {recording ? 'Recording…' : 'Record audit'}
          </button>
        )}
      </div>

      {adjusted.hasAuditSnapshot && (
        <p className="product-audit-history__note text-muted">
          Last audit {formatAuditDateTime(adjusted.lastAuditedAt)}
          {adjusted.lastAuditedByName ? ` by ${adjusted.lastAuditedByName}` : ''}.
          {' '}Difference locked at {formatQtyDifference(adjusted.baselineDifference ?? 0)} — displayed audited qty
          adjusts when Zoho stock changes.
        </p>
      )}

      {error && <p className="product-audit-history__error">{error}</p>}

      {loading ? (
        <p className="product-audit-history__loading text-muted">Loading audit history…</p>
      ) : logs.length === 0 ? (
        <p className="product-audit-history__empty text-muted">No audit snapshots recorded yet.</p>
      ) : (
        <div className="product-audit-history__table-wrap">
          <table className="product-audit-history__table">
            <thead>
              <tr>
                <th>When</th>
                <th>By</th>
                <th>Physical</th>
                <th>Zoho</th>
                <th>Diff</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td>{formatAuditDateTime(log.auditedAt)}</td>
                  <td>{log.auditedByName?.trim() || '—'}</td>
                  <td>{formatStockQuantity(log.physicalQty, product.unit)}</td>
                  <td>{formatStockQuantity(log.zohoQtyAtAudit, product.unit)}</td>
                  <td className={log.baselineDifference > 0 ? 'is-over' : log.baselineDifference < 0 ? 'is-under' : ''}>
                    {formatQtyDifference(log.baselineDifference)}
                  </td>
                  <td>{triggerLabel(log.trigger)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
