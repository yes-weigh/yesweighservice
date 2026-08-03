import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import {
  Eye,
  EyeOff,
  Link2,
  RefreshCw,
  Search,
  Unlink,
  UserPlus,
} from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { canSuperAdminWrite } from '../../lib/staffAccess';
import {
  clearZohoSalespersonsCache,
  listZohoSalespersons,
  setZohoSalespersonPortalHidden,
  syncZohoSalespersonsFromZoho,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import {
  linkZohoSalespersonToPortalUser,
  listClaimedZohoSalespersonIds,
  unlinkZohoSalespersonFromPortalUser,
} from '../../lib/zohoSalespersonStaff';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';

type FilterKey = 'all' | 'unlinked' | 'linked' | 'hidden' | 'inactive';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickUid, setPickUid] = useState('');

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

  const editingRow = editingId ? rows.find(r => r.id === editingId) ?? null : null;
  const editingOwner = editingId ? claimed.get(editingId) : undefined;

  const openEdit = (row: ZohoSalespersonOption) => {
    if (!canEdit) return;
    setEditingId(row.id);
    setPickUid(claimed.get(row.id)?.uid ?? '');
    setError('');
    setSuccess('');
  };

  const closeEdit = () => {
    setEditingId(null);
    setPickUid('');
  };

  const handleSync = async () => {
    setSyncing(true);
    setSuccess('');
    await load(true);
    setSuccess('Synced salespersons from Zoho.');
  };

  const handleHide = async (row: ZohoSalespersonOption, hidden: boolean) => {
    if (!canEdit) return;
    const ok = await confirm({
      title: hidden ? 'Hide from portal?' : 'Show in portal?',
      message: hidden
        ? `${row.name} will be hidden from pickers and skipped in dealer linking. Existing dealer assignments stay.`
        : `${row.name} will appear in pickers and dealer linking again.`,
      confirmLabel: hidden ? 'Hide' : 'Unhide',
    });
    if (!ok) return;
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      const next = await setZohoSalespersonPortalHidden(row.id, hidden);
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...next } : r)));
      setHighlightedId(row.id);
      setSuccess(hidden ? `Hidden ${row.name} from portal.` : `Unhid ${row.name}.`);
      closeEdit();
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

  const handleSaveLink = async () => {
    if (!canEdit || !editingRow) return;
    const uid = pickUid.trim();
    if (!uid) {
      setError('Choose a portal owner.');
      return;
    }
    setBusyId(editingRow.id);
    setError('');
    setSuccess('');
    try {
      if (editingOwner && editingOwner.uid !== uid) {
        await unlinkZohoSalespersonFromPortalUser({
          zohoSalespersonId: editingRow.id,
          staffUid: editingOwner.uid,
        });
      }
      const result = await linkZohoSalespersonToPortalUser({
        zohoSalespersonId: editingRow.id,
        zohoSalespersonName: editingRow.name,
        staffUid: uid,
      });
      setClaimed(prev => {
        const next = new Map(prev);
        next.set(editingRow.id, { uid: result.staffUid, displayName: result.staffName });
        return next;
      });
      setHighlightedId(editingRow.id);
      setSuccess(`Linked ${editingRow.name} → ${result.staffName}`);
      closeEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link salesperson.');
    } finally {
      setBusyId('');
    }
  };

  const handleUnlink = async () => {
    if (!canEdit || !editingRow || !editingOwner) return;
    const ok = await confirm({
      title: 'Unlink portal owner?',
      message: `Remove ${editingRow.name} from ${editingOwner.displayName}? Dealer assignments are not changed.`,
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(editingRow.id);
    setError('');
    setSuccess('');
    try {
      await unlinkZohoSalespersonFromPortalUser({
        zohoSalespersonId: editingRow.id,
        staffUid: editingOwner.uid,
      });
      setClaimed(prev => {
        const next = new Map(prev);
        next.delete(editingRow.id);
        return next;
      });
      setHighlightedId(editingRow.id);
      setSuccess(`Unlinked ${editingRow.name}`);
      closeEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink.');
    } finally {
      setBusyId('');
    }
  };

  if (editingRow) {
    const busy = busyId === editingRow.id;
    return (
      <div className="panel glass zoho-sp-panel zoho-sp-panel--editor fade-in">
        <div className="form-panel-topbar">
          <h2>Edit Zoho salesperson</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={closeEdit} disabled={busy}>
            Cancel
          </button>
        </div>
        <div className="form-panel-body">
          {error ? <div className="login-error mb-3">{error}</div> : null}
          <div className="zoho-sp-panel__editor-head">
            <div>
              <div className="zoho-sp-panel__name">{editingRow.name}</div>
              <div className="text-muted text-sm">{editingRow.id}</div>
              {editingRow.email ? <div className="text-muted text-sm">{editingRow.email}</div> : null}
            </div>
            <div className="zoho-sp-panel__badges">
              <span className={`status-badge ${editingRow.active ? 'active' : 'inactive'}`}>
                {editingRow.active ? 'Zoho active' : 'Zoho inactive'}
              </span>
              <span className={`status-badge ${editingRow.hiddenFromPortal ? 'inactive' : 'active'}`}>
                {editingRow.hiddenFromPortal ? 'Hidden in portal' : 'Visible in portal'}
              </span>
            </div>
          </div>

          <div className="form-group mt-4">
            <label htmlFor="zoho-sp-portal-owner">Portal owner</label>
            <select
              id="zoho-sp-portal-owner"
              className="input-field catalog-select"
              value={pickUid}
              disabled={busy || !canEdit}
              onChange={e => setPickUid(e.target.value)}
            >
              <option value="">Choose staff or super admin…</option>
              {portalUsers.map(u => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                  {u.role === 'super_admin' ? ' (Super Admin)' : ''}
                </option>
              ))}
            </select>
            <p className="text-muted text-sm">
              One Zoho salesperson → one portal owner. A person may own multiple Zoho salespersons.
            </p>
          </div>

          <div className="zoho-sp-panel__editor-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void handleHide(editingRow, !editingRow.hiddenFromPortal)}
            >
              {editingRow.hiddenFromPortal ? <Eye size={16} /> : <EyeOff size={16} />}
              {editingRow.hiddenFromPortal ? 'Unhide in portal' : 'Hide from portal'}
            </button>
            {editingOwner ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm text-red"
                disabled={busy}
                onClick={() => void handleUnlink()}
              >
                <Unlink size={16} />
                Unlink
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-success btn-sm"
              disabled={busy || !pickUid}
              onClick={() => void handleSaveLink()}
            >
              {busy ? <RefreshCw size={16} className="spin-icon" /> : <Link2 size={16} />}
              {editingOwner ? 'Save owner' : 'Link owner'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="zoho-sp-panel fade-in">
      <section className="panel glass zoho-sp-panel__hero">
        <div>
          <h2>Zoho salespersons</h2>
          <p className="text-muted text-sm">
            Link portal staff or super admins to Zoho salespersons. Hide noise accounts from pickers
            and dealer linking without changing Zoho.
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
      {error ? (
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
                      className={[
                        canEdit ? 'user-management__row--clickable' : '',
                        highlighted ? 'user-management__row--highlighted' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onClick={canEdit ? () => openEdit(row) : undefined}
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
                      <td>
                        {owner ? (
                          <span>{owner.displayName}</span>
                        ) : (
                          <span className="text-muted">Unlinked</span>
                        )}
                      </td>
                      <td className="text-right user-management__actions" onClick={e => e.stopPropagation()}>
                        {canEdit ? (
                          <>
                            <button
                              type="button"
                              className="btn-icon"
                              title="Link / edit"
                              disabled={busy}
                              onClick={() => openEdit(row)}
                            >
                              <UserPlus size={16} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon"
                              title={row.hiddenFromPortal ? 'Unhide' : 'Hide'}
                              disabled={busy}
                              onClick={() => void handleHide(row, !row.hiddenFromPortal)}
                            >
                              {row.hiddenFromPortal ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          </>
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
