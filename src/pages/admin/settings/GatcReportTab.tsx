import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  IndianRupee,
  Info,
  Package,
  Receipt,
  RefreshCw,
  Search,
  Stamp,
  Upload,
  Wallet,
} from 'lucide-react';
import { formatCurrency } from '../../../lib/catalog';
import {
  gatcReportMatchesQuery,
  listGatcReports,
  type GatcReportDoc,
  type GatcReportLineItem,
} from '../../../lib/gatcReports';

const PAGE_SIZE = 25;
/** First month available in the GATC month filter. */
const GATC_MONTH_START = '2026-04';

function isGatcReportFreightLine(line: Pick<GatcReportLineItem, 'name' | 'sku'>): boolean {
  const name = line.name.trim().toLowerCase();
  if (name === 'freight' || name.includes('freight')) return true;
  const sku = line.sku?.trim().toLowerCase() ?? '';
  return sku === 'freight' || sku.includes('freight');
}

function gatcReportDisplayLines(report: GatcReportDoc): GatcReportLineItem[] {
  return report.lineItems.filter(line => !isGatcReportFreightLine(line));
}

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildMonthOptions(fromYm: string, toYm: string): Array<{ value: string; label: string }> {
  const [fromY, fromM] = fromYm.split('-').map(Number);
  const [toY, toM] = toYm.split('-').map(Number);
  if (!fromY || !fromM || !toY || !toM) return [];

  const options: Array<{ value: string; label: string }> = [];
  let y = fromY;
  let m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    const label = new Date(y, m - 1, 1).toLocaleString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
    options.push({ value, label });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return options.reverse();
}

function parseReportDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  // YYYY-MM-DD (date-only) — treat as local calendar day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatStampedOn(report: GatcReportDoc): { date: string; time: string } {
  const stampedAt = parseReportDate(report.createdAt) ?? parseReportDate(report.invoiceDate);
  if (!stampedAt) return { date: '—', time: '' };
  return {
    date: stampedAt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: stampedAt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

function formatGeneratedAt(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportGatcReportsCsv(reports: GatcReportDoc[], monthLabel: string): void {
  const headers = [
    'Invoice No',
    'Customer',
    'Invoice Date',
    'Salesperson',
    'Sales Order',
    'Stamped Qty',
    'GATC Fees',
    'Stamped On',
  ];
  const lines = [
    headers.join(','),
    ...reports.map(report => {
      const stamped = formatStampedOn(report);
      return [
        report.invoiceNumber || report.invoiceId,
        report.customerName || '',
        report.invoiceDate || '',
        report.salespersonName || '',
        report.salesOrderNumber || '',
        String(report.totals.stampedQty),
        String(report.totals.gatcFeeTotal),
        [stamped.date, stamped.time].filter(Boolean).join(' '),
      ].map(value => csvEscape(String(value))).join(',');
    }),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gatc-billwise-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const GatcReportTab: React.FC = () => {
  const monthOptions = useMemo(
    () => buildMonthOptions(GATC_MONTH_START, currentYearMonth()),
    [],
  );
  const defaultMonth = monthOptions[0]?.value || GATC_MONTH_START;

  const [rows, setRows] = useState<GatcReportDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows((await listGatcReports(500)).filter(report => report.hasStamping));
      setGeneratedAt(new Date());
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
    setExpandedId(null);
  }, [search, month]);

  const filtered = useMemo(() => {
    return rows.filter(report => {
      const invoiceMonth = String(report.invoiceDate || '').slice(0, 7);
      if (month && invoiceMonth !== month) return false;
      return gatcReportMatchesQuery(report, search);
    });
  }, [rows, search, month]);

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
    const invoiceCount = filtered.length;
    return {
      invoiceCount,
      gatcFeeTotal,
      stampedQty,
      avgPerInvoice: invoiceCount > 0 ? gatcFeeTotal / invoiceCount : 0,
    };
  }, [filtered]);

  const monthLabel = monthOptions.find(opt => opt.value === month)?.label || month;

  const handleExport = useCallback(() => {
    exportGatcReportsCsv(filtered, monthLabel);
  }, [filtered, monthLabel]);

  return (
    <section className="gatc-report">
      <header className="gatc-report__masthead">
        <div className="gatc-report__brand">
          <span className="gatc-report__brand-icon" aria-hidden>
            <FileText size={22} strokeWidth={2.25} />
          </span>
          <div>
            <h3 className="gatc-report__title">GATC Billwise Report</h3>
            <p className="gatc-report__lede">
              Stamping charges on portal invoices (payment verify / invoice sync).
            </p>
          </div>
        </div>
        <div className="gatc-report__masthead-actions">
          <button
            type="button"
            className="gatc-report__export-btn"
            disabled={loading || filtered.length === 0}
            onClick={handleExport}
          >
            <Upload size={15} aria-hidden />
            Export Report
          </button>
        </div>
      </header>

      {error ? <p className="gatc-report__error text-sm">{error}</p> : null}

      {loading ? (
        <div className="gatc-report__loading">
          <div className="loader-ring" />
        </div>
      ) : (
        <>
          <div className="gatc-report__kpis" aria-label="GATC summary">
            <article className="gatc-report__kpi gatc-report__kpi--blue">
              <span className="gatc-report__kpi-icon" aria-hidden>
                <FileText size={22} strokeWidth={2.15} />
              </span>
              <div className="gatc-report__kpi-body">
                <span className="gatc-report__kpi-label">Total Invoices</span>
                <strong className="gatc-report__kpi-value">
                  {kpis.invoiceCount.toLocaleString('en-IN')}
                </strong>
                <span className="gatc-report__kpi-sub">This Month</span>
              </div>
            </article>

            <article className="gatc-report__kpi gatc-report__kpi--green">
              <span className="gatc-report__kpi-icon" aria-hidden>
                <Stamp size={22} strokeWidth={2.15} />
              </span>
              <div className="gatc-report__kpi-body">
                <span className="gatc-report__kpi-label">Stamped Qty</span>
                <strong className="gatc-report__kpi-value">
                  {kpis.stampedQty.toLocaleString('en-IN')}
                </strong>
                <span className="gatc-report__kpi-sub">Instruments Stamped</span>
              </div>
            </article>

            <article className="gatc-report__kpi gatc-report__kpi--purple">
              <span className="gatc-report__kpi-icon" aria-hidden>
                <IndianRupee size={22} strokeWidth={2.15} />
              </span>
              <div className="gatc-report__kpi-body">
                <span className="gatc-report__kpi-label">GATC Fees</span>
                <strong className="gatc-report__kpi-value gatc-report__kpi-value--green">
                  {formatCurrency(kpis.gatcFeeTotal)}
                </strong>
                <span className="gatc-report__kpi-sub">Total Collected</span>
              </div>
            </article>

            <article className="gatc-report__kpi gatc-report__kpi--orange">
              <span className="gatc-report__kpi-icon" aria-hidden>
                <Receipt size={22} strokeWidth={2.15} />
              </span>
              <div className="gatc-report__kpi-body">
                <span className="gatc-report__kpi-label">Avg. Per Invoice</span>
                <strong className="gatc-report__kpi-value gatc-report__kpi-value--orange">
                  {formatCurrency(kpis.avgPerInvoice)}
                </strong>
                <span className="gatc-report__kpi-sub">Average Amount</span>
              </div>
            </article>
          </div>

          <div className="gatc-report__filters">
            <label className="gatc-report__search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                placeholder="Search invoice, customer, SKU, range..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <label className="gatc-report__month">
              <span>Month</span>
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                aria-label="Report month"
              >
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="gatc-report__refresh-btn"
              disabled={loading}
              onClick={() => void loadAll()}
            >
              <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} aria-hidden />
              Refresh
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="gatc-report__empty">
              <FileText size={28} aria-hidden />
              <strong>{rows.length === 0 ? 'No stamped invoices yet' : 'No matching invoices'}</strong>
              <p>
                {rows.length === 0
                  ? 'Entries appear when a stamped portal invoice is created or synced.'
                  : 'Try clearing search or choosing another month.'}
              </p>
            </div>
          ) : (
            <>
              <div className="gatc-report__ledger" aria-label="GATC billwise ledger">
                <div className="gatc-report__ledger-scroll">
                  <table className="gatc-report__ledger-table">
                    <thead>
                      <tr>
                        <th>Invoice No.</th>
                        <th>Customer / Details</th>
                        <th className="is-num">Instruments Stamped Qty</th>
                        <th>Stamped On</th>
                        <th className="is-num">GATC Fees (₹)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(report => {
                        const open = expandedId === report.id;
                        const displayLines = gatcReportDisplayLines(report);
                        const stamped = formatStampedOn(report);
                        const detailLine = [
                          report.invoiceDate,
                          report.salespersonName,
                        ].filter(Boolean).join(' · ');
                        return (
                          <React.Fragment key={report.id}>
                            <tr
                              className={`gatc-report__data-row${open ? ' is-open' : ''}`}
                              tabIndex={0}
                              aria-expanded={open}
                              onClick={() => setExpandedId(open ? null : report.id)}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setExpandedId(open ? null : report.id);
                                }
                              }}
                            >
                              <td>
                                <div className="gatc-report__invoice-cell">
                                  <strong>{report.invoiceNumber || report.invoiceId}</strong>
                                  <em className="gatc-report__badge">Stamped</em>
                                </div>
                              </td>
                              <td>
                                <div className="gatc-report__customer-cell">
                                  <strong>{report.customerName || '—'}</strong>
                                  {detailLine ? <span>{detailLine}</span> : null}
                                  {report.salesOrderNumber ? (
                                    <span>SO {report.salesOrderNumber}</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="is-num">
                                <span className="gatc-report__qty-cell">
                                  <Package size={15} aria-hidden />
                                  {report.totals.stampedQty.toLocaleString('en-IN')}
                                </span>
                              </td>
                              <td>
                                <div className="gatc-report__stamped-on">
                                  <strong>{stamped.date}</strong>
                                  {stamped.time ? <span>{stamped.time}</span> : null}
                                </div>
                              </td>
                              <td className="is-num">
                                <span className="gatc-report__fee">
                                  {formatCurrency(report.totals.gatcFeeTotal)}
                                </span>
                              </td>
                              <td>
                                <div className="gatc-report__status">
                                  <CheckCircle2 size={16} aria-hidden />
                                  <div>
                                    <strong>Stamped</strong>
                                    <span>
                                      {displayLines.length.toLocaleString('en-IN')}
                                      {' '}
                                      {displayLines.length === 1 ? 'line' : 'lines'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {open ? (
                              <tr className="gatc-report__detail-row">
                                <td colSpan={6}>
                                  <div className="gatc-report__detail">
                                    <table className="gatc-report__detail-table">
                                      <thead>
                                        <tr>
                                          <th>SKU</th>
                                          <th>Item</th>
                                          <th className="is-num">Qty</th>
                                          <th>Stamping</th>
                                          <th className="is-num">Fee</th>
                                          <th className="is-num">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {displayLines.length === 0 ? (
                                          <tr>
                                            <td colSpan={6} className="gatc-report__detail-empty">
                                              No stamping lines on this invoice.
                                            </td>
                                          </tr>
                                        ) : (
                                          displayLines.map((line, index) => (
                                            <tr
                                              key={`${line.productId || line.itemId || 'line'}-${index}`}
                                              className={line.hasStamping ? 'is-stamped' : undefined}
                                            >
                                              <td>{line.sku || '—'}</td>
                                              <td>{line.name}</td>
                                              <td className="is-num">
                                                {line.qty.toLocaleString('en-IN')}
                                              </td>
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
                                              <td className="is-num">
                                                {line.hasStamping
                                                  ? formatCurrency(line.lineGatcTotal)
                                                  : '—'}
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

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

              <footer className="gatc-report__summary-bar" aria-label="Report totals">
                <div className="gatc-report__summary-total">
                  <span className="gatc-report__summary-total-icon" aria-hidden>
                    <Wallet size={20} strokeWidth={2.1} />
                  </span>
                  <div className="gatc-report__summary-total-body">
                    <span>Total GATC Fees Collected</span>
                    <strong>{formatCurrency(kpis.gatcFeeTotal)}</strong>
                  </div>
                </div>
                <div className="gatc-report__summary-stats">
                  <div>
                    <span>Total Invoices</span>
                    <strong>{kpis.invoiceCount.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span>Total Instruments Stamped</span>
                    <strong>{kpis.stampedQty.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span>Average Per Invoice</span>
                    <strong>{formatCurrency(kpis.avgPerInvoice)}</strong>
                  </div>
                </div>
                <p className="gatc-report__summary-meta">
                  <Info size={14} aria-hidden />
                  Report generated on {formatGeneratedAt(generatedAt)}
                </p>
              </footer>
            </>
          )}
        </>
      )}
    </section>
  );
};
