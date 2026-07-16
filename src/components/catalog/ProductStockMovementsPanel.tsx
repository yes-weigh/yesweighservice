import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchCatalogProductLifetimeStockMovements } from '../../lib/catalogProductAudit/data';
import { formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct } from '../../types/catalog';
import type {
  CatalogProductStockMovementsResult,
  CatalogStockMovement,
} from '../../types/catalog-product-audit';

function qtyDeltaClass(value: number, voided = false): string {
  if (voided) return 'product-stock-movements__delta is-void';
  if (value < 0) return 'product-stock-movements__delta is-out';
  if (value > 0) return 'product-stock-movements__delta is-in';
  return 'product-stock-movements__delta is-flat';
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function isVoidRow(row: CatalogStockMovement): boolean {
  return row.affectsStock === false && String(row.status).toLowerCase().includes('void');
}

function displayDelta(row: CatalogStockMovement): number {
  if (row.displayQtyDelta != null) return row.displayQtyDelta;
  return row.qtyDelta;
}

export const ProductStockMovementsPanel: React.FC<{
  product: CatalogProduct;
}> = ({ product }) => {
  const [data, setData] = useState<CatalogProductStockMovementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalogProductLifetimeStockMovements(product.id, {
        forceRefresh,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock movements.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [product.id]);

  useEffect(() => {
    setData(null);
    setError(null);
    void load(false);
  }, [product.id, load]);

  const hasData = data != null;
  const fetchedLabel = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  return (
    <div className="product-stock-movements">
      <div className="product-stock-movements__toolbar">
        <div className="product-stock-movements__intro">
          <h3 className="product-stock-movements__title">Stock movements</h3>
          {hasData ? (
            <p className="text-muted text-sm">
              {data.movementCount} transaction{data.movementCount === 1 ? '' : 's'}
              {data.currentStock != null
                ? ` · Zoho stock ${formatStockQuantity(data.currentStock, product.unit)}`
                : ''}
              {data.netDelta != null
                ? ` · listed net ${formatDelta(data.netDelta)}`
                : ''}
              {fetchedLabel
                ? ` · ${data.fromCache ? 'saved' : 'fetched'} ${fetchedLabel}`
                : ''}
            </p>
          ) : (
            <p className="text-muted text-sm">
              Zoho invoices, bills, credit notes, adjustments, and transfers for this item.
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
        >
          {refreshing || (loading && !hasData) ? (
            <>
              <RefreshCw size={14} className="spin-icon" aria-hidden />
              {hasData ? 'Refreshing…' : 'Loading…'}
            </>
          ) : (
            <>
              <RefreshCw size={14} aria-hidden />
              Refresh from Zoho
            </>
          )}
        </button>
      </div>

      {error && <p className="product-stock-movements__error">{error}</p>}

      {hasData && data.unexplainedGap != null && data.unexplainedGap !== 0 && (
        <div
          className={`product-stock-movements__gap ${data.unexplainedGap > 0 ? 'is-surplus' : 'is-short'}`}
          role="status"
        >
          <strong>Unexplained stock: {formatDelta(data.unexplainedGap)}</strong>
          <span>
            Zoho book ({formatStockQuantity(data.currentStock ?? 0, product.unit)}) does not match
            the sum of listed transactions ({formatDelta(data.netDelta)}). This gap is not a
            document — investigate missing entries, opening stock, or theft.
          </span>
        </div>
      )}

      {hasData && data.unexplainedGap === 0 && (
        <p className="product-stock-movements__gap is-matched" role="status">
          Listed transactions fully explain Zoho stock
          {data.fromCache ? ' (from saved ledger)' : ''}.
        </p>
      )}

      {loading && !hasData && (
        <p className="product-stock-movements__status">Loading stock movements…</p>
      )}

      {hasData && (
        <div className="product-stock-movements__table-wrap">
          <table className="product-stock-movements__table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Details</th>
                <th scope="col">Document</th>
                <th scope="col">In / Out</th>
                <th scope="col">Running</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.length === 0 ? (
                <tr>
                  <td colSpan={5}>No stock movements found for this item.</td>
                </tr>
              ) : (
                data.movements.map(row => {
                  const voided = isVoidRow(row);
                  const delta = displayDelta(row);
                  return (
                    <tr
                      key={`${row.type}-${row.documentId}-${row.date}-${delta}-${row.status}`}
                      className={voided ? 'is-void-row' : undefined}
                    >
                      <td>{row.date || '—'}</td>
                      <td>
                        <div className="product-stock-movements__party-block">
                          <span
                            className={`product-stock-movements__chip product-stock-movements__chip--type is-${row.type}`}
                          >
                            {row.typeLabel}
                          </span>
                          <span className="product-stock-movements__party">
                            {row.customerOrVendor || '—'}
                          </span>
                          {row.status ? (
                            <span
                              className={`product-stock-movements__chip product-stock-movements__chip--status${voided ? ' is-void' : ''}`}
                            >
                              {row.status}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <strong>{row.documentNumber || '—'}</strong>
                        {row.reference ? (
                          <span className="product-stock-movements__ref">{row.reference}</span>
                        ) : null}
                      </td>
                      <td className={qtyDeltaClass(delta, voided)}>
                        {formatDelta(delta)}
                        {voided ? ' (no stock)' : ''}
                      </td>
                      <td className="product-stock-movements__running">
                        {row.runningStock != null
                          ? formatStockQuantity(row.runningStock, product.unit)
                          : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
