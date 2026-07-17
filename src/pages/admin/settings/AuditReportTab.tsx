import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Settings,
  Warehouse,
} from 'lucide-react';
import { listAuditCycles } from '../../../lib/auditCycles/data';
import {
  buildAgmConfirmedRows,
  buildAgmShortageRows,
  confirmedStockValue,
  countZohoStockItems,
  summarizeAgmShortageRows,
  type AgmShortageRow,
  type AgmShortageTotals,
} from '../../../lib/auditCycles/cycleRows';
import { fetchCatalog, formatCurrency } from '../../../lib/catalog';
import {
  auditCycleSiteLabel,
  type AuditCycleDoc,
  type AuditCycleSite,
} from '../../../types/audit-cycle';
import type { CatalogProduct } from '../../../types/catalog';

type SiteFilter = 'all' | AuditCycleSite;
type RegisterView = 'tiles' | 'table';
type ReportMode = 'loss' | 'confirmed';

type ReportRow = AgmShortageRow & {
  cycleId: string;
  cycleName: string;
  site: AuditCycleSite;
};

type HiddenEntry = {
  key: string;
  productId: string;
  site: AuditCycleSite;
  sku: string;
  name: string;
};

type AuditReportPrefs = {
  highlightUncounted: boolean;
  hidden: HiddenEntry[];
};

const PREFS_KEY = 'yesone.auditReport.prefs.v1';

function loadPrefs(): AuditReportPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { highlightUncounted: false, hidden: [] };
    const parsed = JSON.parse(raw) as Partial<AuditReportPrefs>;
    return {
      highlightUncounted: Boolean(parsed.highlightUncounted),
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((entry): entry is HiddenEntry => (
          Boolean(entry)
          && typeof entry.key === 'string'
          && typeof entry.productId === 'string'
          && (entry.site === 'head_office' || entry.site === 'cochin')
        ))
        : [],
    };
  } catch {
    return { highlightUncounted: false, hidden: [] };
  }
}

function savePrefs(prefs: AuditReportPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

function makeRowKey(site: AuditCycleSite, productId: string): string {
  return `${site}:${productId}`;
}

function formatSignedQty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0) return `+${value.toLocaleString('en-IN')}`;
  return value.toLocaleString('en-IN');
}

function formatAuditDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function cycleRecencyMs(cycle: AuditCycleDoc): number {
  const opened = cycle.openedAt ? Date.parse(cycle.openedAt) : NaN;
  if (Number.isFinite(opened)) return opened;
  const created = Date.parse(cycle.createdAt);
  return Number.isFinite(created) ? created : 0;
}

function pickLatestCycle(cycles: AuditCycleDoc[]): AuditCycleDoc | null {
  if (cycles.length === 0) return null;
  const open = cycles.filter(c => c.status === 'open');
  const pool = open.length > 0 ? open : cycles;
  return [...pool].sort((a, b) => cycleRecencyMs(b) - cycleRecencyMs(a))[0] ?? null;
}

export const AuditReportTab: React.FC = () => {
  const [cycles, setCycles] = useState<AuditCycleDoc[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');
  const [search, setSearch] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [registerView, setRegisterView] = useState<RegisterView>('tiles');
  const [reportMode, setReportMode] = useState<ReportMode>('loss');
  const [prefs, setPrefs] = useState<AuditReportPrefs>(() => loadPrefs());
  const [editMode, setEditMode] = useState(false);
  const isLossMode = reportMode === 'loss';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCycles, catalog] = await Promise.all([
        listAuditCycles(),
        fetchCatalog(),
      ]);
      setCycles(nextCycles);
      setProducts(catalog.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (maximized) setMaximized(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized, settingsOpen]);

  useEffect(() => {
    if (!maximized) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [maximized]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [settingsOpen]);

  const selectedCycles = useMemo(() => {
    const sites: AuditCycleSite[] = siteFilter === 'all'
      ? ['head_office', 'cochin']
      : [siteFilter];
    return sites
      .map(site => pickLatestCycle(cycles.filter(c => c.site === site)))
      .filter((c): c is AuditCycleDoc => c != null);
  }, [cycles, siteFilter]);

  const reportRows = useMemo(() => {
    const rows: ReportRow[] = [];
    const build = isLossMode ? buildAgmShortageRows : buildAgmConfirmedRows;
    for (const cycle of selectedCycles) {
      for (const row of build(products, cycle)) {
        rows.push({
          ...row,
          cycleId: cycle.id,
          cycleName: cycle.name,
          site: cycle.site,
        });
      }
    }
    rows.sort((a, b) => {
      if (isLossMode) {
        const valueCmp = a.diffValue - b.diffValue;
        if (valueCmp !== 0) return valueCmp;
      } else {
        const valueCmp = (b.auditedQty * b.rate) - (a.auditedQty * a.rate);
        if (valueCmp !== 0) return valueCmp;
      }
      const siteCmp = a.site.localeCompare(b.site);
      if (siteCmp !== 0) return siteCmp;
      return a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name);
    });
    return rows;
  }, [products, selectedCycles, isLossMode]);

  const hiddenKeySet = useMemo(
    () => new Set(prefs.hidden.map(entry => entry.key)),
    [prefs.hidden],
  );

  const visibleReportRows = useMemo(
    () => reportRows.filter(row => !hiddenKeySet.has(makeRowKey(row.site, row.productId))),
    [reportRows, hiddenKeySet],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleReportRows;
    return visibleReportRows.filter(row => (
      row.sku.toLowerCase().includes(q)
      || row.name.toLowerCase().includes(q)
    ));
  }, [visibleReportRows, search]);

  const totals = useMemo(
    () => summarizeAgmShortageRows(visibleReportRows),
    [visibleReportRows],
  );

  const registerTotals = useMemo(
    () => summarizeAgmShortageRows(filteredRows),
    [filteredRows],
  );

  const visibleStockValue = useMemo(
    () => confirmedStockValue(visibleReportRows),
    [visibleReportRows],
  );

  const registerStockValue = useMemo(
    () => confirmedStockValue(filteredRows),
    [filteredRows],
  );

  const zohoItemCount = useMemo(() => {
    const sites: AuditCycleSite[] = siteFilter === 'all'
      ? ['head_office', 'cochin']
      : [siteFilter];
    let count = 0;
    for (const product of products) {
      const stillVisible = sites.some(site => (
        !hiddenKeySet.has(makeRowKey(site, product.id))
        && countZohoStockItems([product], [site]) > 0
      ));
      if (stillVisible) count += 1;
    }
    return count;
  }, [products, siteFilter, hiddenKeySet]);

  const siteTotals = useMemo(() => {
    const empty = (): AgmShortageTotals & { stockValue: number } => ({
      skuCount: 0,
      auditedQty: 0,
      zohoAtAudit: 0,
      auditDiff: 0,
      diffValue: 0,
      uncountedSkuCount: 0,
      unitsShort: 0,
      shortageValue: 0,
      stockValue: 0,
    });
    const forSite = (site: AuditCycleSite) => {
      const cycle = pickLatestCycle(cycles.filter(c => c.site === site));
      if (!cycle) return empty();
      const build = isLossMode ? buildAgmShortageRows : buildAgmConfirmedRows;
      const rows = build(products, cycle).filter(
        row => !hiddenKeySet.has(makeRowKey(site, row.productId)),
      );
      const summary = summarizeAgmShortageRows(rows);
      return { ...summary, stockValue: confirmedStockValue(rows) };
    };
    return {
      head_office: forSite('head_office'),
      cochin: forSite('cochin'),
    };
  }, [cycles, products, hiddenKeySet, isLossMode]);

  const showSiteColumn = siteFilter === 'all' && selectedCycles.length > 1;
  const showKpis = !loading && selectedCycles.length > 0;
  const highlightUncounted = prefs.highlightUncounted;

  const hideRow = (row: ReportRow) => {
    const key = makeRowKey(row.site, row.productId);
    setPrefs(prev => {
      if (prev.hidden.some(entry => entry.key === key)) return prev;
      return {
        ...prev,
        hidden: [
          ...prev.hidden,
          {
            key,
            productId: row.productId,
            site: row.site,
            sku: row.sku,
            name: row.name,
          },
        ],
      };
    });
  };

  const unhideKey = (key: string) => {
    setPrefs(prev => ({
      ...prev,
      hidden: prev.hidden.filter(entry => entry.key !== key),
    }));
  };

  const clearHidden = () => {
    setPrefs(prev => ({ ...prev, hidden: [] }));
  };

  const report = (
    <section
      className={[
        'agm-audit-report',
        'panel',
        'glass',
        highlightUncounted ? 'highlight-uncounted' : '',
        editMode ? 'is-editing' : '',
        maximized ? 'agm-audit-report--maximized agm-audit-report__scroll' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="agm-audit-report__masthead">
        <div className="agm-audit-report__brand">
          <h3 className="agm-audit-report__title">Audit report</h3>
          <label className="agm-audit-report__mode-toggle" title="Switch report type">
            <span className={isLossMode ? 'is-active' : ''}>Loss</span>
            <input
              type="checkbox"
              checked={!isLossMode}
              onChange={e => setReportMode(e.target.checked ? 'confirmed' : 'loss')}
              aria-label="Switch between loss report and stock confirmed report"
            />
            <span className={!isLossMode ? 'is-active' : ''}>Confirmed</span>
          </label>
        </div>
        <div className="agm-audit-report__actions">
          <div className="agm-audit-report__settings" ref={settingsRef}>
            <button
              type="button"
              className={`agm-audit-report__icon-btn${settingsOpen ? ' is-active' : ''}`}
              onClick={() => setSettingsOpen(open => !open)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label="Report settings"
              title="Settings"
            >
              <Settings size={16} aria-hidden />
            </button>
            {settingsOpen && (
              <div className="agm-audit-report__settings-panel" role="dialog" aria-label="Report settings">
                <label className="agm-audit-report__settings-toggle">
                  <span>
                    <strong>Highlight uncounted</strong>
                    <em>Gold accent and Uncounted badge on uncounted lines</em>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.highlightUncounted}
                    onChange={e => setPrefs(prev => ({
                      ...prev,
                      highlightUncounted: e.target.checked,
                    }))}
                  />
                </label>

                <label className="agm-audit-report__settings-toggle">
                  <span>
                    <strong>Edit register</strong>
                    <em>Show hide controls on each line</em>
                  </span>
                  <input
                    type="checkbox"
                    checked={editMode}
                    onChange={e => setEditMode(e.target.checked)}
                  />
                </label>

                <div className="agm-audit-report__settings-hidden">
                  <div className="agm-audit-report__settings-hidden-head">
                    <strong>Hidden from register</strong>
                    <span>{prefs.hidden.length.toLocaleString('en-IN')}</span>
                  </div>
                  <p className="agm-audit-report__settings-hint">
                    Turn on Edit register, then hide lines with the eye icon. KPIs update to match the visible list.
                  </p>
                  {prefs.hidden.length === 0 ? (
                    <p className="agm-audit-report__settings-empty">No hidden items</p>
                  ) : (
                    <>
                      <ul className="agm-audit-report__settings-hidden-list">
                        {prefs.hidden.map(entry => (
                          <li key={entry.key}>
                            <div>
                              <strong>{entry.name}</strong>
                              <span>
                                {entry.sku}
                                {' · '}
                                {auditCycleSiteLabel(entry.site)}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => unhideKey(entry.key)}
                            >
                              <Eye size={14} aria-hidden />
                              Unhide
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="agm-audit-report__settings-clear"
                        onClick={clearHidden}
                      >
                        Unhide all
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="agm-audit-report__icon-btn"
            disabled={loading}
            onClick={() => void loadAll()}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'spin-icon' : undefined} aria-hidden />
          </button>
          <button
            type="button"
            className={`agm-audit-report__icon-btn${maximized ? ' is-active' : ''}`}
            onClick={() => setMaximized(v => !v)}
            aria-label={maximized ? 'Exit full view' : 'Present'}
            title={maximized ? 'Exit' : 'Present'}
            aria-pressed={maximized}
          >
            {maximized
              ? <Minimize2 size={16} aria-hidden />
              : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>

      {showKpis && (
        <div className="agm-audit-report__hero" aria-label={isLossMode ? 'Loss summary' : 'Confirmed stock summary'}>
          <div className="agm-audit-report__metric" title="Unique SKUs with Zoho stock">
            <span>Zoho items</span>
            <strong>{zohoItemCount.toLocaleString('en-IN')}</strong>
          </div>
          <div
            className="agm-audit-report__metric"
            title={isLossMode ? 'SKUs with negative Diff' : 'Counted SKUs with Diff ≥ 0'}
          >
            <span>{isLossMode ? 'Shortage items' : 'Confirmed items'}</span>
            <strong>{totals.skuCount.toLocaleString('en-IN')}</strong>
          </div>
          <div
            className="agm-audit-report__metric"
            title={isLossMode ? 'Shortage value at Head Office' : 'Confirmed stock value at Head Office'}
          >
            <span>{isLossMode ? 'HO shortage' : 'HO confirmed'}</span>
            <strong className={isLossMode ? 'is-under' : 'is-over'}>
              {formatCurrency(
                isLossMode
                  ? siteTotals.head_office.shortageValue
                  : siteTotals.head_office.stockValue,
              )}
            </strong>
            <em className="agm-audit-report__metric-sub">
              {siteTotals.head_office.skuCount.toLocaleString('en-IN')} items
            </em>
          </div>
          <div
            className="agm-audit-report__metric"
            title={isLossMode ? 'Shortage value at Cochin' : 'Confirmed stock value at Cochin'}
          >
            <span>{isLossMode ? 'Cochin shortage' : 'Cochin confirmed'}</span>
            <strong className={isLossMode ? 'is-under' : 'is-over'}>
              {formatCurrency(
                isLossMode
                  ? siteTotals.cochin.shortageValue
                  : siteTotals.cochin.stockValue,
              )}
            </strong>
            <em className="agm-audit-report__metric-sub">
              {siteTotals.cochin.skuCount.toLocaleString('en-IN')} items
            </em>
          </div>
          <div className={`agm-audit-report__metric agm-audit-report__metric--hero${!isLossMode ? ' is-confirmed' : ''}`}>
            <span>{isLossMode ? 'Total shortage value' : 'Total confirmed value'}</span>
            <strong>
              {formatCurrency(isLossMode ? totals.shortageValue : visibleStockValue)}
            </strong>
          </div>
        </div>
      )}

      <div className="agm-audit-report__controls" role="group" aria-label="Report filters">
        <div className="agm-audit-report__segment" role="group" aria-label="Site">
          <button
            type="button"
            className={`agm-audit-report__seg-btn${siteFilter === 'all' ? ' is-active' : ''}`}
            onClick={() => setSiteFilter('all')}
          >
            All sites
          </button>
          <button
            type="button"
            className={`agm-audit-report__seg-btn${siteFilter === 'head_office' ? ' is-active' : ''}`}
            onClick={() => setSiteFilter('head_office')}
          >
            <Building2 size={14} aria-hidden />
            Head Office
          </button>
          <button
            type="button"
            className={`agm-audit-report__seg-btn${siteFilter === 'cochin' ? ' is-active' : ''}`}
            onClick={() => setSiteFilter('cochin')}
          >
            <Warehouse size={14} aria-hidden />
            Cochin
          </button>
        </div>

        <label className="agm-audit-report__search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search SKU or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      {loading ? (
        <div className="agm-audit-report__loading">
          <div className="loader-ring" />
        </div>
      ) : selectedCycles.length === 0 ? (
        <div className="agm-audit-report__empty">
          <strong>No audit cycle open</strong>
          <p>Open a cycle under Audit cycles to build the shortage report.</p>
        </div>
      ) : (
        <div className="agm-audit-report__body">
          {filteredRows.length === 0 ? (
            <div className="agm-audit-report__empty">
              <strong>
                {search.trim()
                  ? 'No matching items'
                  : prefs.hidden.length > 0
                    ? 'All items are hidden'
                    : isLossMode
                      ? 'No shortages'
                      : 'No confirmed stock'}
              </strong>
              <p>
                {search.trim()
                  ? 'Try another SKU or name.'
                  : prefs.hidden.length > 0
                    ? 'Open Settings to review and unhide items.'
                    : isLossMode
                      ? 'Every Zoho item is at or above physical count for this view.'
                      : 'No counted items with Diff ≥ 0 in the latest cycle.'}
              </p>
            </div>
          ) : (
            <div className="agm-audit-report__table-panel">
              <div className="agm-audit-report__table-head">
                <div className="agm-audit-report__table-head-copy">
                  <h4>{isLossMode ? 'Shortage register' : 'Confirmed register'}</h4>
                  <span>
                    {filteredRows.length.toLocaleString('en-IN')} line items
                    {isLossMode ? ' · worst first' : ' · highest value first'}
                    {prefs.hidden.length > 0
                      ? ` · ${prefs.hidden.length.toLocaleString('en-IN')} hidden`
                      : ''}
                    {editMode ? ' · editing' : ''}
                  </span>
                </div>
                <div className="agm-audit-report__table-head-actions">
                  {editMode && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditMode(false)}
                    >
                      Done editing
                    </button>
                  )}
                  <div className="agm-audit-report__view-toggle" role="group" aria-label="Register view">
                    <button
                      type="button"
                      className={`agm-audit-report__view-btn${registerView === 'tiles' ? ' is-active' : ''}`}
                      onClick={() => setRegisterView('tiles')}
                      aria-pressed={registerView === 'tiles'}
                      title="Tiles view"
                    >
                      <LayoutGrid size={15} aria-hidden />
                      Tiles
                    </button>
                    <button
                      type="button"
                      className={`agm-audit-report__view-btn${registerView === 'table' ? ' is-active' : ''}`}
                      onClick={() => setRegisterView('table')}
                      aria-pressed={registerView === 'table'}
                      title="Table view"
                    >
                      <List size={15} aria-hidden />
                      Table
                    </button>
                  </div>
                </div>
              </div>

              {registerView === 'tiles' ? (
                <div className="agm-audit-report__tiles-wrap agm-audit-report__scroll">
                  <div className="agm-audit-report__tiles" aria-label="Shortage tiles">
                    {filteredRows.map((row, index) => (
                      <article
                        key={`${row.cycleId}-${row.productId}`}
                        className={`agm-audit-report__tile${!row.counted ? ' is-uncounted' : ''}`}
                      >
                        <span className="agm-audit-report__rank">{index + 1}</span>
                        <div className="agm-audit-report__tile-main">
                          <div className="agm-audit-report__tile-title">
                            <strong>{row.name}</strong>
                            {highlightUncounted && isLossMode && !row.counted && (
                              <span className="agm-audit-report__badge is-uncounted">
                                Uncounted
                              </span>
                            )}
                          </div>
                          <p className="agm-audit-report__tile-meta">
                            <span className="agm-audit-report__tile-sku">{row.sku}</span>
                            {showSiteColumn && (
                              <>
                                <span className="agm-audit-report__meta-dot" aria-hidden />
                                <span>{auditCycleSiteLabel(row.site)}</span>
                              </>
                            )}
                            {row.auditedAt && (
                              <>
                                <span className="agm-audit-report__meta-dot" aria-hidden />
                                <span>{formatAuditDate(row.auditedAt)}</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="agm-audit-report__tile-stats" aria-label="Quantities">
                          <span>
                            <em>Zoho</em>
                            {row.zohoAtAudit.toLocaleString('en-IN')}
                          </span>
                          <span>
                            <em>Audited</em>
                            {row.auditedQty.toLocaleString('en-IN')}
                          </span>
                          <span className={row.auditDiff < 0 ? 'is-under' : row.auditDiff > 0 ? 'is-over' : ''}>
                            <em>Diff</em>
                            {formatSignedQty(row.auditDiff)}
                          </span>
                        </div>
                        <div className="agm-audit-report__tile-value">
                          <em>{isLossMode ? 'Diff × price' : 'Stock value'}</em>
                          <strong className={isLossMode ? 'is-under' : 'is-over'}>
                            {formatCurrency(
                              isLossMode ? row.diffValue : row.auditedQty * row.rate,
                            )}
                          </strong>
                        </div>
                        {editMode && (
                          <button
                            type="button"
                            className="agm-audit-report__hide-btn"
                            title="Hide from register"
                            aria-label={`Hide ${row.name}`}
                            onClick={() => hideRow(row)}
                          >
                            <EyeOff size={15} aria-hidden />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="agm-audit-report__table-wrap agm-audit-report__scroll">
                  <table className="agm-audit-report__table">
                    <thead>
                      <tr>
                        <th className="is-rank">#</th>
                        {showSiteColumn && <th>Site</th>}
                        <th>SKU</th>
                        <th>Item</th>
                        {highlightUncounted && isLossMode && <th>Status</th>}
                        <th className="is-num">Zoho</th>
                        <th className="is-num">Audited</th>
                        <th>Date</th>
                        <th className="is-num">Diff</th>
                        <th className="is-num">{isLossMode ? 'Diff × price' : 'Stock value'}</th>
                        {editMode && <th className="is-action"> </th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, index) => (
                        <tr
                          key={`${row.cycleId}-${row.productId}`}
                          className={row.counted ? '' : 'is-uncounted'}
                        >
                          <td className="is-rank">{index + 1}</td>
                          {showSiteColumn && <td>{auditCycleSiteLabel(row.site)}</td>}
                          <td className="is-sku">{row.sku}</td>
                          <td className="is-name">{row.name}</td>
                          {highlightUncounted && isLossMode && (
                            <td>
                              {!row.counted ? (
                                <span className="agm-audit-report__badge is-uncounted">
                                  Uncounted
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          )}
                          <td className="is-num">{row.zohoAtAudit.toLocaleString('en-IN')}</td>
                          <td className="is-num">{row.auditedQty.toLocaleString('en-IN')}</td>
                          <td>{formatAuditDate(row.auditedAt)}</td>
                          <td className={`is-num${row.auditDiff < 0 ? ' is-under' : row.auditDiff > 0 ? ' is-over' : ''}`}>
                            {formatSignedQty(row.auditDiff)}
                          </td>
                          <td className={`is-num${isLossMode ? ' is-under' : ' is-over'}`}>
                            {formatCurrency(
                              isLossMode ? row.diffValue : row.auditedQty * row.rate,
                            )}
                          </td>
                          {editMode && (
                            <td className="is-action">
                              <button
                                type="button"
                                className="agm-audit-report__hide-btn"
                                title="Hide from register"
                                aria-label={`Hide ${row.name}`}
                                onClick={() => hideRow(row)}
                              >
                                <EyeOff size={15} aria-hidden />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="agm-audit-report__totals" aria-label="Register totals">
                <span>
                  Showing · {registerTotals.skuCount.toLocaleString('en-IN')} SKUs
                  {prefs.hidden.length > 0
                    ? ` · ${prefs.hidden.length.toLocaleString('en-IN')} hidden`
                    : ''}
                </span>
                <div className="agm-audit-report__totals-metrics">
                  <span>
                    <em>{isLossMode ? 'Units short' : 'Audited qty'}</em>
                    {(isLossMode ? registerTotals.unitsShort : registerTotals.auditedQty)
                      .toLocaleString('en-IN')}
                  </span>
                  <span className={isLossMode ? 'is-under' : 'is-over'}>
                    <em>{isLossMode ? 'Shortage value' : 'Stock value'}</em>
                    {formatCurrency(
                      isLossMode ? registerTotals.shortageValue : registerStockValue,
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );

  if (maximized) {
    return (
      <>
        <div className="agm-audit-report__placeholder" aria-hidden />
        {createPortal(report, document.body)}
      </>
    );
  }

  return report;
};
