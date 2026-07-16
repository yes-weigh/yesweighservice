import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchCatalogProductLifetimeStockMovements } from '../../lib/catalogProductAudit/data';
import { formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogProductStockMovementsResult } from '../../types/catalog-product-audit';

function qtyDeltaClass(value: number): string {
  if (value < 0) return 'product-stock-movements__delta is-out';
  if (value > 0) return 'product-stock-movements__delta is-in';
  return 'product-stock-movements__delta is-flat';
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export const ProductStockMovementsPanel: React.FC<{
  product: CatalogProduct;
}> = ({ product }) => {
  const [data, setData] = useState<CatalogProductStockMovementsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = data != null;

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, [product.id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalogProductLifetimeStockMovements(product.id);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock movements.');
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  return (
    <div className="product-stock-movements">
      <div className="product-stock-movements__toolbar">
        <div className="product-stock-movements__intro">
          <h3 className="product-stock-movements__title">Stock movements</h3>
          {hasFetched ? (
            <p className="text-muted text-sm">
              {data.movementCount} transaction{data.movementCount === 1 ? '' : 's'}
              {data.currentStock != null
                ? ` · Zoho stock ${formatStockQuantity(data.currentStock, product.unit)}`
                : ''}
              {data.fetchedAt
                ? ` · fetched ${new Date(data.fetchedAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
                : ''}
            </p>
          ) : (
            <p className="text-muted text-sm">
              Load lifetime Zoho invoices, bills, credit notes, adjustments, and transfers.
            </p>
          )}
        </div>

        {!hasFetched ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <>
                <RefreshCw size={14} className="spin-icon" aria-hidden />
                Fetching…
              </>
            ) : (
              'Fetch all stock movements'
            )}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <>
                <RefreshCw size={14} className="spin-icon" aria-hidden />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCw size={14} aria-hidden />
                Refresh
              </>
            )}
          </button>
        )}
      </div>

      {error && <p className="product-stock-movements__error">{error}</p>}

      {!hasFetched && !loading && !error && (
        <div className="product-detail-tab-panel__placeholder product-stock-movements__empty">
          <p className="product-detail-tab-panel__placeholder-title">Stock ledger</p>
          <p className="text-muted text-sm">
            Click “Fetch all stock movements” to load the full Zoho transaction history for this item.
          </p>
        </div>
      )}

      {loading && !hasFetched && (
        <p className="product-stock-movements__status">Loading lifetime movements from Zoho…</p>
      )}

      {hasFetched && (
        <div className="product-stock-movements__table-wrap">
          <table className="product-stock-movements__table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Document</th>
                <th scope="col">Party</th>
                <th scope="col">In / Out</th>
                <th scope="col">Running</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.length === 0 ? (
                <tr>
                  <td colSpan={7}>No stock movements found for this item.</td>
                </tr>
              ) : (
                data.movements.map(row => (
                  <tr key={`${row.type}-${row.documentId}-${row.date}-${row.qtyDelta}`}>
                    <td>{row.date || '—'}</td>
                    <td>{row.typeLabel}</td>
                    <td>
                      <strong>{row.documentNumber || '—'}</strong>
                      {row.reference ? (
                        <span className="product-stock-movements__ref">{row.reference}</span>
                      ) : null}
                    </td>
                    <td>{row.customerOrVendor || '—'}</td>
                    <td className={qtyDeltaClass(row.qtyDelta)}>
                      {formatDelta(row.qtyDelta)}
                    </td>
                    <td className="product-stock-movements__running">
                      {row.runningStock != null
                        ? formatStockQuantity(row.runningStock, product.unit)
                        : '—'}
                    </td>
                    <td>{row.status || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
