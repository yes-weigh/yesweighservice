import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgePercent, Ban, ChartNoAxesColumnIncreasing, FileText, Upload } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { formatCurrencyWhole } from '../../../lib/catalog';
import {
  INCENTIVE_DIRECTOR_RATE,
  INCENTIVE_KAMS,
  INCENTIVE_MONTH_START,
  INCENTIVE_RATE,
  fetchIncentiveInvoiceLines,
  incentiveForRow,
  incentiveRowNote,
  incentiveRowTone,
  listIncentiveInvoices,
  type IncentiveInvoiceLine,
  type IncentiveInvoiceRow,
  type IncentiveKamId,
} from '../../../lib/incentiveReports';

const PAGE_SIZE = 25;

type AdjustFilter = '' | 'upsales' | 'down';

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

function parseInvoiceDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatInvoiceDate(value: string | null | undefined): string {
  const date = parseInvoiceDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportIncentiveCsv(
  rows: IncentiveInvoiceRow[],
  monthLabel: string,
  kamLabel: string,
  excludeDiscounts = false,
): void {
  const headers = [
    'Invoice No',
    'Customer',
    'Invoice Date',
    'Salesperson',
    'Sales (ex GST, courier, GATC)',
    'Incentive 3.5%',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(row => [
      row.invoiceNumber,
      row.customerName || '',
      row.date || '',
      row.salespersonName || '',
      String(row.sales),
      String(incentiveForRow(row, excludeDiscounts)),
    ].map(value => csvEscape(String(value))).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const suffix = kamLabel.replace(/\s+/g, '-').toLowerCase();
  anchor.download = `incentive-report-${monthLabel.replace(/\s+/g, '-').toLowerCase()}-${suffix}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const IncentiveReportTab: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const monthOptions = useMemo(
    () => buildMonthOptions(INCENTIVE_MONTH_START, currentYearMonth()),
    [],
  );
  const defaultMonth = monthOptions[0]?.value || INCENTIVE_MONTH_START;

  const [rows, setRows] = useState<IncentiveInvoiceRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(defaultMonth);
  const [kam, setKam] = useState<IncentiveKamId | ''>('');
  const [adjustFilter, setAdjustFilter] = useState<AdjustFilter>('');
  const [excludeDiscounts, setExcludeDiscounts] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesByInvoice, setLinesByInvoice] = useState<Record<string, IncentiveInvoiceLine[]>>({});
  const [linesLoadingId, setLinesLoadingId] = useState<string | null>(null);

  const loadMonth = useCallback(async (yearMonth: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await listIncentiveInvoices(yearMonth);
      setRows(result.rows);
      setTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load incentive report.');
      setRows([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(month);
  }, [loadMonth, month]);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
    setAdjustFilter('');
  }, [month, kam]);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [adjustFilter]);

  useEffect(() => {
    if (!expandedId) return;
    const report = rows.find(row => row.id === expandedId);
    if (!report || linesByInvoice[report.id] !== undefined) return;

    let cancelled = false;
    setLinesLoadingId(report.id);
    void fetchIncentiveInvoiceLines(report.customerId, report.id)
      .then(lines => {
        if (!cancelled) {
          setLinesByInvoice(prev => ({ ...prev, [report.id]: lines }));
        }
      })
      .finally(() => {
        if (!cancelled) setLinesLoadingId(current => (current === report.id ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [expandedId, rows, linesByInvoice]);

  const kamRows = useMemo(() => {
    if (!kam) return rows;
    return rows.filter(row => row.kamId === kam);
  }, [rows, kam]);

  const listed = useMemo(() => {
    if (adjustFilter === 'upsales') return kamRows.filter(row => row.hikeAmount > 0);
    if (adjustFilter === 'down') return kamRows.filter(row => row.discountAmount > 0);
    return kamRows;
  }, [kamRows, adjustFilter]);

  const totalPages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return listed.slice(start, start + PAGE_SIZE);
  }, [listed, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const skipDiscountIncentive = isSuperAdmin && excludeDiscounts;

  const kpis = useMemo(() => {
    const invoiceCount = kamRows.length;
    const totalSales = kamRows.reduce((sum, row) => sum + row.sales, 0);
    const totalIncentive = kamRows.reduce(
      (sum, row) => sum + incentiveForRow(row, skipDiscountIncentive),
      0,
    );
    const incentiveStandard = kamRows.reduce((sum, row) => (
      row.rate === INCENTIVE_DIRECTOR_RATE
        ? sum
        : sum + incentiveForRow(row, skipDiscountIncentive)
    ), 0);
    const incentiveDirector = kamRows.reduce((sum, row) => (
      row.rate === INCENTIVE_DIRECTOR_RATE
        ? sum + incentiveForRow(row, skipDiscountIncentive)
        : sum
    ), 0);
    const upsales = kamRows.reduce((sum, row) => sum + row.hikeAmount, 0);
    const downSale = kamRows.reduce((sum, row) => sum + row.discountAmount, 0);
    return {
      invoiceCount,
      totalSales,
      totalIncentive,
      incentiveStandard,
      incentiveDirector,
      upsales,
      downSale,
      netAdjust: upsales - downSale,
    };
  }, [kamRows, skipDiscountIncentive]);

  const monthLabel = monthOptions.find(opt => opt.value === month)?.label || month;
  const kamLabel = INCENTIVE_KAMS.find(opt => opt.id === kam)?.label || 'All';

  const handleExport = useCallback(() => {
    exportIncentiveCsv(listed, monthLabel, kamLabel, skipDiscountIncentive);
  }, [listed, monthLabel, kamLabel, skipDiscountIncentive]);

  return (
    <section className="gatc-report incentive-report">
      {error ? <p className="gatc-report__error text-sm">{error}</p> : null}
      {truncated ? (
        <p className="gatc-report__error text-sm">
          Showing the first 4,000 invoices for this month. Narrow the KAM filter after load if totals look short.
        </p>
      ) : null}

      {loading ? (
        <div className="gatc-report__loading">
          <div className="loader-ring" />
        </div>
      ) : (
        <>
          <div className="incentive-report__kpis" aria-label="Incentive summary">
            <article className="incentive-report__kpi incentive-report__kpi--inv">
              <FileText className="incentive-report__kpi-icon" size={18} strokeWidth={2} aria-hidden />
              <div className="incentive-report__kpi-copy">
                <span className="incentive-report__kpi-label">INV</span>
                <strong className="incentive-report__kpi-value">
                  {kpis.invoiceCount.toLocaleString('en-IN')}
                </strong>
              </div>
            </article>
            <article className="incentive-report__kpi incentive-report__kpi--sales">
              <ChartNoAxesColumnIncreasing className="incentive-report__kpi-icon" size={18} strokeWidth={2} aria-hidden />
              <div className="incentive-report__kpi-copy">
                <span className="incentive-report__kpi-label">Total sales</span>
                <strong className="incentive-report__kpi-value">
                  {formatCurrencyWhole(kpis.totalSales)}
                </strong>
              </div>
            </article>
            <article className={`incentive-report__kpi incentive-report__kpi--fee${kam === 'shibin' ? ' is-split' : ''}`}>
              <BadgePercent className="incentive-report__kpi-icon" size={18} strokeWidth={2} aria-hidden />
              <div className="incentive-report__kpi-copy">
                <span className="incentive-report__kpi-label">
                  {kam === 'shibin'
                    ? (skipDiscountIncentive ? 'Incentives excl. discounts' : 'Incentives')
                    : `Incentives (${(INCENTIVE_RATE * 100).toFixed(1)}%)${
                      skipDiscountIncentive ? ' excl. discounts' : ''
                    }`}
                </span>
                {kam === 'shibin' ? (
                  <dl className="incentive-report__kpi-split">
                    <div>
                      <dt>Total</dt>
                      <dd>{formatCurrencyWhole(kpis.totalIncentive)}</dd>
                    </div>
                    <div>
                      <dt>3.5%</dt>
                      <dd className="is-standard">{formatCurrencyWhole(kpis.incentiveStandard)}</dd>
                    </div>
                    <div>
                      <dt>2%</dt>
                      <dd className="is-director">{formatCurrencyWhole(kpis.incentiveDirector)}</dd>
                    </div>
                  </dl>
                ) : (
                  <strong className="incentive-report__kpi-value">
                    {formatCurrencyWhole(kpis.totalIncentive)}
                  </strong>
                )}
              </div>
            </article>
          </div>

          <div className="incentive-report__adjust" aria-label="Upsales and down sale">
            <button
              type="button"
              className={`incentive-report__adjust-col is-up${adjustFilter === 'upsales' ? ' is-active' : ''}`}
              aria-pressed={adjustFilter === 'upsales'}
              onClick={() => setAdjustFilter(current => (current === 'upsales' ? '' : 'upsales'))}
            >
              <span className="incentive-report__adjust-label">Upsales</span>
              <strong className="incentive-report__adjust-value">
                {formatCurrencyWhole(kpis.upsales)}
              </strong>
            </button>
            <button
              type="button"
              className={`incentive-report__adjust-col is-down${adjustFilter === 'down' ? ' is-active' : ''}`}
              aria-pressed={adjustFilter === 'down'}
              onClick={() => setAdjustFilter(current => (current === 'down' ? '' : 'down'))}
            >
              <span className="incentive-report__adjust-label">Down sale</span>
              <strong className="incentive-report__adjust-value">
                {formatCurrencyWhole(kpis.downSale)}
              </strong>
            </button>
            <div className="incentive-report__adjust-col is-net">
              <span className="incentive-report__adjust-label">NET</span>
              <strong className="incentive-report__adjust-value">
                {formatCurrencyWhole(kpis.netAdjust)}
              </strong>
            </div>
          </div>

          <div className="gatc-report__filters">
            <div className="gatc-report__filters-start">
              <label className="gatc-report__month">
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
              <label className="gatc-report__kam">
                <select
                  value={kam}
                  onChange={e => setKam(e.target.value as IncentiveKamId | '')}
                  aria-label="Salesperson"
                >
                  <option value="">All</option>
                  {INCENTIVE_KAMS.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="gatc-report__export-btn"
              disabled={loading || listed.length === 0}
              onClick={handleExport}
            >
              <Upload size={15} aria-hidden />
              Export
            </button>
          </div>

          {listed.length === 0 ? (
            <div className="gatc-report__empty">
              <FileText size={28} aria-hidden />
              <strong>
                {kamRows.length === 0
                  ? 'No invoices this month'
                  : adjustFilter === 'upsales'
                    ? 'No upsales this month'
                    : 'No down sales this month'}
              </strong>
              <p>
                {kamRows.length === 0
                  ? 'Try another month or salesperson.'
                  : 'Tap the box again to show all invoices.'}
              </p>
            </div>
          ) : (
            <>
              {isSuperAdmin && kamRows.some(row => row.discountAmount > 0) ? (
                <button
                  type="button"
                  className={`incentive-report__skip-btn${excludeDiscounts ? ' is-active' : ''}`}
                  aria-pressed={excludeDiscounts}
                  onClick={() => setExcludeDiscounts(current => !current)}
                >
                  <Ban size={15} aria-hidden />
                  {excludeDiscounts ? 'Discounts off' : 'Skip discounts'}
                </button>
              ) : null}
              <div className="gatc-report__list" aria-label="Incentive invoices">
                {pageRows.map(row => {
                  const open = expandedId === row.id;
                  const lines = linesByInvoice[row.id];
                  const subtotal = (lines ?? []).reduce((sum, line) => sum + line.total, 0);
                  const tone = incentiveRowTone(row);
                  const note = incentiveRowNote(row);
                  return (
                    <article
                      key={row.id}
                      className={`gatc-report__row${open ? ' is-open' : ''}`}
                    >
                      <button
                        type="button"
                        className="gatc-report__row-main"
                        aria-expanded={open}
                        onClick={() => setExpandedId(open ? null : row.id)}
                      >
                        <strong className="gatc-report__row-customer">
                          {row.customerName || '—'}
                        </strong>
                        <div className="gatc-report__row-line">
                          <span className="gatc-report__row-inv">
                            {row.invoiceNumber}
                            <em>{formatInvoiceDate(row.date)}</em>
                          </span>
                          <span className={[
                            'gatc-report__row-amt',
                            tone === 'discount' ? 'is-discounted' : '',
                            tone === 'hike' || tone === 'director' ? 'is-director' : '',
                          ].filter(Boolean).join(' ')}>
                            <span className="gatc-report__row-amt-main">
                              {formatCurrencyWhole(row.sales)}
                            </span>
                            {note ? (
                              <span className="gatc-report__row-amt-note">
                                {note.kind === 'discount'
                                  ? `-${formatCurrencyWhole(note.amount)}`
                                  : formatCurrencyWhole(note.amount)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </button>
                      {open ? (
                        <div className="incentive-report__detail">
                          {linesLoadingId === row.id && !lines ? (
                            <p className="incentive-report__detail-empty">Loading items…</p>
                          ) : !lines?.length ? (
                            <p className="incentive-report__detail-empty">No item lines on this invoice.</p>
                          ) : (
                            <>
                              {lines.map((line, index) => (
                                <div
                                  key={`${line.sku || line.name}-${index}`}
                                  className={[
                                    'incentive-report__item',
                                    line.priceAdjust === 'discount' ? 'is-discounted' : '',
                                    line.priceAdjust === 'hike' ? 'is-hiked' : '',
                                  ].filter(Boolean).join(' ')}
                                >
                                  <div className="incentive-report__item-main">
                                    <span className="incentive-report__item-name">{line.name}</span>
                                    <span className="incentive-report__item-qty">
                                      {line.qty.toLocaleString('en-IN')}
                                    </span>
                                    <span className="incentive-report__item-total">
                                      {formatCurrencyWhole(line.total)}
                                    </span>
                                  </div>
                                  <div className="incentive-report__item-meta">
                                    <span>{line.sku || '—'}</span>
                                    <span>({formatCurrencyWhole(line.rate)})</span>
                                    {line.priceAdjust === 'discount' && line.unitDiscount > 0 ? (
                                      <span className="incentive-report__item-note">
                                        -{formatCurrencyWhole(line.unitDiscount)}
                                      </span>
                                    ) : null}
                                    {line.priceAdjust === 'hike' && line.unitHike > 0 ? (
                                      <span className="incentive-report__item-note">
                                        +{formatCurrencyWhole(line.unitHike)}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                              <div className="incentive-report__subtotal">
                                <span>Sub total</span>
                                <strong>{formatCurrencyWhole(subtotal)}</strong>
                              </div>
                            </>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              {totalPages > 1 ? (
                <footer className="invoices-pagination gatc-report__pagination">
                  <span className="invoices-pagination__info text-muted text-sm">
                    {pageRows.length
                      ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + pageRows.length}`
                      : '0'}
                    {' of '}
                    {listed.length.toLocaleString('en-IN')}
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
