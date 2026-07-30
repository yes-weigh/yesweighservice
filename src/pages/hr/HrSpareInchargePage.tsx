import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, RefreshCw, Search, UserMinus, Wrench } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { canManageSpareIncharge } from '../../lib/staffAccess';
import {
  addSpareInchargeMember,
  listSpareInchargeEligibleUsers,
  loadSpareInchargeSettings,
  primaryZohoSalespersonForUser,
  removeSpareInchargeMember,
  setSpareInchargeZohoSalesperson,
  spareInchargeRoleLabel,
  type SpareInchargeMember,
} from '../../lib/spareIncharge';
import {
  clearZohoSalespersonsCache,
  listZohoSalespersons,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import { listClaimedZohoSalespersonIds } from '../../lib/zohoSalespersonStaff';
import type { UserRecord } from '../../types';

type HrSpareInchargePageProps = {
  basePath: string;
};

function matchesQuery(user: UserRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    user.displayName,
    user.loginId,
    user.phone,
    user.email,
    user.role,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function SpareInchargeZohoCell({
  user,
  disabled,
  onLinked,
}: {
  user: UserRecord | null;
  disabled?: boolean;
  onLinked: (next: UserRecord) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const primary = primaryZohoSalespersonForUser(user);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ZohoSalespersonOption[]>([]);
  const [claimedBy, setClaimedBy] = useState<Map<string, { uid: string; displayName: string }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const showPicker = !primary || editing;

  const loadOptions = useCallback(async (forceRefresh = false) => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      if (forceRefresh) clearZohoSalespersonsCache();
      const [rows, claimed] = await Promise.all([
        listZohoSalespersons({ forceRefresh }),
        listClaimedZohoSalespersonIds(user.uid),
      ]);
      setOptions(rows);
      setClaimedBy(claimed);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Zoho salespersons.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!showPicker || !open || loaded || loading || !user) return;
    void loadOptions(false);
  }, [showPicker, open, loaded, loading, user, loadOptions]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        if (primary) {
          setEditing(false);
          setQuery('');
        }
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, primary]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const currentId = primary?.id ?? '';
    const available = options.filter(row => row.id === currentId || !claimedBy.has(row.id));
    const filtered = !q
      ? available
      : available.filter(row =>
        row.name.toLowerCase().includes(q)
        || row.id.toLowerCase().includes(q)
        || (row.email?.toLowerCase().includes(q) ?? false),
      );
    return filtered.slice(0, 40);
  }, [options, query, claimedBy, primary?.id]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  if (!user) {
    return <span className="text-muted">—</span>;
  }

  const pick = async (row: ZohoSalespersonOption) => {
    if (!user || saving) return;
    if (claimedBy.has(row.id) && row.id !== primary?.id) return;
    if (row.id === primary?.id) {
      setOpen(false);
      setEditing(false);
      setQuery('');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const next = await setSpareInchargeZohoSalesperson(user, {
        id: row.id,
        name: row.name,
      });
      onLinked(next);
      setOpen(false);
      setEditing(false);
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Zoho salesperson.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setEditing(true);
    setOpen(true);
    setQuery('');
    setError('');
  };

  if (primary && !editing) {
    return (
      <div className="hr-spare-incharge__zoho">
        <div className="hr-spare-incharge__zoho-current">
          <div className="hr-spare-incharge__zoho-text">
            <span className="hr-spare-incharge__zoho-name">{primary.name || primary.id}</span>
            {primary.name ? (
              <span className="hr-spare-incharge__zoho-id text-muted text-sm">{primary.id}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm hr-spare-incharge__zoho-edit"
            disabled={disabled || saving}
            onClick={startEdit}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hr-spare-incharge__zoho-associate" ref={rootRef}>
      {primary && editing ? (
        <p className="text-muted text-sm hr-spare-incharge__zoho-editing">
          Current: {primary.name || primary.id}
        </p>
      ) : null}
      <div className={`hr-spare-incharge__zoho-search${open ? ' is-open' : ''}`}>
        <Search size={14} aria-hidden className="hr-spare-incharge__zoho-search-icon" />
        <input
          type="search"
          className="input-field hr-spare-incharge__zoho-search-input"
          placeholder={primary ? 'Search to change salesperson…' : 'Link Zoho salesperson…'}
          value={query}
          disabled={disabled || saving}
          autoComplete="off"
          autoFocus={editing}
          aria-label={`${primary ? 'Change' : 'Link'} Zoho salesperson for ${user.displayName}`}
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setOpen(false);
              if (primary) {
                setEditing(false);
                setQuery('');
              }
              return;
            }
            if (!open || matches.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex(i => Math.min(i + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const row = matches[activeIndex];
              if (row) void pick(row);
            }
          }}
        />
        {(loading || saving) && (
          <Loader2 size={14} className="spin-icon hr-spare-incharge__zoho-spinner" aria-hidden />
        )}
        {primary && editing ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setOpen(false);
              setQuery('');
              setError('');
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {open && (
        <ul className="hr-spare-incharge__zoho-options" role="listbox">
          {loading && !loaded ? (
            <li className="hr-spare-incharge__option-empty text-sm">Loading…</li>
          ) : matches.length === 0 ? (
            <li className="hr-spare-incharge__option-empty text-sm">
              {query.trim() ? 'No matching salesperson.' : 'No available Zoho salesperson.'}
            </li>
          ) : (
            matches.map((row, index) => (
              <li key={row.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={[
                    'hr-spare-incharge__option',
                    index === activeIndex ? 'is-active' : '',
                    row.id === primary?.id ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void pick(row)}
                >
                  <span className="hr-spare-incharge__option-name">
                    {row.name}
                    {row.id === primary?.id ? ' (current)' : ''}
                  </span>
                  <span className="hr-spare-incharge__option-meta">{row.id}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {error ? <p className="text-sm text-red hr-spare-incharge__zoho-error">{error}</p> : null}
    </div>
  );
}

export const HrSpareInchargePage: React.FC<HrSpareInchargePageProps> = ({ basePath }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement>(null);

  const [members, setMembers] = useState<SpareInchargeMember[]>([]);
  const [eligible, setEligible] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const canManage = canManageSpareIncharge(user);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settings, users] = await Promise.all([
        loadSpareInchargeSettings(),
        listSpareInchargeEligibleUsers(),
      ]);
      setMembers(settings.members);
      setEligible(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load spare incharge assignments.');
      setMembers([]);
      setEligible([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void load();
  }, [canManage, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const assignedIds = useMemo(() => new Set(members.map(m => m.uid)), [members]);
  const currentIncharge = members[0] ?? null;
  const eligibleByUid = useMemo(() => {
    const map = new Map<string, UserRecord>();
    for (const row of eligible) map.set(row.uid, row);
    return map;
  }, [eligible]);

  const matches = useMemo(() => {
    return eligible
      .filter(row => !assignedIds.has(row.uid))
      .filter(row => matchesQuery(row, query))
      .slice(0, 12);
  }, [eligible, assignedIds, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open, assignedIds]);

  if (!canManage) {
    return <Navigate to={`${basePath}/hr/staff`} replace />;
  }

  const addMember = async (row: UserRecord) => {
    if (saving || assignedIds.has(row.uid)) return;
    if (currentIncharge) {
      const ok = await confirm({
        title: 'Replace spare incharge?',
        message:
          `${currentIncharge.displayName} is currently spare incharge. `
          + `Replace them with ${row.displayName}?`,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    try {
      const next = await addSpareInchargeMember(row, user?.uid ?? null);
      setMembers(next.members);
      setQuery('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign spare incharge.');
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: SpareInchargeMember) => {
    const ok = await confirm({
      title: 'Remove spare incharge',
      message: `Remove ${member.displayName} from spare incharge?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      const next = await removeSpareInchargeMember(member.uid, user?.uid ?? null);
      setMembers(next.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove spare incharge.');
    } finally {
      setSaving(false);
    }
  };

  const showOptions = open && !saving;

  return (
    <div className="page-content fade-in hr-spare-incharge-page">
      <div className="panel glass hr-spare-incharge">
        <div className="hr-spare-incharge__header">
          <div className="hr-spare-incharge__header-copy">
            <h3 className="hr-spare-incharge__title">
              <Wrench size={18} aria-hidden />
              Spare Incharge
            </h3>
            <p className="text-muted text-sm">
              Only one spare incharge at a time. Shows their primary Zoho salesperson,
              or lets you link one if missing.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm hr-spare-incharge__refresh"
            onClick={() => void load()}
            disabled={loading || saving}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="hr-spare-incharge__assign" ref={rootRef}>
          <label className="hr-spare-incharge__label" htmlFor="spare-incharge-search">
            {currentIncharge ? 'Replace spare incharge' : 'Assign spare incharge'}
          </label>
          <div className={`hr-spare-incharge__search${showOptions ? ' is-open' : ''}`}>
            <Search size={16} aria-hidden className="hr-spare-incharge__search-icon" />
            <input
              id="spare-incharge-search"
              type="search"
              className="input-field hr-spare-incharge__search-input"
              placeholder="Search staff or super admin by name, login, phone…"
              value={query}
              disabled={saving || loading}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showOptions}
              aria-controls="spare-incharge-options"
              onFocus={() => setOpen(true)}
              onChange={e => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={e => {
                if (!showOptions || matches.length === 0) {
                  if (e.key === 'Escape') setOpen(false);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex(i => Math.min(i + 1, matches.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex(i => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const row = matches[activeIndex];
                  if (row) void addMember(row);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
            {(loading || saving) && (
              <Loader2 size={16} className="spin-icon hr-spare-incharge__spinner" aria-hidden />
            )}
          </div>

          {showOptions && (
            <ul
              id="spare-incharge-options"
              className="hr-spare-incharge__options"
              role="listbox"
            >
              {matches.length === 0 ? (
                <li className="hr-spare-incharge__option-empty text-sm">
                  {query.trim()
                    ? 'No matching staff or super admin.'
                    : 'No eligible users to assign.'}
                </li>
              ) : (
                matches.map((row, index) => {
                  const zoho = primaryZohoSalespersonForUser(row);
                  return (
                    <li key={row.uid} role="option" aria-selected={index === activeIndex}>
                      <button
                        type="button"
                        className={[
                          'hr-spare-incharge__option',
                          index === activeIndex ? 'is-active' : '',
                          row.active ? '' : 'is-inactive',
                        ].filter(Boolean).join(' ')}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => void addMember(row)}
                      >
                        <span className="hr-spare-incharge__option-name">{row.displayName}</span>
                        <span className="hr-spare-incharge__option-meta">
                          {row.role === 'super_admin' || row.role === 'staff'
                            ? spareInchargeRoleLabel(row.role)
                            : row.role}
                          {row.loginId ? ` · ${row.loginId}` : ''}
                          {zoho ? ` · ${zoho.name || zoho.id}` : ' · No Zoho salesperson'}
                          {!row.active ? ' · Inactive' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red hr-spare-incharge__error">{error}</p>}

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : !currentIncharge ? (
          <p className="text-muted text-sm">No spare incharge assigned yet.</p>
        ) : (
          <div className="hr-spare-incharge__roster">
            <table className="data-table hr-spare-incharge__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login ID</th>
                  <th>Role</th>
                  <th>Zoho salesperson</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                <tr key={currentIncharge.uid}>
                  <td>
                    <span className="hr-spare-incharge__name">{currentIncharge.displayName}</span>
                  </td>
                  <td className="hr-spare-incharge__login">{currentIncharge.loginId || '—'}</td>
                  <td>
                    <span className="status-badge active">
                      {spareInchargeRoleLabel(currentIncharge.role)}
                    </span>
                  </td>
                  <td className="hr-spare-incharge__zoho-cell">
                    <SpareInchargeZohoCell
                      user={eligibleByUid.get(currentIncharge.uid) ?? null}
                      disabled={saving || loading}
                      onLinked={next => {
                        setEligible(prev => prev.map(row => (row.uid === next.uid ? next : row)));
                      }}
                    />
                  </td>
                  <td className="hr-spare-incharge__actions">
                    <button
                      type="button"
                      className="btn-icon text-red"
                      title="Remove"
                      aria-label={`Remove ${currentIncharge.displayName}`}
                      disabled={saving}
                      onClick={() => void removeMember(currentIncharge)}
                    >
                      <UserMinus size={16} />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
