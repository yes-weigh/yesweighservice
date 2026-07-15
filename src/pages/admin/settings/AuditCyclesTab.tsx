import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronDown, Lock, Play, Plus, RefreshCw } from 'lucide-react';
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
import {
  migrateAuditsIntoCycles,
  type MigrateAuditsIntoCyclesSummary,
} from '../../../lib/auditCycles/migrate';
import { fetchCatalog, formatCurrency } from '../../../lib/catalog';
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
  const [stampSummary, setStampSummary] = useState<MigrateAuditsIntoCyclesSummary | null>(null);

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

  const toggleExpanded = (cycleId: string) => {
    setExpandedCycleId(prev => (prev === cycleId ? null : cycleId));
  };

  const handleStampLocationAudits = async () => {
    const ok = await confirm({
      title: 'Stamp location audits into open cycles?',
      message:
        'Creates missing audit snapshots from store-room bins / warehouse locations, then stamps them into the open HO and Cochin cycles. Use this if cycle SKU counts are lower than Catalog “Audited”.',
      confirmLabel: 'Stamp now',
    });
    if (!ok) return;

    setBusyKey('stamp');
    setError('');
    setStampSummary(null);
    try {
      const summary = await migrateAuditsIntoCycles({ dryRun: false, force: false });
      setStampSummary(summary);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Stamp failed. Deploy Cloud Functions if migrateAuditsIntoCyclesFn is missing.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Audit cycles</h3>
          <p className="text-muted text-sm">
            Schedule and open Head Office or Cochin count cycles. Physical counts freeze between cycles while Zoho Diff moves.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busyKey != null}
          onClick={() => setShowCreate(open => !open)}
        >
          <Plus size={15} aria-hidden />
          New cycle
        </button>
      </header>

      <div className="audit-cycles-open-summary">
        {(['head_office', 'cochin'] as const).map(site => {
          const open = openBySite.get(site);
          return (
            <div key={site} className="audit-cycles-open-summary__item">
              <strong>{auditCycleSiteLabel(site)}</strong>
              <span className={open ? 'is-open' : 'is-locked'}>
                {open ? `Open: ${open.name}` : 'No open cycle'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="audit-cycles-migrate">
        <div>
          <strong>Stamp location audits into cycles</strong>
          <p className="text-muted text-sm">
            Catalog “Audited” counts bins/locations. Cycle cards only count stamped snapshots — run this if HO/Cochin cycle SKUs look low.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busyKey != null}
          onClick={() => void handleStampLocationAudits()}
        >
          <RefreshCw size={14} aria-hidden className={busyKey === 'stamp' ? 'spin-icon' : undefined} />
          {busyKey === 'stamp' ? 'Stamping…' : 'Stamp into open cycles'}
        </button>
      </div>

      {stampSummary && (
        <p className="audit-cycles-migrate__result text-sm">
          Backfill created {stampSummary.backfill?.created ?? 0} snapshots.
          Stamped HO {stampSummary.stampedHeadOffice}, Cochin {stampSummary.stampedCochin}.
          Already stamped {stampSummary.skippedAlreadyStamped}.
          {stampSummary.errors.length > 0 ? ` Errors: ${stampSummary.errors.length}.` : ''}
        </p>
      )}

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      {showCreate && (
        <div className="settings-locations__add-form">
          <label className="settings-locations__field">
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
          <label className="settings-locations__field settings-locations__field--grow">
            <span>Name</span>
            <input
              type="text"
              value={newName}
              placeholder={newSite === 'head_office' ? 'e.g. HO April cycle' : 'e.g. Cochin April cycle'}
              onChange={e => setNewName(e.target.value)}
              disabled={busyKey === 'create'}
            />
          </label>
          <label className="settings-locations__field audit-cycles-open-now">
            <input
              type="checkbox"
              checked={openImmediately}
              onChange={e => setOpenImmediately(e.target.checked)}
              disabled={busyKey === 'create'}
            />
            <span>Open immediately</span>
          </label>
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
      )}

      {loading ? (
        <div className="settings-locations__loading">
          <div className="loader-ring" />
        </div>
      ) : cycles.length === 0 ? (
        <div className="settings-locations__empty">
          <CalendarRange size={28} aria-hidden />
          <p>No audit cycles yet. Create one to unlock counting for a site.</p>
        </div>
      ) : (
        <div className="audit-cycles-list">
          {cycles.map(cycle => {
            const rows = rowsByCycleId.get(cycle.id) ?? [];
            const totals = summarizeAuditCycleRows(rows);
            const expanded = expandedCycleId === cycle.id;

            return (
              <article
                key={cycle.id}
                className={`audit-cycle-card is-${cycle.status}${expanded ? ' is-expanded' : ''}`}
              >
                <header className="audit-cycle-card__head">
                  <button
                    type="button"
                    className="audit-cycle-card__toggle"
                    aria-expanded={expanded}
                    onClick={() => toggleExpanded(cycle.id)}
                  >
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={`audit-cycle-card__chevron${expanded ? ' is-open' : ''}`}
                    />
                    <span className="audit-cycle-card__title-wrap">
                      <strong className="audit-cycle-card__title">{cycle.name}</strong>
                      <span className="audit-cycle-card__meta text-muted">
                        {auditCycleSiteLabel(cycle.site)} · {statusLabel(cycle.status)}
                      </span>
                    </span>
                  </button>
                  <div className="audit-cycle-card__actions">
                    {cycle.status === 'open' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyKey != null}
                        onClick={e => {
                          e.stopPropagation();
                          void handleClose(cycle);
                        }}
                      >
                        <Lock size={14} aria-hidden />
                        Close
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyKey != null}
                        onClick={e => {
                          e.stopPropagation();
                          void handleOpen(cycle);
                        }}
                      >
                        <Play size={14} aria-hidden />
                        {cycle.status === 'closed' ? 'Reopen' : 'Open'}
                      </button>
                    )}
                  </div>
                </header>

                  <div className="audit-cycle-card__stats">
                  <div>
                    <span className="audit-cycle-card__stat-label">SKUs in cycle</span>
                    <strong>{totals.skuCount.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span className="audit-cycle-card__stat-label">Audited qty</span>
                    <strong>{totals.auditedQty.toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span className="audit-cycle-card__stat-label">Audit Diff</span>
                    <strong className={totals.auditDiff === 0 ? '' : totals.auditDiff > 0 ? 'is-over' : 'is-under'}>
                      {formatSignedQty(totals.auditDiff)}
                    </strong>
                  </div>
                  <div>
                    <span className="audit-cycle-card__stat-label">Diff × price</span>
                    <strong>{formatCurrency(totals.diffValue)}</strong>
                  </div>
                </div>

                <dl className="audit-cycle-card__dates">
                  <div>
                    <dt>Created</dt>
                    <dd>{formatWhen(cycle.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Opened</dt>
                    <dd>{formatWhen(cycle.openedAt)}</dd>
                  </div>
                  <div>
                    <dt>Closed</dt>
                    <dd>{formatWhen(cycle.closedAt)}</dd>
                  </div>
                </dl>

                {expanded && (
                  <div className="audit-cycle-card__table-wrap">
                    {rows.length === 0 ? (
                      <p className="text-muted text-sm audit-cycle-card__empty-table">
                        No SKUs stamped or counted in this cycle yet.
                      </p>
                    ) : (
                      <table className="audit-cycle-card__table">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Item name</th>
                            <th>Zoho count</th>
                            <th>Audited count</th>
                            <th>Audited date</th>
                            <th>Audited time</th>
                            <th>Audit Diff</th>
                            <th>Diff × price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(row => (
                            <tr key={row.productId}>
                              <td>{row.sku}</td>
                              <td>{row.name}</td>
                              <td>{row.zohoAtAudit.toLocaleString('en-IN')}</td>
                              <td>{row.auditedQty.toLocaleString('en-IN')}</td>
                              <td>{formatAuditDate(row.auditedAt)}</td>
                              <td>{formatAuditTime(row.auditedAt)}</td>
                              <td className={row.auditDiff === 0 ? '' : row.auditDiff > 0 ? 'is-over' : 'is-under'}>
                                {formatSignedQty(row.auditDiff)}
                              </td>
                              <td>{formatCurrency(row.diffValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={2}>Total ({totals.skuCount} SKUs)</td>
                            <td>{totals.zohoAtAudit.toLocaleString('en-IN')}</td>
                            <td>{totals.auditedQty.toLocaleString('en-IN')}</td>
                            <td colSpan={2} />
                            <td className={totals.auditDiff === 0 ? '' : totals.auditDiff > 0 ? 'is-over' : 'is-under'}>
                              {formatSignedQty(totals.auditDiff)}
                            </td>
                            <td>{formatCurrency(totals.diffValue)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
