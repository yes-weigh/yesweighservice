import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarRange,
  ChevronDown,
  Lock,
  MapPin,
  Play,
  Plus,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  closeAuditCycle,
  createAuditCycle,
  listAuditCycles,
  openAuditCycle,
} from '../../../lib/auditCycles/data';
import {
  buildAuditCycleProductRows,
  summarizeAuditCycleRows,
} from '../../../lib/auditCycles/cycleRows';
import { fetchCatalog, formatCurrency } from '../../../lib/catalog';
import { reconcileStaleAuditSnapshots } from '../../../lib/catalogProductAudit/reconcile';
import {
  auditCycleSiteLabel,
  type AuditCycleDoc,
  type AuditCycleSite,
} from '../../../types/audit-cycle';
import type { CatalogProduct } from '../../../types/catalog';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function formatAuditTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSignedQty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0) return `+${value.toLocaleString('en-IN')}`;
  return value.toLocaleString('en-IN');
}

function statusLabel(status: AuditCycleDoc['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'closed') return 'Closed';
  return 'Scheduled';
}

const AUDIT_CYCLE_COLUMNS = [
  { key: 'sku', label: 'SKU', defaultVisible: false },
  { key: 'name', label: 'Item name', defaultVisible: true },
  { key: 'zoho', label: 'Zoho count', defaultVisible: true },
  { key: 'audited', label: 'Audited count', defaultVisible: true },
  { key: 'date', label: 'Audited date', defaultVisible: false },
  { key: 'time', label: 'Audited time', defaultVisible: false },
  { key: 'diff', label: 'Audit Diff', defaultVisible: true },
  { key: 'diffValue', label: 'Diff × price', defaultVisible: true },
] as const;

type AuditCycleColumnKey = typeof AUDIT_CYCLE_COLUMNS[number]['key'];

function defaultVisibleColumns(): Record<AuditCycleColumnKey, boolean> {
  return Object.fromEntries(
    AUDIT_CYCLE_COLUMNS.map(col => [col.key, col.defaultVisible]),
  ) as Record<AuditCycleColumnKey, boolean>;
}

export const AuditCyclesTab: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [cycles, setCycles] = useState<AuditCycleDoc[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSite, setNewSite] = useState<AuditCycleSite>('head_office');
  const [newName, setNewName] = useState('');
  const [openImmediately, setOpenImmediately] = useState(true);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Could not load audit cycles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openBySite = useMemo(() => {
    const map = new Map<AuditCycleSite, AuditCycleDoc>();
    for (const cycle of cycles) {
      if (cycle.status === 'open') map.set(cycle.site, cycle);
    }
    return map;
  }, [cycles]);

  const rowsByCycleId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildAuditCycleProductRows>>();
    for (const cycle of cycles) {
      map.set(cycle.id, buildAuditCycleProductRows(products, cycle));
    }
    return map;
  }, [cycles, products]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setError('Cycle name is required.');
      return;
    }
    setBusyKey('create');
    setError('');
    try {
      await createAuditCycle({
        site: newSite,
        name,
        openImmediately,
        createdByUid: user?.uid ?? null,
        createdByName: user?.displayName ?? null,
      });
      setShowCreate(false);
      setNewName('');
      setOpenImmediately(true);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create cycle.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpen = async (cycle: AuditCycleDoc) => {
    const ok = await confirm({
      title: 'Open audit cycle?',
      message: `Open “${cycle.name}” for ${auditCycleSiteLabel(cycle.site)}? Users can count locations while it is open.`,
      confirmLabel: 'Open cycle',
    });
    if (!ok) return;
    setBusyKey(`open-${cycle.id}`);
    setError('');
    try {
      await openAuditCycle(cycle.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open cycle.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleClose = async (cycle: AuditCycleDoc) => {
    const ok = await confirm({
      title: 'Close audit cycle?',
      message: `Close “${cycle.name}”? Counting for ${auditCycleSiteLabel(cycle.site)} will be locked until another cycle is opened.`,
      confirmLabel: 'Close cycle',
      destructive: true,
    });
    if (!ok) return;
    setBusyKey(`close-${cycle.id}`);
    setError('');
    try {
      await closeAuditCycle(cycle.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close cycle.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReconcileStaleAudits = async (dryRun: boolean) => {
    if (!openBySite.get('head_office')) {
      setError('Open a Head Office audit cycle before reconciling.');
      return;
    }
    const ok = await confirm({
      title: dryRun ? 'Preview audit reconcile?' : 'Update all stale audited counts?',
      message: dryRun
        ? 'Scan every product and report where live locations differ from frozen Audited stock. No writes.'
        : 'Set Audited stock = current live locations for every product that drifted mid-cycle. Diff will use the new audited totals vs Zoho.',
      confirmLabel: dryRun ? 'Preview' : 'Update all',
      destructive: !dryRun,
    });
    if (!ok) return;

    setBusyKey(dryRun ? 'reconcile-dry' : 'reconcile');
    setError('');
    setReconcileResult(null);
    try {
      const summary = await reconcileStaleAuditSnapshots({ dryRun });
      const sampleLine = summary.samples.length
        ? ` Examples: ${summary.samples
          .slice(0, 3)
          .map(s => `${s.sku || s.productId} (${s.frozen ?? '—'}→${s.live})`)
          .join(', ')}.`
        : '';
      setReconcileResult(
        `${dryRun ? 'Preview' : 'Done'}: ${summary.updated} need/updated, `
        + `${summary.skippedInSync} already in sync, `
        + `${summary.candidates} scanned`
        + (summary.errors.length ? `, ${summary.errors.length} errors` : '')
        + `.${sampleLine}`,
      );
      if (!dryRun) await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reconcile audits.');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleExpanded = (cycleId: string) => {
    setExpandedCycleId(prev => (prev === cycleId ? null : cycleId));
  };

  const toggleColumn = (key: AuditCycleColumnKey) => {
    setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleColumnList = useMemo(
    () => AUDIT_CYCLE_COLUMNS.filter(col => visibleColumns[col.key]),
    [visibleColumns],
  );

  return (
    <section className="audit-cycles-hub panel glass">
      <header className="audit-cycles-hub__header">
        <div className="audit-cycles-hub__intro">
          <p className="audit-cycles-hub__eyebrow">Inventory control</p>
          <h3>Audit cycles</h3>
          <p className="audit-cycles-hub__lede">
            Open a site cycle to count. Physical stays frozen; Diff tracks Zoho until you close and start the next round.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm audit-cycles-hub__new"
          disabled={busyKey != null}
          onClick={() => setShowCreate(open => !open)}
        >
          <Plus size={15} aria-hidden />
          New cycle
        </button>
      </header>

      <div className="audit-cycles-site-strip" aria-label="Open cycle by site">
        {([
          { site: 'head_office' as const, icon: Building2 },
          { site: 'cochin' as const, icon: Warehouse },
        ]).map(({ site, icon: Icon }) => {
          const open = openBySite.get(site);
          return (
            <div
              key={site}
              className={`audit-cycles-site-strip__tile${open ? ' is-open' : ' is-locked'}`}
            >
              <span className="audit-cycles-site-strip__icon" aria-hidden>
                <Icon size={16} />
              </span>
              <div className="audit-cycles-site-strip__copy">
                <span className="audit-cycles-site-strip__site">{auditCycleSiteLabel(site)}</span>
                <span className="audit-cycles-site-strip__status">
                  {open ? open.name : 'No open cycle'}
                </span>
              </div>
              <span className="audit-cycles-site-strip__badge">
                {open ? 'Open' : 'Locked'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="audit-cycles-reconcile">
        <div className="audit-cycles-reconcile__copy">
          <strong>Fix stale audited counts</strong>
          <p className="text-muted text-sm">
            One-time bulk update when live locations drifted from frozen Audited stock
            (e.g. bins linked mid-cycle). Requires an open Head Office cycle.
          </p>
        </div>
        <div className="audit-cycles-reconcile__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busyKey != null || !openBySite.get('head_office')}
            onClick={() => void handleReconcileStaleAudits(true)}
          >
            {busyKey === 'reconcile-dry' ? 'Scanning…' : 'Preview'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busyKey != null || !openBySite.get('head_office')}
            onClick={() => void handleReconcileStaleAudits(false)}
          >
            {busyKey === 'reconcile' ? 'Updating…' : 'Update all stale'}
          </button>
        </div>
      </div>
      {reconcileResult && (
        <p className="audit-cycles-reconcile__result text-sm">{reconcileResult}</p>
      )}

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      {showCreate && (
        <div className="audit-cycles-create">
          <div className="audit-cycles-create__head">
            <strong>New audit cycle</strong>
            <span className="text-muted text-sm">One open cycle per site</span>
          </div>
          <div className="audit-cycles-create__fields">
            <label className="audit-cycles-create__field">
              <span>Site</span>
              <select
                value={newSite}
                onChange={e => setNewSite(e.target.value as AuditCycleSite)}
                disabled={busyKey === 'create'}
              >
                <option value="head_office">Head Office</option>
                <option value="cochin">Cochin</option>
              </select>
            </label>
            <label className="audit-cycles-create__field audit-cycles-create__field--grow">
              <span>Name</span>
              <input
                type="text"
                value={newName}
                placeholder={newSite === 'head_office' ? 'e.g. HO April cycle' : 'e.g. Cochin April cycle'}
                onChange={e => setNewName(e.target.value)}
                disabled={busyKey === 'create'}
              />
            </label>
            <label className="audit-cycles-create__check">
              <input
                type="checkbox"
                checked={openImmediately}
                onChange={e => setOpenImmediately(e.target.checked)}
                disabled={busyKey === 'create'}
              />
              <span>Open immediately</span>
            </label>
          </div>
          <div className="audit-cycles-create__actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!newName.trim() || busyKey === 'create'}
              onClick={() => void handleCreate()}
            >
              Create
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="audit-cycles-hub__loading">
          <div className="loader-ring" />
        </div>
      ) : cycles.length === 0 ? (
        <div className="audit-cycles-hub__empty">
          <CalendarRange size={32} aria-hidden />
          <strong>No cycles yet</strong>
          <p>Create an open cycle for Head Office or Cochin to unlock counting.</p>
        </div>
      ) : (
        <div className="audit-cycles-list">
          {cycles.map((cycle, index) => {
            const rows = rowsByCycleId.get(cycle.id) ?? [];
            const totals = summarizeAuditCycleRows(rows);
            const expanded = expandedCycleId === cycle.id;
            const SiteIcon = cycle.site === 'head_office' ? Building2 : Warehouse;

            return (
              <article
                key={cycle.id}
                className={[
                  'audit-cycle-card',
                  `is-${cycle.status}`,
                  `is-site-${cycle.site === 'head_office' ? 'ho' : 'cochin'}`,
                  expanded ? 'is-expanded' : '',
                ].filter(Boolean).join(' ')}
                style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
              >
                <div
                  className="audit-cycle-card__hit"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${cycle.name} SKU table`}
                  onClick={() => toggleExpanded(cycle.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(cycle.id);
                    }
                  }}
                >
                  <header className="audit-cycle-card__head">
                    <span className="audit-cycle-card__site-mark" aria-hidden>
                      <SiteIcon size={18} />
                    </span>
                    <span className="audit-cycle-card__title-wrap">
                      <span className="audit-cycle-card__title-row">
                        <strong className="audit-cycle-card__title">{cycle.name}</strong>
                        <span className={`audit-cycle-card__status is-${cycle.status}`}>
                          {statusLabel(cycle.status)}
                        </span>
                      </span>
                      <span className="audit-cycle-card__meta">
                        <MapPin size={12} aria-hidden />
                        {auditCycleSiteLabel(cycle.site)}
                        <span className="audit-cycle-card__meta-sep" aria-hidden>·</span>
                        Tap anywhere for SKU detail
                      </span>
                    </span>
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={`audit-cycle-card__chevron${expanded ? ' is-open' : ''}`}
                    />
                  </header>

                  <div className="audit-cycle-card__stats">
                    <div className="audit-cycle-card__stat">
                      <span className="audit-cycle-card__stat-label">SKUs in cycle</span>
                      <strong className="audit-cycle-card__stat-value">
                        {totals.skuCount.toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div className="audit-cycle-card__stat">
                      <span className="audit-cycle-card__stat-label">Audited qty</span>
                      <strong className="audit-cycle-card__stat-value">
                        {totals.auditedQty.toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div className="audit-cycle-card__stat">
                      <span className="audit-cycle-card__stat-label">Audit Diff</span>
                      <strong
                        className={[
                          'audit-cycle-card__stat-value',
                          totals.auditDiff === 0 ? '' : totals.auditDiff > 0 ? 'is-over' : 'is-under',
                        ].filter(Boolean).join(' ')}
                      >
                        {formatSignedQty(totals.auditDiff)}
                      </strong>
                    </div>
                    <div className="audit-cycle-card__stat">
                      <span className="audit-cycle-card__stat-label">Diff × price</span>
                      <strong
                        className={[
                          'audit-cycle-card__stat-value',
                          totals.diffValue === 0 ? '' : totals.diffValue > 0 ? 'is-over' : 'is-under',
                        ].filter(Boolean).join(' ')}
                      >
                        {formatCurrency(totals.diffValue)}
                      </strong>
                    </div>
                  </div>

                  <div className="audit-cycle-card__timeline">
                    <div>
                      <span>Created</span>
                      <strong>{formatWhen(cycle.createdAt)}</strong>
                    </div>
                    <div>
                      <span>Opened</span>
                      <strong>{formatWhen(cycle.openedAt)}</strong>
                    </div>
                    <div>
                      <span>Closed</span>
                      <strong>{formatWhen(cycle.closedAt)}</strong>
                    </div>
                  </div>
                </div>

                <div className="audit-cycle-card__footer">
                  {cycle.status === 'open' ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm audit-cycle-card__close-btn"
                      disabled={busyKey != null}
                      onClick={() => void handleClose(cycle)}
                    >
                      <Lock size={14} aria-hidden />
                      Close
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey != null}
                      onClick={() => void handleOpen(cycle)}
                    >
                      <Play size={14} aria-hidden />
                      {cycle.status === 'closed' ? 'Reopen' : 'Open'}
                    </button>
                  )}
                </div>

                <div
                  className={`audit-cycle-card__drawer${expanded ? ' is-open' : ''}`}
                  aria-hidden={!expanded}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="audit-cycle-card__columns" role="group" aria-label="Visible columns">
                    <span className="audit-cycle-card__columns-label">Columns</span>
                    <div className="audit-cycle-card__columns-list">
                      {AUDIT_CYCLE_COLUMNS.map(col => (
                        <label key={col.key} className="audit-cycle-card__column-check">
                          <input
                            type="checkbox"
                            checked={visibleColumns[col.key]}
                            onChange={() => toggleColumn(col.key)}
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <p className="audit-cycle-card__empty-table">
                      No SKUs stamped or counted in this cycle yet.
                    </p>
                  ) : visibleColumnList.length === 0 ? (
                    <p className="audit-cycle-card__empty-table">
                      Select at least one column to show.
                    </p>
                  ) : (
                    <div className="audit-cycle-card__table-panel">
                      <div className="audit-cycle-card__table-wrap">
                        <table className="audit-cycle-card__table">
                          <thead>
                            <tr>
                              {visibleColumnList.map(col => (
                                <th key={col.key}>{col.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(row => (
                              <tr key={row.productId}>
                                {visibleColumns.sku && (
                                  <td className="audit-cycle-card__sku">{row.sku}</td>
                                )}
                                {visibleColumns.name && (
                                  <td className="audit-cycle-card__name-cell">{row.name}</td>
                                )}
                                {visibleColumns.zoho && (
                                  <td>{row.zohoAtAudit.toLocaleString('en-IN')}</td>
                                )}
                                {visibleColumns.audited && (
                                  <td>{row.auditedQty.toLocaleString('en-IN')}</td>
                                )}
                                {visibleColumns.date && (
                                  <td>{formatAuditDate(row.auditedAt)}</td>
                                )}
                                {visibleColumns.time && (
                                  <td>{formatAuditTime(row.auditedAt)}</td>
                                )}
                                {visibleColumns.diff && (
                                  <td className={row.auditDiff === 0 ? '' : row.auditDiff > 0 ? 'is-over' : 'is-under'}>
                                    {formatSignedQty(row.auditDiff)}
                                  </td>
                                )}
                                {visibleColumns.diffValue && (
                                  <td>{formatCurrency(row.diffValue)}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="audit-cycle-card__totals" aria-label="Cycle totals">
                        <span className="audit-cycle-card__totals-label">
                          Total · {totals.skuCount.toLocaleString('en-IN')} SKUs
                        </span>
                        <div className="audit-cycle-card__totals-metrics">
                          {visibleColumns.zoho && (
                            <span>
                              <em>Zoho</em>
                              {totals.zohoAtAudit.toLocaleString('en-IN')}
                            </span>
                          )}
                          {visibleColumns.audited && (
                            <span>
                              <em>Audited</em>
                              {totals.auditedQty.toLocaleString('en-IN')}
                            </span>
                          )}
                          {visibleColumns.diff && (
                            <span className={totals.auditDiff === 0 ? '' : totals.auditDiff > 0 ? 'is-over' : 'is-under'}>
                              <em>Diff</em>
                              {formatSignedQty(totals.auditDiff)}
                            </span>
                          )}
                          {visibleColumns.diffValue && (
                            <span className={totals.diffValue === 0 ? '' : totals.diffValue > 0 ? 'is-over' : 'is-under'}>
                              <em>Diff × price</em>
                              {formatCurrency(totals.diffValue)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
