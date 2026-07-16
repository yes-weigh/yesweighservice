import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Undo2,
} from 'lucide-react';
import {
  StockLedgerPagination,
  useLedgerPagination,
} from './StockLedgerPagination';
import { fetchCatalogProductLifetimeStockMovements } from '../../lib/catalogProductAudit/data';
import { formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct } from '../../types/catalog';
import type {
  CatalogProductStockMovementsResult,
  CatalogStockMovement,
  CatalogStockMovementType,
} from '../../types/catalog-product-audit';

type TypeFilter = 'all' | CatalogStockMovementType;
type PeriodPreset = 'month' | 'financial_year' | 'lifetime' | 'custom';

const TYPE_META: Record<
  CatalogStockMovementType,
  { label: string; docPrefix: string; tone: string; Icon: typeof ShoppingCart }
> = {
  invoice: { label: 'Sales', docPrefix: 'Invoice', tone: 'sales', Icon: ShoppingCart },
  bill: { label: 'Purchase', docPrefix: 'Bill', tone: 'purchase', Icon: Truck },
  creditnote: { label: 'Credit note', docPrefix: 'Credit note', tone: 'return', Icon: Undo2 },
  salesreturn: { label: 'Sales return', docPrefix: 'Return', tone: 'sales-return', Icon: RotateCcw },
  adjustment: { label: 'Adjustment', docPrefix: 'Adjustment', tone: 'adjust', Icon: SlidersHorizontal },
  moveorder: { label: 'Stock transfer', docPrefix: 'Transfer', tone: 'transfer', Icon: ArrowLeftRight },
  transferorder: { label: 'Stock transfer', docPrefix: 'Transfer', tone: 'transfer', Icon: ArrowLeftRight },
  purchasereceive: { label: 'Purchase receive', docPrefix: 'Receive', tone: 'purchase', Icon: Truck },
  putaway: { label: 'Putaway', docPrefix: 'Putaway', tone: 'transfer', Icon: ArrowLeftRight },
};

/** Zoho package picks do not move stock — hide if present in older cached ledgers. */
const EXCLUDED_LEDGER_TYPES = new Set<CatalogStockMovementType>(['package']);

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

function stockDelta(row: CatalogStockMovement): number {
  return row.affectsStock === false ? 0 : Number(row.qtyDelta) || 0;
}

function formatLedgerDate(row: CatalogStockMovement): { day: string; time: string } {
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

function qtyClass(value: number, voided = false): string {
  if (voided) return 'stock-ledger__qty is-void';
  if (value < 0) return 'stock-ledger__qty is-out';
  if (value > 0) return 'stock-ledger__qty is-in';
  return 'stock-ledger__qty is-flat';
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Indian financial year starts 1 April. */
function financialYearStart(date: Date): Date {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return new Date(startYear, 3, 1);
}

function formatIsoLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function resolvePeriodBounds(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { from: string | null; to: string | null } {
  if (preset === 'lifetime') return { from: null, to: null };
  if (preset === 'month') {
    return {
      from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: toIsoDate(now),
    };
  }
  if (preset === 'financial_year') {
    return {
      from: toIsoDate(financialYearStart(now)),
      to: toIsoDate(now),
    };
  }
  return {
    from: customFrom.trim() || null,
    to: customTo.trim() || null,
  };
}

function inPeriod(date: string, from: string | null, to: string | null): boolean {
  const d = String(date || '').slice(0, 10);
  if (!d) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export const ProductStockMovementsPanel: React.FC<{
  product: CatalogProduct;
}> = ({ product }) => {
  const [data, setData] = useState<CatalogProductStockMovementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('lifetime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const unit = product.unit || 'nos';

  const ledgerMovements = useMemo(
    () => (data?.movements ?? []).filter(row => !EXCLUDED_LEDGER_TYPES.has(row.type)),
    [data?.movements],
  );

  const load = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      let result = await fetchCatalogProductLifetimeStockMovements(product.id, {
        forceRefresh,
      });
      // Bad empty cache / failed Zoho pull — retry once from Zoho.
      const emptyBroken =
        (!result.movements?.length)
        && (result.currentStock == null)
        && !forceRefresh;
      if (emptyBroken) {
        result = await fetchCatalogProductLifetimeStockMovements(product.id, {
          forceRefresh: true,
        });
      }
      if ((!result.movements?.length) && result.currentStock == null) {
        setError('Could not load stock movements from Zoho. Try Refresh again.');
      }
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
    setPeriodPreset('lifetime');
    setCustomFrom('');
    setCustomTo('');
    setTypeFilter('all');
    void load(false);
  }, [product.id, load]);

  const period = useMemo(
    () => resolvePeriodBounds(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo],
  );

  const periodRows = useMemo(() => {
    if (!data) return [];
    return ledgerMovements.filter(row => inPeriod(row.date, period.from, period.to));
  }, [data, ledgerMovements, period.from, period.to]);

  const filteredRows = useMemo(() => {
    if (typeFilter === 'all') return periodRows;
    return periodRows.filter(row => row.type === typeFilter);
  }, [periodRows, typeFilter]);

  const paginationResetKey = `${product.id}:${periodPreset}:${period.from ?? ''}:${period.to ?? ''}:${typeFilter}`;
  const {
    page,
    setPage,
    totalPages,
    paginatedRows,
    totalCount,
    rangeStart,
    rangeEnd,
  } = useLedgerPagination(filteredRows, paginationResetKey);

  const summary = useMemo(() => {
    if (!data) {
      return { opening: 0, totalIn: 0, totalOut: 0, closing: 0 };
    }

    const oldestAll = [...ledgerMovements].reverse();
    let opening = 0;
    if (period.from) {
      for (const row of oldestAll) {
        const d = String(row.date || '').slice(0, 10);
        if (d && d < period.from) opening += stockDelta(row);
      }
    }

    let totalIn = 0;
    let totalOut = 0;
    for (const row of periodRows) {
      const delta = stockDelta(row);
      if (delta > 0) totalIn += delta;
      if (delta < 0) totalOut += Math.abs(delta);
    }

    const closing = opening + totalIn - totalOut;

    return { opening, totalIn, totalOut, closing };
  }, [data, ledgerMovements, period.from, periodRows]);

  const typeOptions = useMemo(() => {
    if (!data) return [] as CatalogStockMovementType[];
    const seen = new Set<CatalogStockMovementType>();
    for (const row of ledgerMovements) seen.add(row.type);
    return [...seen].sort((a, b) => TYPE_META[a].label.localeCompare(TYPE_META[b].label));
  }, [data, ledgerMovements]);

  const dateRangeLabel = useMemo(() => {
    if (periodPreset === 'lifetime') return 'Lifetime';
    if (periodPreset === 'month') {
      return period.from && period.to
        ? `${formatIsoLabel(period.from)} - ${formatIsoLabel(period.to)}`
        : 'This month';
    }
    if (periodPreset === 'financial_year') {
      return period.from && period.to
        ? `FY ${formatIsoLabel(period.from)} - ${formatIsoLabel(period.to)}`
        : 'This financial year';
    }
    if (period.from && period.to) return `${formatIsoLabel(period.from)} - ${formatIsoLabel(period.to)}`;
    if (period.from) return `From ${formatIsoLabel(period.from)}`;
    if (period.to) return `Until ${formatIsoLabel(period.to)}`;
    return 'Pick a custom date range';
  }, [periodPreset, period.from, period.to]);

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
    <div className="stock-ledger">
      <header className="stock-ledger__header">
        <h3 className="stock-ledger__title">Stock Ledger</h3>
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
        <p className="stock-ledger__status">Loading stock ledger…</p>
      )}

      {hasData && data.unexplainedGap != null && data.unexplainedGap !== 0 && (
        <div className="stock-ledger__gap is-alert" role="status">
          <strong>Unexplained stock: {formatDelta(data.unexplainedGap)}</strong>
          <span>
            Zoho book ({formatStockQuantity(data.currentStock ?? 0, unit)}) does not match
            listed stock-affecting transactions ({formatDelta(data.netDelta)}).
          </span>
        </div>
      )}

      {hasData && (
        <>
          <section className="stock-ledger__summary" aria-label="Stock summary">
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Opening Stock</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {formatStockQuantity(summary.opening, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Total In</span>
              <strong className="stock-ledger__stat-value is-in">
                {formatStockQuantity(summary.totalIn, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Total Out</span>
              <strong className="stock-ledger__stat-value is-out">
                {formatStockQuantity(summary.totalOut, unit)}
              </strong>
            </div>
            <div className="stock-ledger__stat">
              <span className="stock-ledger__stat-label">Closing Stock</span>
              <strong className="stock-ledger__stat-value is-neutral">
                {formatStockQuantity(summary.closing, unit)}
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
            <label className="stock-ledger__filter stock-ledger__filter--type">
              <span className="visually-hidden">Transaction type</span>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as TypeFilter)}
                aria-label="Transaction type"
              >
                <option value="all">All Transactions</option>
                {typeOptions.map(type => (
                  <option key={type} value={type}>{TYPE_META[type].label}</option>
                ))}
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
            label="Stock movements pagination"
          />

          <div className="stock-ledger__table-wrap">
            <table className="stock-ledger__table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Details</th>
                  <th scope="col">In/Out</th>
                  <th scope="col">Closing Stock</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No transactions in this filter.</td>
                  </tr>
                ) : (
                  paginatedRows.map((row, rowIndex) => {
                    const meta = TYPE_META[row.type] ?? TYPE_META.adjustment;
                    const Icon = meta.Icon;
                    const voided = isVoidRow(row);
                    const delta = displayDelta(row);
                    const when = formatLedgerDate(row);
                    const closing = row.runningStock;
                    return (
                      <tr
                        key={`${row.type}-${row.documentId}-${row.date}-${delta}-${row.status}-${rowIndex}`}
                        className={voided ? 'is-void-row' : undefined}
                      >
                        <td>
                          <div className="stock-ledger__when">
                            <strong>{when.day}</strong>
                            {when.time ? <span>{when.time}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className={`stock-ledger__type is-${meta.tone}`}>
                            <span className="stock-ledger__type-icon" aria-hidden>
                              <Icon size={14} />
                            </span>
                            <span>{meta.label}</span>
                          </div>
                        </td>
                        <td>
                          <div className="stock-ledger__details">
                            <p>
                              {meta.docPrefix}: <strong>{row.documentNumber || '—'}</strong>
                            </p>
                            {row.customerOrVendor ? <p>{row.customerOrVendor}</p> : null}
                            {row.reference ? (
                              <p className="stock-ledger__ref">{row.reference}</p>
                            ) : null}
                            {voided || row.status ? (
                              <p className="stock-ledger__status-line">
                                {row.status}
                                {voided ? ' · no stock effect' : ''}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className={qtyClass(delta, voided)}>
                          <strong>{formatDelta(delta)}</strong>
                          <span>{unit}</span>
                        </td>
                        <td className="stock-ledger__closing">
                          <strong>
                            {closing != null
                              ? Number(closing).toLocaleString('en-IN')
                              : '—'}
                          </strong>
                          <span>{unit}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <StockLedgerPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onPageChange={setPage}
            label="Stock movements pagination"
          />

          <footer className="stock-ledger__footer">
            <p>Closing stock is calculated after each transaction.</p>
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
