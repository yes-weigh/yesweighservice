import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { formatCurrency } from '../../../lib/catalog';
import {
  backfillGatcReportsFromInvoices,
  gatcReportMatchesQuery,
  listGatcReports,
  type GatcReportDoc,
} from '../../../lib/gatcReports';

const PAGE_SIZE = 25;

export const GatcReportTab: React.FC = () => {
  const { user } = useAuth();
  const canBackfill = user?.role === 'super_admin';
  const [rows, setRows] = useState<GatcReportDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Stamping-only ledger (also filters legacy zero-fee docs).
      setRows((await listGatcReports(500)).filter(report => report.hasStamping));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GATC report.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    return rows.filter(report => {
      if (dateFrom && (report.invoiceDate || '') < dateFrom) return false;
      if (dateTo && (report.invoiceDate || '') > dateTo) return false;
      return gatcReportMatchesQuery(report, search);
    });
  }, [rows, search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const kpis = useMemo(() => {
    const gatcFeeTotal = filtered.reduce((sum, row) => sum + row.totals.gatcFeeTotal, 0);
    const stampedQty = filtered.reduce((sum, row) => sum + row.totals.stampedQty, 0);
    return {
      invoiceCount: filtered.length,
      gatcFeeTotal,
      stampedQty,
    };
  }, [filtered]);

  const runBackfill = async () => {
    if (!canBackfill || backfilling) return;
    setBackfilling(true);
    setError('');
    setNotice('');
    try {
      const result = await backfillGatcReportsFromInvoices();
      setNotice(
        `Indexed ${result.wrote.toLocaleString('en-IN')} stamped invoice`
        + `${result.wrote === 1 ? '' : 's'}`
        + ` from ${result.scannedInvoices.toLocaleString('en-IN')} scanned`
        + (result.deletedZero
          ? ` · removed ${result.deletedZero.toLocaleString('en-IN')} zero-fee rows`
          : '')
        + (result.errors ? ` · ${result.errors} errors` : ''),
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GATC invoice backfill failed.');
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <section className="gatc-report">
      <header className="gatc-report__masthead">
        <div>
          <h3 className="gatc-report__title">GATC report</h3>
          <p className="gatc-report__lede text-muted text-sm">
            Stamping charges on portal invoices (payment verify / invoice sync).
          </p>
        </div>
        <div className="gatc-report__masthead-actions">
          {canBackfill ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || backfilling}
              onClick={() => void runBackfill()}
            >
              {backfilling ? 'Indexing…' : 'Index from invoices'}
            </button>
          ) : null}
          <button
            type="button"
            className="gatc-report__icon-btn"
            disabled={loading || backfilling}
            onClick={() => void loadAll()}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading || backfilling ? 'spin-icon' : undefined} aria-hidden />
          </button>
        </div>
      </header>

      {error ? <p className="gatc-report__error text-sm">{error}</p> : null}
      {notice ? <p className="gatc-report__notice text-sm">{notice}</p> : null}

      {loading ? (
        <div className="gatc-report__loading">
          <div className="loader-ring" />
        </div>
      ) : (
        <>
          <div className="gatc-report__hero" aria-label="GATC summary">
            <div className="gatc-report__metric">
              <span>Invoices</span>
              <strong>{kpis.invoiceCount.toLocaleString('en-IN')}</strong>
            </div>
            <div className="gatc-report__metric">
              <span>Stamped qty</span>
              <strong>{kpis.stampedQty.toLocaleString('en-IN')}</strong>
            </div>
            <div className="gatc-report__metric gatc-report__metric--hero">
              <span>GATC fees</span>
              <strong>{formatCurrency(kpis.gatcFeeTotal)}</strong>
            </div>
          </div>

          <div className="gatc-report__filters">
            <label className="gatc-report__search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                placeholder="Search invoice, customer, SKU, range…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <label className="gatc-report__date">
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </label>
            <label className="gatc-report__date">
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="gatc-report__empty">
              <FileText size={28} aria-hidden />
              <strong>{rows.length === 0 ? 'No stamped invoices yet' : 'No matching invoices'}</strong>
              <p className="text-muted text-sm">
                {rows.length === 0
                  ? (canBackfill
                    ? 'Run “Index from invoices” after deploy, or wait for payment-verified stamped invoices.'
                    : 'Entries appear when a stamped portal invoice is created or synced.')
                  : 'Try clearing search or date filters.'}
              </p>
            </div>
          ) : (
            <>
              <ul className="gatc-report__list" aria-label="GATC invoice ledger">
                {pageRows.map(report => {
                  const open = expandedId === report.id;
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        className={`gatc-report__row${open ? ' is-open' : ''}`}
                        aria-expanded={open}
                        onClick={() => setExpandedId(open ? null : report.id)}
                      >
                        <span className="gatc-report__row-main">
                          <strong>
                            {report.invoiceNumber || report.invoiceId}
                            <em className="gatc-report__badge">Stamped</em>
                          </strong>
                          <em>
                            {[
                              report.customerName,
                              report.invoiceDate,
                              report.salespersonName,
                              report.salesOrderNumber ? `SO ${report.salesOrderNumber}` : null,
                            ].filter(Boolean).join(' · ')}
                          </em>
                        </span>
                        <span className="gatc-report__row-side">
                          <span className="gatc-report__row-meta">
                            {report.totals.stampedLineCount.toLocaleString('en-IN')} stamped
                            {' · '}
                            {report.totals.lineCount.toLocaleString('en-IN')} lines
                          </span>
                          <span className="gatc-report__row-price">
                            {formatCurrency(report.totals.gatcFeeTotal)}
                          </span>
                        </span>
                      </button>
                      {open ? (
                        <div className="gatc-report__detail">
                          <div className="gatc-report__detail-totals">
                            <span>
                              Base
                              {' '}
                              <strong>{formatCurrency(report.totals.baseTotal)}</strong>
                            </span>
                            <span>
                              GATC
                              {' '}
                              <strong>{formatCurrency(report.totals.gatcFeeTotal)}</strong>
                            </span>
                            <span>
                              Lines
                              {' '}
                              <strong>{formatCurrency(report.totals.lineTotal)}</strong>
                            </span>
                          </div>
                          <div className="gatc-report__table-wrap">
                            <table className="gatc-report__table">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Item</th>
                                  <th className="is-num">Qty</th>
                                  <th className="is-num">Base</th>
                                  <th>Stamping</th>
                                  <th className="is-num">Fee</th>
                                  <th className="is-num">Line</th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.lineItems.map((line, index) => (
                                  <tr
                                    key={`${line.productId || line.itemId || 'line'}-${index}`}
                                    className={line.hasStamping ? 'is-stamped' : undefined}
                                  >
                                    <td>{line.sku || '—'}</td>
                                    <td>{line.name}</td>
                                    <td className="is-num">{line.qty.toLocaleString('en-IN')}</td>
                                    <td className="is-num">{formatCurrency(line.baseRate)}</td>
                                    <td>
                                      {line.hasStamping
                                        ? (line.gatcStampingRange || 'Stamped')
                                        : 'Without'}
                                    </td>
                                    <td className="is-num">
                                      {line.hasStamping
                                        ? formatCurrency(line.gatcFeePerUnit)
                                        : '—'}
                                    </td>
                                    <td className="is-num">{formatCurrency(line.lineTotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {totalPages > 1 ? (
                <footer className="invoices-pagination gatc-report__pagination">
                  <span className="invoices-pagination__info text-muted text-sm">
                    {pageRows.length
                      ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + pageRows.length}`
                      : '0'}
                    {' of '}
                    {filtered.length.toLocaleString('en-IN')}
                  </span>
                  <div className="invoices-pagination__btns">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="invoices-pagination__page text-sm">
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </footer>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
};
