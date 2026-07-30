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
  removeSpareInchargeMember,
  spareInchargeRoleLabel,
  type SpareInchargeMember,
} from '../../lib/spareIncharge';
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
    <div className="page-content fade-in">
      <div className="panel glass panel--table">
        <div className="panel-header">
          <div>
            <h3 className="hr-spare-incharge__title">
              <Wrench size={18} aria-hidden />
              Spare Incharge
            </h3>
            <p className="text-muted text-sm">
              Assign staff or super admins as spare incharge. Dealers cannot be assigned.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
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
            Assign user
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
                    : 'No more eligible users to assign.'}
                </li>
              ) : (
                matches.map((row, index) => (
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
                        {!row.active ? ' · Inactive' : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red hr-spare-incharge__error">{error}</p>}

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-muted text-sm">No spare incharge assigned yet.</p>
        ) : (
          <div className="table-scroll-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login ID</th>
                  <th>Role</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {members.map(member => (
                  <tr key={member.uid}>
                    <td>{member.displayName}</td>
                    <td>{member.loginId || '—'}</td>
                    <td>
                      <span className="status-badge active">
                        {spareInchargeRoleLabel(member.role)}
                      </span>
                    </td>
                    <td className="hr-spare-incharge__actions">
                      <button
                        type="button"
                        className="btn-icon text-red"
                        title="Remove"
                        aria-label={`Remove ${member.displayName}`}
                        disabled={saving}
                        onClick={() => void removeMember(member)}
                      >
                        <UserMinus size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
