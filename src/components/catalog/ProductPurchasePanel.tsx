import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatCurrency, formatStockQuantity } from '../../lib/catalog';
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
import {
  StockLedgerPagination,
  useLedgerPagination,
} from './StockLedgerPagination';

function doesNotAffectPurchase(row: CatalogStockMovement): boolean {
  if (row.affectsStock === false) {
    const s = String(row.status ?? '').trim().toLowerCase();
    return (
      s === 'draft'
      || s.includes('void')
      || s.includes('cancel')
      || s === 'rejected'
      || s === 'declined'
    );
  }
  return false;
}

function isPurchaseBill(row: CatalogStockMovement): boolean {
  return row.type === 'bill';
}

function billQty(row: CatalogStockMovement): number {
  return Math.abs(Number(row.quantity) || Math.abs(Number(row.displayQtyDelta ?? row.qtyDelta) || 0));
}

function formatVendorDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Unknown vendor';
  if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && trimmed.length > 3) {
    const small = new Set(['AND', 'OF', 'THE', 'FOR', 'A', 'AN']);
    return trimmed
      .toLowerCase()
      .split(/(\s+|[-/&])/)
      .map((part, index) => {
        if (!part || /^[\s\-/&]+$/.test(part)) return part;
        const upper = part.toUpperCase();
        if (index > 0 && small.has(upper)) return part.toLowerCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('');
  }
  return trimmed;
}

function formatPurchaseWhen(row: CatalogStockMovement): { day: string; time: string } {
  const iso = row.createdAt || (row.date ? `${row.date}T00:00:00` : '');
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) {
    return { day: row.date || '—', time: '' };
  }
  return {
    day: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: row.createdAt
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      : '',
  };
}

function sortNewestFirst(rows: CatalogStockMovement[]): CatalogStockMovement[] {
  return [...rows].sort((a, b) => {
    const da = String(a.createdAt || a.date || '');
    const db = String(b.createdAt || b.date || '');
    if (da !== db) return db.localeCompare(da);
    return String(b.documentNumber).localeCompare(String(a.documentNumber));
  });
}

function formatPurchaseUnitPrice(row: CatalogStockMovement): string | null {
  const unitPrice = row.itemPrice != null && Number.isFinite(Number(row.itemPrice))
    ? Number(row.itemPrice)
    : null;
  if (unitPrice == null) return null;
  if (row.currencyCode) {
    return formatCurrency(unitPrice, row.currencyCode);
  }
  if (row.currencySymbol) {
    const amount = unitPrice.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${row.currencySymbol}${amount}`;
  }
  return formatCurrency(unitPrice, 'INR');
}

function PurchaseBillTile({
  row,
  unit,
}: {
  row: CatalogStockMovement;
  unit: string;
}) {
  const excluded = doesNotAffectPurchase(row);
  const when = formatPurchaseWhen(row);
  const qty = billQty(row);
  const unitPriceLabel = formatPurchaseUnitPrice(row);
  const name = formatVendorDisplayName(row.customerOrVendor || 'Unknown vendor');

  return (
    <article className={['stock-ledger__purchase-tile', excluded ? 'is-excluded' : ''].filter(Boolean).join(' ')}>
      <strong className="stock-ledger__purchase-tile-name">{name}</strong>
      <div className="stock-ledger__purchase-tile-metrics">
        <span className="stock-ledger__purchase-tile-date">{when.day}</span>
        <span className="stock-ledger__purchase-tile-qty">
          <strong>{qty.toLocaleString('en-IN')}</strong>
          <span>{unit}</span>
        </span>
        <span className="stock-ledger__purchase-tile-price">
          {unitPriceLabel != null ? (
            <>
              {unitPriceLabel}
              <span className="stock-ledger__purchase-tile-price-unit">/ pcs</span>
            </>
          ) : '—'}
        </span>
      </div>
      {when.time ? (
        <span className="stock-ledger__purchase-tile-time">{when.time}</span>
      ) : null}
    </article>
  );
}

export const ProductPurchasePanel: React.FC<{
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
        setError('Could not load purchases from Zoho. Try Refresh again.');
      }
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load purchases.');
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

  const purchaseRows = useMemo(() => {
    if (!data) return [];
    const bills = data.movements
      .filter(row => isPurchaseBill(row))
      .filter(row => inPeriod(row.date, period.from, period.to));
    return sortNewestFirst(bills);
  }, [data, period.from, period.to]);

  const paginationResetKey = `${product.id}:purchase:${periodPreset}:${period.from ?? ''}:${period.to ?? ''}`;
  const {
    page,
    setPage,
    totalPages,
    paginatedRows,
    totalCount,
    rangeStart,
    rangeEnd,
  } = useLedgerPagination(purchaseRows, paginationResetKey);

  const summary = useMemo(() => {
    const vendors = new Set<string>();
    let totalPurchased = 0;
    let billCount = 0;
    for (const row of purchaseRows) {
      if (doesNotAffectPurchase(row)) continue;
      const qty = billQty(row);
      if (qty <= 0) continue;
      billCount += 1;
      totalPurchased += qty;
      const key = String(row.customerOrVendor ?? '').trim().toLowerCase() || 'unknown';
      vendors.add(key);
    }
    return {
      vendors: vendors.size,
      totalPurchased,
      billCount,
    };
  }, [purchaseRows]);

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
    <div className="stock-ledger stock-ledger--purchase">
      <header className="stock-ledger__header">
        <h3 className="stock-ledger__title">Purchase Ledger</h3>
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
            {[product.sku?.trim() || null, unit].filter(Boolean).join(' · ')}
          </p>
        </div>
      </section>

      {error && <p className="stock-ledger__error">{error}</p>}

      {loading && !hasData && (
        <p className="stock-ledger__status">Loading purchase ledger…</p>
      )}

      {hasData && (
        <>
          <section className="stock-ledger__summary" aria-label="Purchase summary">
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Vendors</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {summary.vendors.toLocaleString('en-IN')}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Total Purchased</span>
              <strong className="stock-ledger__stat-value is-in">
                {formatStockQuantity(summary.totalPurchased, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Bills</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {summary.billCount.toLocaleString('en-IN')}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Net Purchased</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {formatStockQuantity(summary.totalPurchased, unit)}
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

          <StockLedgerPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onPageChange={setPage}
            label="Purchase pagination"
          />

          {purchaseRows.length === 0 ? (
            <p className="stock-ledger__empty">No purchases in this period.</p>
          ) : (
            <>
              <div className="stock-ledger__purchase-tiles" aria-label="Purchase bills">
                {paginatedRows.map((row, index) => (
                  <PurchaseBillTile
                    key={`${row.documentId}-${row.date}-${row.status}-${index}`}
                    row={row}
                    unit={unit}
                  />
                ))}
              </div>

              <div className="stock-ledger__table-wrap stock-ledger__table-wrap--sales-desktop">
                <table className="stock-ledger__table stock-ledger__table--sales">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Vendor</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Unit price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((row, index) => {
                      const when = formatPurchaseWhen(row);
                      const excluded = doesNotAffectPurchase(row);
                      const qty = billQty(row);
                      const unitPriceLabel = formatPurchaseUnitPrice(row);
                      return (
                        <tr
                          key={`desk-${row.documentId}-${row.date}-${index}`}
                          className={excluded ? 'is-void-row' : undefined}
                        >
                          <td>
                            <div className="stock-ledger__when">
                              <strong>{when.day}</strong>
                              {when.time ? <span>{when.time}</span> : null}
                            </div>
                          </td>
                          <td>
                            <strong>
                              {formatVendorDisplayName(row.customerOrVendor || 'Unknown vendor')}
                            </strong>
                          </td>
                          <td className={`stock-ledger__qty ${excluded ? 'is-void' : 'is-in'}`}>
                            <strong>{qty.toLocaleString('en-IN')}</strong>
                            <span>{unit}</span>
                          </td>
                          <td className="stock-ledger__closing">
                            {unitPriceLabel != null ? `${unitPriceLabel} per piece` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <StockLedgerPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onPageChange={setPage}
            label="Purchase pagination"
          />

          <footer className="stock-ledger__footer">
            <p>Newest bills first. Draft and void bills stay visible but are excluded from totals.</p>
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
