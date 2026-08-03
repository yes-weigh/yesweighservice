import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs } from 'firebase/firestore';
import {
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { canSuperAdminWrite } from '../../lib/staffAccess';
import {
  clearZohoSalespersonsCache,
  fetchZohoSalespersonHideImpact,
  listZohoSalespersons,
  setZohoSalespersonPortalHidden,
  syncZohoSalespersonsFromZoho,
  type ZohoSalespersonHideImpact,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import {
  linkZohoSalespersonToPortalUser,
  listClaimedZohoSalespersonIds,
  staffHasZohoSalespersonLink,
  unlinkZohoSalespersonFromPortalUser,
} from '../../lib/zohoSalespersonStaff';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';

type FilterKey = 'all' | 'unlinked' | 'linked' | 'hidden' | 'inactive';

type HideDialogState = {
  row: ZohoSalespersonOption;
  impact: ZohoSalespersonHideImpact | null;
  loadingImpact: boolean;
  reassignToStaffUid: string;
};

type OwnerOption = {
  uid: string;
  displayName: string;
  hint?: string;
};

function PortalOwnerAutocomplete({
  valueUid,
  valueLabel,
  options,
  disabled,
  busy,
  ariaLabel,
  onSelect,
  onClear,
}: {
  valueUid: string;
  valueLabel: string;
  options: OwnerOption[];
  disabled?: boolean;
  busy?: boolean;
  ariaLabel: string;
  onSelect: (uid: string) => void;
  onClear: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? options
      : options.filter(opt =>
        opt.displayName.toLowerCase().includes(q)
        || (opt.hint?.toLowerCase().includes(q) ?? false)
        || opt.uid.toLowerCase().includes(q),
      );
    return list.slice(0, 40);
  }, [options, query]);

  const updateMenuPosition = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const maxH = Math.min(260, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < Math.min(maxH, 160) && spaceAbove > spaceBelow;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setMenuStyle({
      position: 'fixed',
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left,
      width,
      maxHeight: openUp ? Math.min(maxH, spaceAbove) : Math.min(maxH, Math.max(spaceBelow, 120)),
      zIndex: 720,
    });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.zoho-sp-owner-ac__menu')) return;
      setOpen(false);
      setQuery('');
    };
    const onReposition = () => updateMenuPosition();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const pick = (uid: string) => {
    onSelect(uid);
    setOpen(false);
    setQuery('');
  };

  const showLabel = !open && !query;
  const displayValue = showLabel ? (valueLabel || '') : query;

  const menu = open ? (
    <ul
      className="zoho-sp-owner-ac__menu panel glass"
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel}
    >
      {matches.length === 0 ? (
        <li className="zoho-sp-owner-ac__empty text-muted text-sm">No matching staff</li>
      ) : (
        matches.map((opt, index) => (
          <li key={opt.uid} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={opt.uid === valueUid || index === activeIndex}
              className={[
                'zoho-sp-owner-ac__option',
                opt.uid === valueUid ? 'is-selected' : '',
                index === activeIndex ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(opt.uid)}
            >
              <span className="zoho-sp-owner-ac__option-name">{opt.displayName}</span>
              {opt.hint ? (
                <span className="zoho-sp-owner-ac__option-hint">{opt.hint}</span>
              ) : null}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`zoho-sp-owner-ac${open ? ' is-open' : ''}${disabled || busy ? ' is-disabled' : ''}`}
    >
      <Search size={14} className="zoho-sp-owner-ac__icon" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className="zoho-sp-owner-ac__input"
        value={displayValue}
        disabled={disabled || busy}
        placeholder={valueUid ? valueLabel || 'Linked owner' : 'Link owner…'}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        onFocus={() => {
          if (!disabled && !busy) {
            setOpen(true);
            setQuery('');
            updateMenuPosition();
          }
        }}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const row = matches[activeIndex];
            if (row) pick(row.uid);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            inputRef.current?.blur();
          }
        }}
      />
      {busy ? (
        <RefreshCw size={14} className="spin-icon zoho-sp-owner-ac__busy" aria-hidden />
      ) : valueUid && !disabled ? (
        <button
          type="button"
          className="zoho-sp-owner-ac__clear"
          title="Unlink owner"
          aria-label="Unlink owner"
          onClick={e => {
            e.stopPropagation();
            onClear();
          }}
        >
          <X size={14} />
        </button>
      ) : null}
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

export function ZohoSalespersonsPanel() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canEdit = canSuperAdminWrite(user);

  const [rows, setRows] = useState<ZohoSalespersonOption[]>([]);
  const [claimed, setClaimed] = useState<Map<string, { uid: string; displayName: string }>>(new Map());
  const [portalUsers, setPortalUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hideDialog, setHideDialog] = useState<HideDialogState | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      if (forceRefresh) clearZohoSalespersonsCache();
      const [spRows, claimedMap, usersSnap] = await Promise.all([
        forceRefresh
          ? syncZohoSalespersonsFromZoho()
          : listZohoSalespersons({ includeHidden: true }),
        listClaimedZohoSalespersonIds(),
        getDocs(collection(db, 'users')),
      ]);
      setRows(spRows);
      setClaimed(claimedMap);

      const users = usersSnap.docs
        .map(d => {
          const data = d.data() as FirestoreUserDoc;
          const role = normalizeRole(String(data.role ?? ''));
          if (!role || (role !== 'staff' && role !== 'super_admin')) return null;
          if (data.active === false) return null;
          return { uid: d.id, ...data, role } as UserRecord;
        })
        .filter((u): u is UserRecord => Boolean(u))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setPortalUsers(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Zoho salespersons.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!highlightedId) return;
    const el = document.getElementById(`zoho-sp-row-${highlightedId}`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const timer = window.setTimeout(() => setHighlightedId(null), 4500);
    return () => window.clearTimeout(timer);
  }, [highlightedId, rows]);

  const ownerOptions = useMemo<OwnerOption[]>(
    () => portalUsers.map(u => ({
      uid: u.uid,
      displayName: u.displayName,
      hint: u.role === 'super_admin' ? 'Super Admin' : undefined,
    })),
    [portalUsers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      const owner = claimed.get(row.id);
      if (filter === 'unlinked' && owner) return false;
      if (filter === 'linked' && !owner) return false;
      if (filter === 'hidden' && !row.hiddenFromPortal) return false;
      if (filter === 'inactive' && row.active) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q)
        || row.id.toLowerCase().includes(q)
        || (row.email?.toLowerCase().includes(q) ?? false)
        || (owner?.displayName.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, claimed, filter, search]);

  const counts = useMemo(() => {
    let unlinked = 0;
    let linked = 0;
    let hidden = 0;
    let inactive = 0;
    for (const row of rows) {
      if (claimed.has(row.id)) linked += 1;
      else unlinked += 1;
      if (row.hiddenFromPortal) hidden += 1;
      if (!row.active) inactive += 1;
    }
    return { total: rows.length, unlinked, linked, hidden, inactive };
  }, [rows, claimed]);

  const reassignTargets = useMemo(() => {
    const ownerUid = hideDialog?.impact?.linkedStaff?.uid;
    return portalUsers.filter(
      u => u.uid !== ownerUid && staffHasZohoSalespersonLink(u),
    );
  }, [portalUsers, hideDialog?.impact?.linkedStaff?.uid]);

  const applyHide = async (
    row: ZohoSalespersonOption,
    reassignToStaffUid: string | null = null,
  ) => {
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      const next = await setZohoSalespersonPortalHidden(row.id, true, {
        reassignToStaffUid,
      });
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...next } : r)));
      setHighlightedId(row.id);
      const moved = next.reassigned?.moved ?? 0;
      setSuccess(
        moved > 0
          ? `Hidden ${row.name}. Reassigned ${moved} dealer${moved === 1 ? '' : 's'} to ${next.reassigned?.targetName}.`
          : `Hidden ${row.name} from portal.`,
      );
      setHideDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hide salesperson.');
    } finally {
      setBusyId('');
    }
  };

  const openHideDialog = async (row: ZohoSalespersonOption) => {
    if (!canEdit) return;
    setError('');
    setSuccess('');

    // No linked portal owner — hide immediately (nothing to reassign).
    if (!claimed.get(row.id)) {
      await applyHide(row, null);
      return;
    }

    setHideDialog({
      row,
      impact: null,
      loadingImpact: true,
      reassignToStaffUid: '',
    });
    try {
      const impact = await fetchZohoSalespersonHideImpact(row.id);
      if (!impact.requiresReassign) {
        // Owner exists but zero dealers — no popup needed.
        setHideDialog(null);
        await applyHide(row, null);
        return;
      }
      setHideDialog(prev => (prev && prev.row.id === row.id
        ? { ...prev, impact, loadingImpact: false }
        : prev));
    } catch (err) {
      setHideDialog(null);
      setError(err instanceof Error ? err.message : 'Could not check dealers for hide.');
    }
  };

  const closeHideDialog = () => {
    if (busyId) return;
    setHideDialog(null);
  };

  const confirmHideDialog = async () => {
    if (!canEdit || !hideDialog) return;
    const { row, impact, reassignToStaffUid } = hideDialog;
    if (impact?.requiresReassign && !reassignToStaffUid.trim()) {
      setError('Choose another portal owner (salesperson) to receive these dealers before hiding.');
      return;
    }
    await applyHide(
      row,
      impact?.requiresReassign ? reassignToStaffUid.trim() : null,
    );
  };

  const handleHide = async (row: ZohoSalespersonOption, hidden: boolean) => {
    if (!canEdit) return;
    if (hidden) {
      await openHideDialog(row);
      return;
    }
    const ok = await confirm({
      title: 'Show in portal?',
      message: `${row.name} will appear in pickers and dealer linking again.`,
      confirmLabel: 'Unhide',
    });
    if (!ok) return;
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      const next = await setZohoSalespersonPortalHidden(row.id, false);
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...next } : r)));
      setHighlightedId(row.id);
      setSuccess(`Unhid ${row.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update visibility.');
    } finally {
      setBusyId('');
    }
  };

  const handleBulkHideUnlinkedInactive = async () => {
    if (!canEdit) return;
    const targets = rows.filter(
      r => !claimed.has(r.id) && !r.active && !r.hiddenFromPortal,
    );
    if (!targets.length) {
      setError('No unlinked inactive salespersons to hide.');
      return;
    }
    const ok = await confirm({
      title: 'Hide unlinked inactive?',
      message: `Hide ${targets.length} inactive Zoho salesperson${targets.length === 1 ? '' : 's'} that have no portal owner?`,
      confirmLabel: 'Hide all',
    });
    if (!ok) return;
    setBusyId('bulk');
    setError('');
    try {
      for (const row of targets) {
        await setZohoSalespersonPortalHidden(row.id, true);
      }
      await load(false);
      setSuccess(`Hidden ${targets.length} inactive unlinked salesperson${targets.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk hide failed.');
    } finally {
      setBusyId('');
    }
  };

  const handleInlineOwnerChange = async (row: ZohoSalespersonOption, nextUid: string) => {
    if (!canEdit) return;
    const uid = nextUid.trim();
    const current = claimed.get(row.id);
    if (current?.uid === uid) return;

    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      if (!uid) {
        if (!current) return;
        await unlinkZohoSalespersonFromPortalUser({
          zohoSalespersonId: row.id,
          staffUid: current.uid,
        });
        setClaimed(prev => {
          const next = new Map(prev);
          next.delete(row.id);
          return next;
        });
        setHighlightedId(row.id);
        setSuccess(`Unlinked ${row.name}`);
        return;
      }

      if (current && current.uid !== uid) {
        await unlinkZohoSalespersonFromPortalUser({
          zohoSalespersonId: row.id,
          staffUid: current.uid,
        });
      }
      const result = await linkZohoSalespersonToPortalUser({
        zohoSalespersonId: row.id,
        zohoSalespersonName: row.name,
        staffUid: uid,
      });
      setClaimed(prev => {
        const next = new Map(prev);
        next.set(row.id, { uid: result.staffUid, displayName: result.staffName });
        return next;
      });
      setHighlightedId(row.id);
      setSuccess(`Linked ${row.name} → ${result.staffName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update linked owner.');
    } finally {
      setBusyId('');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSuccess('');
    await load(true);
    setSuccess('Synced salespersons from Zoho.');
  };

  const hideDialogUi = hideDialog ? (
    <div className="zoho-sp-panel__modal-backdrop" role="presentation" onClick={closeHideDialog}>
      <div
        className="panel glass zoho-sp-panel__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zoho-sp-hide-title"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="zoho-sp-hide-title">Hide {hideDialog.row.name} from portal?</h3>
        <p className="text-muted text-sm">
          Dealers are assigned to <strong>portal users</strong>, not Zoho salespersons directly.
          Zoho salesperson → portal owner → dealers.
        </p>
        {hideDialog.loadingImpact ? (
          <FetchingLoader label="Checking assigned dealers…" />
        ) : hideDialog.impact?.requiresReassign ? (
          <>
            <p className="text-sm">
              Linked to <strong>{hideDialog.impact.linkedStaff?.displayName}</strong>, who currently
              owns <strong>{hideDialog.impact.dealerCount}</strong> dealer
              {hideDialog.impact.dealerCount === 1 ? '' : 's'}.
              Reassign those dealers to another portal owner before hiding.
            </p>
            <div className="form-group">
              <label htmlFor="zoho-sp-reassign-owner">Reassign dealers to</label>
              <select
                id="zoho-sp-reassign-owner"
                className="input-field catalog-select"
                value={hideDialog.reassignToStaffUid}
                disabled={Boolean(busyId)}
                onChange={e => setHideDialog(prev => (prev
                  ? { ...prev, reassignToStaffUid: e.target.value }
                  : prev))}
              >
                <option value="">Choose portal owner…</option>
                {reassignTargets.map(u => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName}
                    {u.role === 'super_admin' ? ' (Super Admin)' : ''}
                  </option>
                ))}
              </select>
              {reassignTargets.length === 0 ? (
                <p className="text-muted text-sm">
                  No other portal owners with a Zoho salesperson link. Link someone in this tab first.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm">
            {hideDialog.impact?.linkedStaff
              ? `${hideDialog.impact.linkedStaff.displayName} has no dealers assigned — safe to hide.`
              : 'No portal owner linked — safe to hide.'}
            {' '}This salesperson will leave pickers and dealer linking.
          </p>
        )}
        {error ? <div className="login-error mt-3">{error}</div> : null}
        <div className="zoho-sp-panel__modal-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={Boolean(busyId)}
            onClick={closeHideDialog}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              Boolean(busyId)
              || hideDialog.loadingImpact
              || (Boolean(hideDialog.impact?.requiresReassign) && !hideDialog.reassignToStaffUid)
            }
            onClick={() => void confirmHideDialog()}
          >
            {busyId === hideDialog.row.id
              ? <RefreshCw size={16} className="spin-icon" />
              : <EyeOff size={16} />}
            {hideDialog.impact?.requiresReassign ? 'Reassign & hide' : 'Hide from portal'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="zoho-sp-panel fade-in">
      {hideDialogUi}
      <section className="panel glass zoho-sp-panel__hero">
        <div>
          <h2>Zoho salespersons</h2>
          <p className="text-muted text-sm">
            Link portal staff or super admins to Zoho salespersons. Dealers are assigned to those
            portal owners. Hide noise accounts from pickers and dealer linking without changing Zoho.
          </p>
        </div>
        <div className="zoho-sp-panel__hero-actions">
          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || Boolean(busyId)}
              onClick={() => void handleBulkHideUnlinkedInactive()}
            >
              <EyeOff size={16} />
              Hide inactive unlinked
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading || syncing}
            onClick={() => void handleSync()}
          >
            {syncing ? <RefreshCw size={16} className="spin-icon" /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing…' : 'Sync from Zoho'}
          </button>
        </div>
      </section>

      {success ? (
        <div className="user-management__save-notice" role="status">{success}</div>
      ) : null}
      {error && !hideDialog ? (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      ) : null}

      <section className="panel glass panel--table">
        <div className="zoho-sp-panel__toolbar">
          <label className="zoho-sp-panel__search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              className="input-field"
              placeholder="Search name, id, owner…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          <div className="zoho-sp-panel__filters" role="group" aria-label="Filter salespersons">
            {([
              ['all', `All (${counts.total})`],
              ['unlinked', `Unlinked (${counts.unlinked})`],
              ['linked', `Linked (${counts.linked})`],
              ['hidden', `Hidden (${counts.hidden})`],
              ['inactive', `Zoho inactive (${counts.inactive})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`dealers-page-tabs__tab${filter === key ? ' dealers-page-tabs__tab--active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <FetchingLoader label="Loading Zoho salespersons…" />
        ) : filtered.length === 0 ? (
          <p className="text-muted text-center p-4">No salespersons match.</p>
        ) : (
          <div className="table-scroll-wrap">
            <table className="data-table dealers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zoho salesperson</th>
                  <th>Zoho</th>
                  <th>Portal</th>
                  <th>Linked owner</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => {
                  const owner = claimed.get(row.id);
                  const highlighted = highlightedId === row.id;
                  const busy = busyId === row.id;
                  return (
                    <tr
                      key={row.id}
                      id={`zoho-sp-row-${row.id}`}
                      className={highlighted ? 'user-management__row--highlighted' : undefined}
                    >
                      <td>{index + 1}</td>
                      <td>
                        <div className="dealer-linking-table__primary">{row.name}</div>
                        <div className="text-muted text-sm">{row.id}</div>
                      </td>
                      <td>
                        <span className={`status-badge ${row.active ? 'active' : 'inactive'}`}>
                          {row.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${row.hiddenFromPortal ? 'inactive' : 'active'}`}>
                          {row.hiddenFromPortal ? 'Hidden' : 'Visible'}
                        </span>
                      </td>
                      <td className="zoho-sp-panel__owner-cell" onClick={e => e.stopPropagation()}>
                        {canEdit ? (
                          <PortalOwnerAutocomplete
                            valueUid={owner?.uid ?? ''}
                            valueLabel={owner?.displayName ?? ''}
                            options={ownerOptions}
                            disabled={!canEdit}
                            busy={busy}
                            ariaLabel={`Portal owner for ${row.name}`}
                            onSelect={uid => void handleInlineOwnerChange(row, uid)}
                            onClear={() => void handleInlineOwnerChange(row, '')}
                          />
                        ) : owner ? (
                          <span>{owner.displayName}</span>
                        ) : (
                          <span className="text-muted">Unlinked</span>
                        )}
                      </td>
                      <td className="text-right user-management__actions">
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn-icon"
                            title={row.hiddenFromPortal ? 'Unhide' : 'Hide'}
                            disabled={busy}
                            onClick={() => void handleHide(row, !row.hiddenFromPortal)}
                          >
                            {row.hiddenFromPortal ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                        ) : (
                          <span className="text-muted text-sm">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
