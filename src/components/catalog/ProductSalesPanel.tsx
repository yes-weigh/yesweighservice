import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { formatStockQuantity } from '../../lib/catalog';
import { loadCatalogProductStockLedger, isBrokenStockLedger } from '../../lib/catalogProductAudit/loadStockLedger';
import {
  formatPeriodLabel,
  inPeriod,
  resolvePeriodBounds,
  type PeriodPreset,
} from '../../lib/catalogProductAudit/stockLedgerPeriod';
import type { CatalogProduct } from '../../types/catalog';
import type {
  CatalogProductStockMovementsResult,
  CatalogStockMovement,
} from '../../types/catalog-product-audit';

interface CustomerSalesRow {
  customerKey: string;
  customerName: string;
  invoiceCount: number;
  returnCount: number;
  qtySold: number;
  qtyReturned: number;
  netQty: number;
  lastSaleDate: string;
}

function isVoidRow(row: CatalogStockMovement): boolean {
  return row.affectsStock === false && String(row.status).toLowerCase().includes('void');
}

function isSalesMovement(row: CatalogStockMovement): boolean {
  return row.type === 'invoice' || row.type === 'creditnote' || row.type === 'salesreturn';
}

function soldQty(row: CatalogStockMovement): number {
  if (isVoidRow(row)) return 0;
  return Math.abs(Number(row.quantity) || Math.abs(Number(row.displayQtyDelta ?? row.qtyDelta) || 0));
}

function aggregateSalesByCustomer(rows: CatalogStockMovement[]): CustomerSalesRow[] {
  const byCustomer = new Map<string, CustomerSalesRow>();

  for (const row of rows) {
    if (!isSalesMovement(row)) continue;

    const customerName = String(row.customerOrVendor ?? '').trim() || 'Unknown customer';
    const customerKey = customerName.toLowerCase();
    const existing = byCustomer.get(customerKey) ?? {
      customerKey,
      customerName,
      invoiceCount: 0,
      returnCount: 0,
      qtySold: 0,
      qtyReturned: 0,
      netQty: 0,
      lastSaleDate: '',
    };

    const qty = soldQty(row);
    const date = String(row.date || '').slice(0, 10);

    if (row.type === 'invoice') {
      if (!isVoidRow(row)) {
        existing.invoiceCount += 1;
        existing.qtySold += qty;
        if (date && date > existing.lastSaleDate) existing.lastSaleDate = date;
      }
    } else if (qty > 0) {
      existing.returnCount += 1;
      existing.qtyReturned += qty;
    }

    byCustomer.set(customerKey, existing);
  }

  return [...byCustomer.values()]
    .map(row => ({
      ...row,
      netQty: row.qtySold - row.qtyReturned,
    }))
    .filter(row => row.invoiceCount > 0 || row.returnCount > 0)
    .sort((a, b) => {
      if (b.netQty !== a.netQty) return b.netQty - a.netQty;
      if (b.qtySold !== a.qtySold) return b.qtySold - a.qtySold;
      return a.customerName.localeCompare(b.customerName);
    });
}

function formatSaleDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const ProductSalesPanel: React.FC<{
  product: CatalogProduct;
}> = ({ product }) => {
  const [data, setData] = useState<CatalogProductStockMovementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('lifetime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const unit = product.unit || 'nos';

  const load = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await loadCatalogProductStockLedger(product.id, forceRefresh);
      if (isBrokenStockLedger(result)) {
        setError('Could not load sales from Zoho. Try Refresh again.');
      }
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sales.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [product.id]);

  useEffect(() => {
    setData(null);
    setError(null);
    setPeriodPreset('lifetime');
    setCustomFrom('');
    setCustomTo('');
    void load(false);
  }, [product.id, load]);

  const period = useMemo(
    () => resolvePeriodBounds(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo],
  );

  const periodSalesRows = useMemo(() => {
    if (!data) return [];
    const salesOnly = data.movements.filter(row => isSalesMovement(row));
    return salesOnly.filter(row => inPeriod(row.date, period.from, period.to));
  }, [data, period.from, period.to]);

  const customerRows = useMemo(
    () => aggregateSalesByCustomer(periodSalesRows),
    [periodSalesRows],
  );

  const summary = useMemo(() => {
    const customers = customerRows.length;
    let totalSold = 0;
    let totalReturned = 0;
    for (const row of customerRows) {
      totalSold += row.qtySold;
      totalReturned += row.qtyReturned;
    }
    return {
      customers,
      totalSold,
      totalReturned,
      netSold: totalSold - totalReturned,
    };
  }, [customerRows]);

  const dateRangeLabel = useMemo(
    () => formatPeriodLabel(periodPreset, period.from, period.to),
    [periodPreset, period.from, period.to],
  );

  const lastUpdated = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    : null;

  const imageUrl = product.imageUrl || product.imageUrls?.[0] || null;
  const hasData = data != null;

  return (
    <div className="stock-ledger stock-ledger--sales">
      <header className="stock-ledger__header">
        <h3 className="stock-ledger__title">Sales Ledger</h3>
        <button
          type="button"
          className="stock-ledger__refresh"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          aria-label="Refresh from Zoho"
          title="Refresh from Zoho"
        >
          <RefreshCw size={16} className={refreshing || (loading && !hasData) ? 'spin-icon' : undefined} aria-hidden />
        </button>
      </header>

      <section className="stock-ledger__product" aria-label="Product">
        <div className="stock-ledger__product-media">
          {imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : (
            <span className="stock-ledger__product-placeholder" aria-hidden />
          )}
        </div>
        <div className="stock-ledger__product-meta">
          <p className="stock-ledger__product-name">{product.name}</p>
          <p className="stock-ledger__product-line">
            <span>SKU:</span> {product.sku || '—'}
          </p>
          <p className="stock-ledger__product-line">
            <span>Unit:</span> {unit}
          </p>
        </div>
      </section>

      {error && <p className="stock-ledger__error">{error}</p>}

      {loading && !hasData && (
        <p className="stock-ledger__status">Loading sales ledger…</p>
      )}

      {hasData && (
        <>
          <section className="stock-ledger__summary" aria-label="Sales summary">
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Customers</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {summary.customers.toLocaleString('en-IN')}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Total Sold</span>
              <strong className="stock-ledger__stat-value is-out">
                {formatStockQuantity(summary.totalSold, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Returns</span>
              <strong className="stock-ledger__stat-value is-in">
                {formatStockQuantity(summary.totalReturned, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Net Sold</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {formatStockQuantity(summary.netSold, unit)}
              </strong>
            </div>
          </section>

          <div className="stock-ledger__filters">
            <label className="stock-ledger__filter stock-ledger__filter--period">
              <span className="visually-hidden">Period</span>
              <select
                value={periodPreset}
                onChange={e => setPeriodPreset(e.target.value as PeriodPreset)}
                aria-label="Period"
              >
                <option value="month">This month</option>
                <option value="financial_year">This year (financial year)</option>
                <option value="lifetime">Lifetime</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {periodPreset === 'custom' ? (
              <div className="stock-ledger__custom-dates">
                <label className="stock-ledger__filter">
                  <span className="visually-hidden">Start date</span>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    aria-label="Start date"
                  />
                </label>
                <span className="stock-ledger__custom-sep" aria-hidden>–</span>
                <label className="stock-ledger__filter">
                  <span className="visually-hidden">End date</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    aria-label="End date"
                  />
                </label>
              </div>
            ) : null}
            <p className="stock-ledger__filter-hint text-muted text-sm">{dateRangeLabel}</p>
          </div>

          <div className="stock-ledger__table-wrap">
            <table className="stock-ledger__table stock-ledger__table--sales">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Invoices</th>
                  <th scope="col">Last sale</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Returns</th>
                  <th scope="col">Net qty</th>
                </tr>
              </thead>
              <tbody>
                {customerRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No sales in this period.</td>
                  </tr>
                ) : (
                  customerRows.map(row => (
                    <tr key={row.customerKey}>
                      <td>
                        <div className="stock-ledger__customer">
                          <span className="stock-ledger__type-icon stock-ledger__type-icon--inline" aria-hidden>
                            <ShoppingCart size={14} />
                          </span>
                          <strong>{row.customerName}</strong>
                        </div>
                      </td>
                      <td>{row.invoiceCount.toLocaleString('en-IN')}</td>
                      <td>{formatSaleDate(row.lastSaleDate)}</td>
                      <td className="stock-ledger__qty is-out">
                        <strong>{row.qtySold.toLocaleString('en-IN')}</strong>
                        <span>{unit}</span>
                      </td>
                      <td className="stock-ledger__qty is-in">
                        <strong>{row.qtyReturned.toLocaleString('en-IN')}</strong>
                        <span>{unit}</span>
                      </td>
                      <td className="stock-ledger__closing">
                        <strong>{row.netQty.toLocaleString('en-IN')}</strong>
                        <span>{unit}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <footer className="stock-ledger__footer">
            <p>Sorted by net quantity bought — highest first. Void invoices excluded.</p>
            {lastUpdated ? (
              <p>
                Last updated: {lastUpdated}
                {data.fromCache ? ' (saved)' : ''}
              </p>
            ) : null}
          </footer>
        </>
      )}
    </div>
  );
};
