import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgePercent, ChartNoAxesColumnIncreasing, FileText, Upload } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { formatCurrencyWhole } from '../../../lib/catalog';
import {
  INCENTIVE_DIRECTOR_RATE,
  INCENTIVE_KAMS,
  INCENTIVE_MONTH_START,
  INCENTIVE_RATE,
  applyIncentiveExclusions,
  applyLineAdjustsToRow,
  clearIncentiveLineExcluded,
  fetchIncentiveInvoiceLines,
  incentiveExcludedAdjustTotals,
  incentiveForRow,
  incentiveLineAdjustAmounts,
  incentiveLineHasAdjust,
  incentiveLineKey,
  incentiveRowNote,
  incentiveRowTone,
  listIncentiveInvoices,
  listIncentiveLineExclusions,
  persistIncentiveSnapshots,
  setIncentiveLineExcluded,
  withRateCardIncentive,
  type IncentiveInvoiceLine,
  type IncentiveInvoiceRow,
  type IncentiveKamId,
  type IncentiveLineExclusion,
} from '../../../lib/incentiveReports';
import { canSuperAdminWrite } from '../../../lib/staffAccess';
import { hydrateTableCache, peekTableCache, setTableCache } from '../../../lib/tableDisplayCache';

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

function formatLineAdjustNote(line: IncentiveInvoiceLine): string | null {
  const qty = Math.max(0, Number(line.adjustQty || line.qty) || 0);
  if (qty <= 0) return null;
  const qtyLabel = qty.toLocaleString('en-IN');
  if (line.priceAdjust === 'discount' && line.unitDiscount > 0) {
    return `-${formatCurrencyWhole(line.unitDiscount)} × ${qtyLabel} = -${formatCurrencyWhole(line.unitDiscount * qty)}`;
  }
  if (line.priceAdjust === 'hike' && line.unitHike > 0) {
    return `+${formatCurrencyWhole(line.unitHike)} × ${qtyLabel} = +${formatCurrencyWhole(line.unitHike * qty)}`;
  }
  return null;
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

function mergeIncentiveExclusions(
  local: IncentiveLineExclusion[],
  remote: IncentiveLineExclusion[],
): IncentiveLineExclusion[] {
  const byKey = new Map<string, IncentiveLineExclusion>();
  for (const item of [...remote, ...local]) {
    byKey.set(`${item.invoiceId}|${item.lineKey}`, item);
  }
  return [...byKey.values()];
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportIncentiveCsv(
  rows: IncentiveInvoiceRow[],
  monthLabel: string,
  kamLabel: string,
): void {
  const headers = [
    'Invoice No',
    'Customer',
    'Invoice Date',
    'Salesperson',
    'Invoice sales (ex GST, courier, GATC)',
    'Rate card sales',
    'Incentive',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(row => [
      row.invoiceNumber,
      row.customerName || '',
      row.date || '',
      row.salespersonName || '',
      String(row.sales),
      String(row.rateCardSales ?? row.sales),
      String(incentiveForRow(row)),
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
  const canExcludeLines = canSuperAdminWrite(user);
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
  const [kam, setKam] = useState<IncentiveKamId>('biju');
  const [adjustFilter, setAdjustFilter] = useState<AdjustFilter>('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesByInvoice, setLinesByInvoice] = useState<Record<string, IncentiveInvoiceLine[]>>({});
  const [linesLoadingId, setLinesLoadingId] = useState<string | null>(null);
  const [exclusions, setExclusions] = useState<IncentiveLineExclusion[]>([]);
  const [exclusionBusyKey, setExclusionBusyKey] = useState<string | null>(null);

  const loadMonth = useCallback(async (yearMonth: string) => {
    const cacheKey = `incentive:${yearMonth}`;
    const cached = peekTableCache<{ rows: IncentiveInvoiceRow[]; truncated: boolean }>(cacheKey)
      ?? await hydrateTableCache<{ rows: IncentiveInvoiceRow[]; truncated: boolean }>(cacheKey);
    if (cached) {
      setRows(cached.rows.map(row => withRateCardIncentive(row)));
      setTruncated(cached.truncated);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    const exclusionKey = `incentive-excl:${yearMonth}`;
    const localExclusions = peekTableCache<IncentiveLineExclusion[]>(exclusionKey)
      ?? await hydrateTableCache<IncentiveLineExclusion[]>(exclusionKey)
      ?? [];
    if (localExclusions.length) setExclusions(localExclusions);
    try {
      const [result, monthExclusions] = await Promise.all([
        listIncentiveInvoices(yearMonth),
        listIncentiveLineExclusions(yearMonth).catch(() => [] as IncentiveLineExclusion[]),
      ]);
      const merged = mergeIncentiveExclusions(localExclusions, monthExclusions);
      setRows(result.rows);
      setTruncated(result.truncated);
      setExclusions(merged);
      setTableCache(cacheKey, result);
      setTableCache(exclusionKey, merged);
      void persistIncentiveSnapshots(yearMonth, result.rows);
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : 'Could not load incentive report.');
        setRows([]);
        setTruncated(false);
        setExclusions([]);
      }
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
        if (cancelled) return;
        setLinesByInvoice(prev => ({ ...prev, [report.id]: lines }));
        setRows(current => {
          const next = current.map(row => (
            row.id === report.id
              ? applyLineAdjustsToRow(row, lines)
              : row
          ));
          setTableCache(`incentive:${month}`, { rows: next, truncated });
          const updated = next.find(row => row.id === report.id);
          if (updated) void persistIncentiveSnapshots(month, [updated]);
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLinesLoadingId(current => (current === report.id ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [expandedId, rows, linesByInvoice, month, truncated]);

  const rowsWithLineAdjust = useMemo(() => (
    rows.map(row => {
      const lines = linesByInvoice[row.id];
      if (!lines?.length) return row;
      return applyLineAdjustsToRow(row, lines);
    })
  ), [rows, linesByInvoice]);

  const displayRows = useMemo(
    () => applyIncentiveExclusions(rowsWithLineAdjust, exclusions),
    [rowsWithLineAdjust, exclusions],
  );

  const excludedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const exclusion of exclusions) {
      keys.add(`${exclusion.invoiceId}|${exclusion.lineKey}`);
    }
    return keys;
  }, [exclusions]);

  const kamRows = useMemo(
    () => displayRows.filter(row => row.kamId === kam),
    [displayRows, kam],
  );

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

  const kamSource = useMemo(
    () => rowsWithLineAdjust.filter(row => row.kamId === kam),
    [rowsWithLineAdjust, kam],
  );

  const kpis = useMemo(() => {
    const invoiceCount = kamRows.length;
    const totalSales = kamRows.reduce((sum, row) => sum + row.sales, 0);
    const totalIncentive = kamRows.reduce((sum, row) => sum + incentiveForRow(row), 0);
    const incentiveStandard = kamRows.reduce((sum, row) => (
      row.rate === INCENTIVE_DIRECTOR_RATE
        ? sum
        : sum + incentiveForRow(row)
    ), 0);
    const incentiveDirector = kamRows.reduce((sum, row) => (
      row.rate === INCENTIVE_DIRECTOR_RATE
        ? sum + incentiveForRow(row)
        : sum
    ), 0);
    const excludedAdjust = incentiveExcludedAdjustTotals(kamSource, exclusions);
    const rawUpsales = kamSource.reduce((sum, row) => sum + row.hikeAmount, 0);
    const rawDownSale = kamSource.reduce((sum, row) => sum + row.discountAmount, 0);
    const upsales = Math.max(0, rawUpsales - excludedAdjust.hikeAmount);
    const downSale = Math.max(0, rawDownSale - excludedAdjust.discountAmount);
    const netAdjust = upsales - downSale;
    return {
      invoiceCount,
      totalSales,
      totalIncentive,
      incentiveStandard,
      incentiveDirector,
      upsales,
      downSale,
      netAdjust,
      kamShare: netAdjust * 0.3,
    };
  }, [kamRows, kamSource, exclusions]);

  const monthLabel = monthOptions.find(opt => opt.value === month)?.label || month;
  const kamLabel = INCENTIVE_KAMS.find(opt => opt.id === kam)?.label || 'Biju';

  const handleExport = useCallback(() => {
    exportIncentiveCsv(listed, monthLabel, kamLabel);
  }, [listed, monthLabel, kamLabel]);

  const toggleLineExclusion = useCallback(async (
    row: IncentiveInvoiceRow,
    line: IncentiveInvoiceLine,
    index: number,
  ) => {
    if (!canExcludeLines || !incentiveLineHasAdjust(line)) return;
    const lineKey = incentiveLineKey(line, index);
    const busyKey = `${row.id}|${lineKey}`;
    if (exclusionBusyKey) return;
    const already = excludedKeys.has(busyKey);
    const amounts = incentiveLineAdjustAmounts(line, row);
    setExclusionBusyKey(busyKey);
    const next = already
      ? exclusions.filter(item => !(item.invoiceId === row.id && item.lineKey === lineKey))
      : [...exclusions.filter(item => !(item.invoiceId === row.id && item.lineKey === lineKey)), {
        id: `${row.id}__${lineKey}`,
        invoiceId: row.id,
        month,
        lineKey,
        ...amounts,
      }];
    setExclusions(next);
    setTableCache(`incentive-excl:${month}`, next);
    try {
      if (already) {
        await clearIncentiveLineExcluded(row.id, lineKey);
      } else {
        await setIncentiveLineExcluded({
          invoiceId: row.id,
          month,
          lineKey,
          ...amounts,
          uid: user?.uid,
        });
      }
    } catch {
      // Keep the local exclusion so Upsales / Down sale still move.
    } finally {
      setExclusionBusyKey(current => (current === busyKey ? null : current));
    }
  }, [canExcludeLines, excludedKeys, exclusionBusyKey, exclusions, month, user?.uid]);

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
                    ? 'Incentives (rate card)'
                    : `Incentives (${(INCENTIVE_RATE * 100).toFixed(1)}% rate card)`}
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
              <strong className="incentive-report__adjust-value">
                {formatCurrencyWhole(kpis.netAdjust)}
              </strong>
              <span className="incentive-report__adjust-kam">
                30% ({formatCurrencyWhole(kpis.kamShare)})
              </span>
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
                  onChange={e => setKam(e.target.value as IncentiveKamId)}
                  aria-label="Salesperson"
                >
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
              <div className="gatc-report__list" aria-label="Incentive invoices">
                {pageRows.map(row => {
                  const open = expandedId === row.id;
                  const lines = linesByInvoice[row.id];
                  const subtotal = (lines ?? []).reduce((sum, line) => sum + line.total, 0);
                  const lineHikeTotal = (lines ?? []).reduce((sum, line) => (
                    line.priceAdjust === 'hike'
                      ? sum + line.unitHike * (line.adjustQty || line.qty)
                      : sum
                  ), 0);
                  const lineDiscountTotal = (lines ?? []).reduce((sum, line) => (
                    line.priceAdjust === 'discount'
                      ? sum + line.unitDiscount * (line.adjustQty || line.qty)
                      : sum
                  ), 0);
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
                              {lines.map((line, index) => {
                                const lineKey = incentiveLineKey(line, index);
                                const excluded = excludedKeys.has(`${row.id}|${lineKey}`);
                                const canToggle = canExcludeLines && incentiveLineHasAdjust(line);
                                const busy = exclusionBusyKey === `${row.id}|${lineKey}`;
                                const adjustNote = formatLineAdjustNote(line);
                                return (
                                <div
                                  key={lineKey}
                                  className={[
                                    'incentive-report__item',
                                    line.priceAdjust === 'discount' ? 'is-discounted' : '',
                                    line.priceAdjust === 'hike' ? 'is-hiked' : '',
                                    excluded ? 'is-excluded' : '',
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
                                    {line.listRate > 0 && Math.abs(line.listRate - line.rate) > 0.005 ? (
                                      <span>list {formatCurrencyWhole(line.listRate)}</span>
                                    ) : null}
                                    {adjustNote ? (
                                      <span className="incentive-report__item-note">
                                        {adjustNote}
                                      </span>
                                    ) : null}
                                    {canToggle ? (
                                      <button
                                        type="button"
                                        className={`incentive-report__exclude-btn${excluded ? ' is-active' : ''}`}
                                        aria-pressed={excluded}
                                        disabled={busy}
                                        onClick={() => { void toggleLineExclusion(row, line, index); }}
                                      >
                                        {excluded ? 'Include' : 'Exclude'}
                                      </button>
                                    ) : excluded ? (
                                      <span className="incentive-report__exclude-flag">Excluded</span>
                                    ) : null}
                                  </div>
                                </div>
                                );
                              })}
                              <div className="incentive-report__subtotal">
                                <span>Sub total</span>
                                <strong>{formatCurrencyWhole(subtotal)}</strong>
                              </div>
                              {lineHikeTotal > 0.005 ? (
                                <div className="incentive-report__adjust-sum">
                                  Extra {formatCurrencyWhole(lineHikeTotal)}
                                </div>
                              ) : row.hikeAmount > 0.005 ? (
                                <div className="incentive-report__adjust-sum">
                                  Extra {formatCurrencyWhole(row.hikeAmount)}
                                </div>
                              ) : null}
                              {lineDiscountTotal > 0.005 ? (
                                <div className="incentive-report__adjust-sum is-discount">
                                  Discount {formatCurrencyWhole(lineDiscountTotal)}
                                </div>
                              ) : row.discountAmount > 0.005 ? (
                                <div className="incentive-report__adjust-sum is-discount">
                                  Discount {formatCurrencyWhole(row.discountAmount)}
                                </div>
                              ) : null}
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
