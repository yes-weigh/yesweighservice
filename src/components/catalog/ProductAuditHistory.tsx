import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react';
import { formatStockQuantity } from '../../lib/catalog';
import {
  fetchCatalogProductAuditLogs,
  fetchCatalogProductStockMovements,
} from '../../lib/catalogProductAudit/data';
import { formatAuditDate, formatAuditTime } from '../../lib/yesStore/format';
import type { CatalogProduct } from '../../types/catalog';
import type {
  CatalogProductAuditLog,
  CatalogProductAuditSnapshot,
  CatalogProductStockMovementsResult,
} from '../../types/catalog-product-audit';

function auditorDisplayName(log: Pick<CatalogProductAuditLog, 'auditedByName' | 'trigger'>): string {
  if (log.trigger === 'zoho_sync') return 'Zoho sync';
  const trimmed = log.auditedByName?.trim();
  return trimmed || 'Unknown auditor';
}

function diffClassName(value: number): string {
  if (value < 0) return 'product-audit-log__diff is-under';
  if (value > 0) return 'product-audit-log__diff is-over';
  return 'product-audit-log__diff is-even';
}

function diffDisplay(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function qtyDeltaDisplay(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export const ProductAuditHistory: React.FC<{
  product: CatalogProduct;
  snapshot?: CatalogProductAuditSnapshot | null;
  livePhysicalQty: number | null;
  canRecord?: boolean;
  embedded?: boolean;
  onSnapshotChange?: (snapshot: CatalogProductAuditSnapshot) => void;
}> = ({
  product,
  snapshot = product.auditSnapshot ?? null,
  livePhysicalQty: _livePhysicalQty,
  canRecord = false,
  embedded = false,
  onSnapshotChange,
}) => {
  const [logs, setLogs] = useState<CatalogProductAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [movementsLog, setMovementsLog] = useState<CatalogProductAuditLog | null>(null);
  const [movements, setMovements] = useState<CatalogProductStockMovementsResult | null>(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!movementsLog) {
      setMovements(null);
      setMovementsError(null);
      setMovementsLoading(false);
      return;
    }

    let active = true;
    setMovementsLoading(true);
    setMovementsError(null);
    setMovements(null);
    void fetchCatalogProductStockMovements(product.id, movementsLog.auditedAt)
      .then(result => {
        if (active) setMovements(result);
      })
      .catch(err => {
        if (active) {
          setMovementsError(
            err instanceof Error ? err.message : 'Could not load stock movements.',
          );
        }
      })
      .finally(() => {
        if (active) setMovementsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [product.id, movementsLog]);

  const sortedLogs = useMemo(() => {
    const rows = [...logs];
    rows.sort((a, b) => {
      const aTime = new Date(a.auditedAt).getTime();
      const bTime = new Date(b.auditedAt).getTime();
      const safeA = Number.isNaN(aTime) ? 0 : aTime;
      const safeB = Number.isNaN(bTime) ? 0 : bTime;
      return sortDirection === 'desc' ? safeB - safeA : safeA - safeB;
    });
    return rows;
  }, [logs, sortDirection]);

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

  const toggleSort = () => {
    setSortDirection(prev => (prev === 'desc' ? 'asc' : 'desc'));
  };

  const closeMovements = () => setMovementsLog(null);

  const movementsModal = movementsLog
    ? createPortal(
      <div
        className="spare-link-editor-backdrop product-audit-movements-backdrop"
        role="presentation"
        onClick={closeMovements}
      >
        <div
          className="product-audit-movements panel glass"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-audit-movements-title"
          onClick={event => event.stopPropagation()}
        >
          <header className="product-audit-movements__header">
            <div>
              <h2 id="product-audit-movements-title">Stock movements</h2>
              <p className="text-muted text-sm">
                Up to {formatAuditDate(movementsLog.auditedAt)}{' '}
                {formatAuditTime(movementsLog.auditedAt)}
                {movements
                  ? ` · last ${movements.lookbackDays} days · ${movements.movementCount} event${movements.movementCount === 1 ? '' : 's'}`
                  : null}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={closeMovements}
              aria-label="Close"
            >
              <X size={16} aria-hidden />
            </button>
          </header>

          {movementsLoading && (
            <p className="product-audit-movements__status">Loading from Zoho…</p>
          )}
          {movementsError && (
            <p className="product-audit-log__error">{movementsError}</p>
          )}

          {!movementsLoading && movements && (
            <>
              <p className="product-audit-movements__net text-sm">
                Net change in window:{' '}
                <strong className={diffClassName(movements.netDelta)}>
                  {qtyDeltaDisplay(movements.netDelta)}
                </strong>
                {' '}
                {product.unit}
                {movements.unexplainedGap != null && movements.unexplainedGap !== 0 ? (
                  <>
                    {' · '}
                    <strong className={diffClassName(movements.unexplainedGap)}>
                      unexplained vs Zoho {qtyDeltaDisplay(movements.unexplainedGap)}
                    </strong>
                  </>
                ) : null}
              </p>
              <div className="product-audit-movements__table-wrap">
                <table className="product-audit-movements__table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Type</th>
                      <th scope="col">Document</th>
                      <th scope="col">Party</th>
                      <th scope="col">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.movements.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No invoices, bills, credit notes, or adjustments in this window.</td>
                      </tr>
                    ) : (
                      [...movements.movements]
                        .filter(row => String(row.type) !== 'package')
                        .reverse()
                        .map(row => (
                        <tr key={`${row.type}-${row.documentId}-${row.createdAt}`}>
                          <td>
                            <div className="product-audit-log__datetime">
                              <strong>
                                {row.createdAt
                                  ? formatAuditDate(row.createdAt)
                                  : row.date || '—'}
                              </strong>
                              <span>
                                {row.createdAt ? formatAuditTime(row.createdAt) : ''}
                              </span>
                            </div>
                          </td>
                          <td>{row.typeLabel}</td>
                          <td>
                            <strong>{row.documentNumber || '—'}</strong>
                            {row.reference ? (
                              <span className="product-audit-movements__ref">{row.reference}</span>
                            ) : null}
                          </td>
                          <td>{row.customerOrVendor || '—'}</td>
                          <td className={diffClassName(row.qtyDelta)}>
                            {qtyDeltaDisplay(row.qtyDelta)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={`product-audit-log ${embedded ? 'product-audit-log--embedded' : ''}`}>
      <div className="product-audit-log__header">
        <div className="product-audit-log__title-block">
          <h3 className="product-audit-log__title">Audit Log List</h3>
          <p className="product-audit-log__count">Total Logs: {loading ? '…' : logs.length}</p>
        </div>
        {canRecord && (
          <button
            type="button"
            className="btn btn-primary btn-sm product-audit-log__record-btn"
            disabled={recording || loading}
            onClick={() => void handleRecord()}
          >
            {recording ? <RefreshCw size={14} className="spin-icon" aria-hidden /> : null}
            {recording ? 'Recording…' : 'Record audit'}
          </button>
        )}
      </div>

      {error && <p className="product-audit-log__error">{error}</p>}

      <div className="product-audit-log__table-wrap">
        <table className="product-audit-log__table">
          <colgroup>
            <col className="product-audit-log__col product-audit-log__col--auditor" />
            <col className="product-audit-log__col product-audit-log__col--date" />
            <col className="product-audit-log__col product-audit-log__col--qty" />
            <col className="product-audit-log__col product-audit-log__col--qty" />
            <col className="product-audit-log__col product-audit-log__col--diff" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="product-audit-log__th-full">Auditor Name</span>
                <span className="product-audit-log__th-short">Auditor</span>
              </th>
              <th scope="col">
                <button
                  type="button"
                  className="product-audit-log__sort-btn"
                  onClick={toggleSort}
                  aria-label={`Sort by date and time ${sortDirection === 'desc' ? 'oldest first' : 'newest first'}`}
                >
                  <span className="product-audit-log__th-full">Date &amp; Time</span>
                  <span className="product-audit-log__th-short">Date</span>
                  {sortDirection === 'desc'
                    ? <ArrowDown size={12} aria-hidden />
                    : <ArrowUp size={12} aria-hidden />}
                </button>
              </th>
              <th scope="col">Zoho</th>
              <th scope="col">Audit</th>
              <th scope="col">+/-</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="product-audit-log__empty-row">
                <td colSpan={5}>Loading audit logs…</td>
              </tr>
            ) : sortedLogs.length === 0 ? (
              <tr className="product-audit-log__empty-row">
                <td colSpan={5}>No audit logs yet.</td>
              </tr>
            ) : (
              sortedLogs.map(log => {
                const name = auditorDisplayName(log);
                const isZohoSync = log.trigger === 'zoho_sync';
                return (
                  <tr key={log.id} className={isZohoSync ? 'product-audit-log__row--zoho-sync' : undefined}>
                    <td>
                      <strong className="product-audit-log__auditor-name">{name}</strong>
                      {isZohoSync && (
                        <span className="product-audit-log__trigger-note">Stock sync</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="product-audit-log__datetime-btn"
                        onClick={() => setMovementsLog(log)}
                        title="View Zoho stock movements up to this time"
                      >
                        <div className="product-audit-log__datetime">
                          <strong>{formatAuditDate(log.auditedAt)}</strong>
                          <span>{formatAuditTime(log.auditedAt)}</span>
                        </div>
                      </button>
                    </td>
                    <td className="product-audit-log__qty">
                      {formatStockQuantity(log.zohoQtyAtAudit, product.unit)}
                    </td>
                    <td className="product-audit-log__qty">
                      {formatStockQuantity(log.physicalQty, product.unit)}
                    </td>
                    <td className={diffClassName(log.baselineDifference)}>
                      {diffDisplay(log.baselineDifference)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {movementsModal}
    </div>
  );
};
