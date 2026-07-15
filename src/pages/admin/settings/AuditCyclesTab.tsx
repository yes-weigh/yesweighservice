import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Lock, Play, Plus } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  closeAuditCycle,
  createAuditCycle,
  listAuditCycles,
  openAuditCycle,
} from '../../../lib/auditCycles/data';
import {
  auditCycleSiteLabel,
  type AuditCycleDoc,
  type AuditCycleSite,
} from '../../../types/audit-cycle';

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

function statusLabel(status: AuditCycleDoc['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'closed') return 'Closed';
  return 'Scheduled';
}

export const AuditCyclesTab: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [cycles, setCycles] = useState<AuditCycleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSite, setNewSite] = useState<AuditCycleSite>('head_office');
  const [newName, setNewName] = useState('');
  const [openImmediately, setOpenImmediately] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCycles(await listAuditCycles());
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
          {cycles.map(cycle => (
            <article key={cycle.id} className={`audit-cycle-card is-${cycle.status}`}>
              <header className="audit-cycle-card__head">
                <div>
                  <strong className="audit-cycle-card__title">{cycle.name}</strong>
                  <span className="audit-cycle-card__meta text-muted">
                    {auditCycleSiteLabel(cycle.site)} · {statusLabel(cycle.status)}
                  </span>
                </div>
                <div className="audit-cycle-card__actions">
                  {cycle.status === 'open' ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
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
              </header>
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
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
