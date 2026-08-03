import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2, Search, Sparkles, X } from 'lucide-react';
import {
  ALL_STAFF_PERMISSIONS,
  DEPARTMENT_DEFAULT_PERMISSIONS,
  STAFF_DEPARTMENT_LABELS,
  STAFF_PERMISSION_GROUPS,
  STAFF_PERMISSION_LABELS,
  type StaffAccessMode,
  type StaffDepartment,
  type StaffPermission,
} from '../../types/staff-access';
import type { StaffRoleTemplate } from '../../types/staff-role';
import { effectivePermissionSet } from '../../lib/staffAccess';
import { findStaffRole, legacyDepartmentToRoleId } from '../../lib/staffRoles';
import {
  clearZohoSalespersonsCache,
  listZohoSalespersons,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import {
  listClaimedZohoSalespersonIds,
  normalizeZohoSalespersonLinks,
  zohoLinksToFirestoreFields,
  type ZohoSalespersonLink,
} from '../../lib/zohoSalespersonStaff';

export interface StaffRoleDraft {
  roleId: string | null;
  department: StaffDepartment;
  accessMode: StaffAccessMode;
  permissions: StaffPermission[];
  teamId: string | null;
  zohoSalespersonLinks: ZohoSalespersonLink[];
}

export const EMPTY_STAFF_ROLE_DRAFT: StaffRoleDraft = {
  roleId: null,
  department: 'sales',
  accessMode: 'role',
  permissions: [],
  teamId: null,
  zohoSalespersonLinks: [],
};

export function staffRoleDraftFromRecord(
  input: {
    staffDepartment?: StaffDepartment;
    staffRoleId?: string | null;
    staffAccessMode?: StaffAccessMode;
    staffPermissions?: StaffPermission[];
    staffTeamId?: string | null;
    zohoSalespersonLinks?: ZohoSalespersonLink[] | null;
    zohoSalespersonIds?: string[] | null;
    zohoSalespersonId?: string | null;
    zohoSalespersonName?: string | null;
  },
  roles: StaffRoleTemplate[],
): StaffRoleDraft {
  const accessMode = input.staffAccessMode ?? 'role';
  const legacyDept = input.staffDepartment ?? 'admin';
  const roleId = input.staffRoleId
    ?? (accessMode === 'department' ? legacyDepartmentToRoleId(legacyDept) : null);
  const role = findStaffRole(roles, roleId);
  const department = role?.department ?? legacyDept;

  let permissions = input.staffPermissions ?? [];
  if (accessMode === 'custom' && permissions.length > 0) {
    // keep custom snapshot
  } else if (role) {
    permissions = role.permissions;
  } else {
    permissions = DEPARTMENT_DEFAULT_PERMISSIONS[department];
  }

  return {
    roleId: role?.id ?? roleId,
    department,
    accessMode: accessMode === 'custom' ? 'custom' : 'role',
    permissions,
    teamId: input.staffTeamId ?? null,
    zohoSalespersonLinks: normalizeZohoSalespersonLinks(input),
  };
}

export function staffRoleDraftToPayload(draft: StaffRoleDraft): {
  staffRoleId: string | null;
  staffDepartment: StaffDepartment;
  staffAccessMode: StaffAccessMode;
  staffPermissions: StaffPermission[];
  staffTeamId: string | null;
  zohoSalespersonIds: string[];
  zohoSalespersonLinks: ZohoSalespersonLink[];
  zohoSalespersonId: string | null;
  zohoSalespersonName: string | null;
} {
  const effective = effectivePermissionSet(draft.accessMode, draft.department, draft.permissions);
  const zohoFields = zohoLinksToFirestoreFields(draft.zohoSalespersonLinks);
  return {
    staffRoleId: draft.accessMode === 'role' ? draft.roleId : draft.roleId,
    staffDepartment: draft.department,
    staffAccessMode: draft.accessMode,
    staffPermissions: effective,
    staffTeamId: draft.teamId?.trim() || null,
    ...zohoFields,
  };
}

type StaffRolePermissionsPanelProps = {
  permissions: StaffPermission[];
  defaultPermissions?: StaffPermission[];
  onChange: (permissions: StaffPermission[]) => void;
  disabled?: boolean;
};

export const StaffRolePermissionsPanel: React.FC<StaffRolePermissionsPanelProps> = ({
  permissions,
  defaultPermissions = [],
  onChange,
  disabled,
}) => {
  const defaultSet = useMemo(() => new Set(defaultPermissions), [defaultPermissions]);

  const togglePermission = (permission: StaffPermission) => {
    const next = new Set(permissions);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange(ALL_STAFF_PERMISSIONS.filter(item => next.has(item)));
  };

  return (
    <div className="staff-role-editor__groups">
      {STAFF_PERMISSION_GROUPS.map(group => (
        <div key={group.id} className="staff-role-editor__group panel glass">
          <h5>{group.label}</h5>
          <ul className="staff-role-editor__perm-list">
            {group.permissions.map(permission => {
              const on = permissions.includes(permission);
              const isDefault = defaultSet.has(permission);
              return (
                <li key={permission}>
                  <button
                    type="button"
                    disabled={disabled}
                    className={`staff-role-editor__perm ${on ? 'is-on' : ''} ${isDefault ? 'is-default' : ''}`}
                    onClick={() => togglePermission(permission)}
                  >
                    <span className="staff-role-editor__perm-check" aria-hidden />
                    <span className="staff-role-editor__perm-label">
                      {STAFF_PERMISSION_LABELS[permission]}
                    </span>
                    {isDefault && on && (
                      <span className="staff-role-editor__perm-badge">Default</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};

export function ZohoSalespersonPicker({
  links,
  disabled,
  loadEnabled,
  excludeUid,
  onChange,
}: {
  links: ZohoSalespersonLink[];
  disabled?: boolean;
  /** When true (Zoho details open), fetch the Zoho list. */
  loadEnabled?: boolean;
  /** Staff uid being edited — their own links stay selectable. */
  excludeUid?: string | null;
  onChange: (next: ZohoSalespersonLink[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<ZohoSalespersonOption[]>([]);
  const [claimedBy, setClaimedBy] = useState<Map<string, { uid: string; displayName: string }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedIds = useMemo(
    () => new Set(links.map(link => link.id)),
    [links],
  );

  const loadOptions = async (forceRefresh = false) => {
    setLoading(true);
    if (forceRefresh) setSyncing(true);
    setError('');
    try {
      if (forceRefresh) clearZohoSalespersonsCache();
      const [rows, claimed] = await Promise.all([
        listZohoSalespersons({ forceRefresh, includeHidden: false }),
        listClaimedZohoSalespersonIds(excludeUid),
      ]);
      setOptions(rows);
      setClaimedBy(claimed);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Zoho salespersons.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!loadEnabled || loaded || loading) return;
    void loadOptions(false);
    // Intentionally only when the Zoho section opens / first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEnabled, loaded, loading]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = options.filter(row => !selectedIds.has(row.id));
    const filtered = !q
      ? available
      : available.filter(row =>
        row.name.toLowerCase().includes(q)
        || row.id.toLowerCase().includes(q)
        || (row.email?.toLowerCase().includes(q) ?? false),
      );
    const unlinked = filtered.filter(row => !claimedBy.has(row.id));
    const linked = filtered.filter(row => claimedBy.has(row.id));
    // Unlinked first so HR creates/links staff before dealer backfill.
    return [...unlinked, ...linked].slice(0, 50);
  }, [options, query, selectedIds, claimedBy]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open, selectedIds]);

  const add = (row: ZohoSalespersonOption) => {
    if (selectedIds.has(row.id)) return;
    if (claimedBy.has(row.id)) return;
    onChange([...links, { id: row.id, name: row.name }]);
    setQuery('');
    setOpen(true);
  };

  const remove = (id: string) => {
    onChange(links.filter(link => link.id !== id));
  };

  const clearAll = () => {
    onChange([]);
    setQuery('');
    setOpen(false);
  };

  const showOptions = open && !disabled;
  const unlinkedCount = options.filter(row => !selectedIds.has(row.id) && !claimedBy.has(row.id)).length;

  return (
    <div className="staff-role-editor__zoho-picker" ref={rootRef}>
      {links.length > 0 ? (
        <ul className="staff-role-editor__zoho-chips" aria-label="Linked Zoho salespersons">
          {links.map(link => (
            <li key={link.id} className="staff-role-editor__zoho-chip">
              <span className="staff-role-editor__zoho-chip-name">
                {link.name || link.id}
              </span>
              <button
                type="button"
                className="staff-role-editor__zoho-chip-remove"
                disabled={disabled}
                aria-label={`Remove ${link.name || link.id}`}
                onClick={() => remove(link.id)}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="staff-role-editor__field" htmlFor="staff-zoho-salesperson-search">
        <span>{links.length ? 'Add another Zoho salesperson' : 'Zoho salesperson'}</span>
        <div className={`staff-role-editor__zoho-search${showOptions ? ' is-open' : ''}`}>
          <Search size={16} aria-hidden className="staff-role-editor__zoho-search-icon" />
          <input
            id="staff-zoho-salesperson-search"
            type="search"
            className="input-field staff-role-editor__zoho-search-input"
            placeholder={
              syncing
                ? 'Syncing from Zoho…'
                : loading
                  ? 'Loading salespersons…'
                  : 'Search unlinked first…'
            }
            value={query}
            disabled={disabled}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showOptions}
            aria-controls="staff-zoho-salesperson-options"
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
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
                if (row && !claimedBy.has(row.id)) add(row);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {loading ? (
            <Loader2 size={16} className="spin-icon staff-role-editor__zoho-spinner" aria-hidden />
          ) : links.length > 0 ? (
            <button
              type="button"
              className="staff-role-editor__zoho-clear"
              disabled={disabled}
              aria-label="Clear all Zoho salespersons"
              onClick={clearAll}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      </label>

      {showOptions && (
        <ul
          id="staff-zoho-salesperson-options"
          className="staff-role-editor__zoho-options"
          role="listbox"
        >
          {error ? (
            <li className="staff-role-editor__zoho-option-empty text-sm">{error}</li>
          ) : loading && !loaded ? (
            <li className="staff-role-editor__zoho-option-empty text-muted text-sm">
              {syncing ? 'First sync from Zoho…' : 'Loading…'}
            </li>
          ) : matches.length === 0 ? (
            <li className="staff-role-editor__zoho-option-empty text-muted text-sm">
              {selectedIds.size && !query.trim()
                ? 'All matching salespersons already linked.'
                : 'No salespersons match.'}
            </li>
          ) : (
            matches.map((row, index) => {
              const claimed = claimedBy.get(row.id);
              return (
                <li key={row.id} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    disabled={Boolean(claimed)}
                    className={[
                      'staff-role-editor__zoho-option',
                      index === activeIndex ? 'is-active' : '',
                      !row.active ? 'is-inactive' : '',
                      claimed ? 'is-claimed' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => add(row)}
                  >
                    <span className="staff-role-editor__zoho-option-name">
                      {!claimed ? (
                        <span className="staff-role-editor__zoho-option-badge">Unlinked</span>
                      ) : null}
                      {row.name}
                    </span>
                    <span className="staff-role-editor__zoho-option-meta text-muted text-sm">
                      {[
                        claimed ? `Linked to ${claimed.displayName}` : null,
                        !row.active ? 'Inactive' : null,
                        row.email,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

      <div className="staff-role-editor__zoho-footer">
        <p className="staff-role-editor__hint text-muted text-sm">
          {links.length
            ? `${links.length} linked`
            : loaded
              ? `${unlinkedCount} unlinked · ${options.length} total`
              : 'List loads from Firestore cache'}
        </p>
        <button
          type="button"
          className="staff-role-editor__zoho-refresh"
          disabled={disabled || loading || syncing}
          onClick={() => void loadOptions(true)}
        >
          {syncing ? 'Refreshing…' : 'Refresh from Zoho'}
        </button>
      </div>
    </div>
  );
}

interface StaffRoleEditorProps {
  value: StaffRoleDraft;
  onChange: (next: StaffRoleDraft) => void;
  roles: StaffRoleTemplate[];
  /** Staff uid being edited (keeps their Zoho links selectable). */
  excludeUid?: string | null;
  /** Deep link to Dealers → Salespersons (Zoho link/unlink hub). */
  zohoManageHref?: string | null;
  disabled?: boolean;
}

export const StaffRoleEditor: React.FC<StaffRoleEditorProps> = ({
  value,
  onChange,
  roles,
  excludeUid: _excludeUid,
  zohoManageHref,
  disabled,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(value.accessMode === 'custom');
  const selectedRole = findStaffRole(roles, value.roleId);

  const effectivePermissions = useMemo(
    () => effectivePermissionSet(value.accessMode, value.department, value.permissions),
    [value.accessMode, value.department, value.permissions],
  );

  const selectRole = (roleId: string) => {
    const role = findStaffRole(roles, roleId);
    if (!role) return;
    onChange({
      ...value,
      roleId: role.id,
      department: role.department,
      accessMode: 'role',
      permissions: role.permissions,
    });
    setAdvancedOpen(false);
  };

  const enableCustom = (enabled: boolean) => {
    setAdvancedOpen(enabled);
    if (enabled) {
      onChange({
        ...value,
        accessMode: 'custom',
        permissions: effectivePermissions,
      });
      return;
    }
    if (selectedRole) {
      onChange({
        ...value,
        accessMode: 'role',
        permissions: selectedRole.permissions,
      });
    }
  };

  return (
    <div className="staff-role-editor">
      <div className="staff-role-editor__section staff-role-editor__role-row">
        <label className="staff-role-editor__field staff-role-editor__field--role">
          <span>Job role</span>
          <select
            className="catalog-select staff-role-editor__role-select"
            disabled={disabled || roles.length === 0}
            value={value.roleId ?? ''}
            onChange={e => selectRole(e.target.value)}
            required
          >
            <option value="" disabled>Select a role…</option>
            {roles.map(role => (
              <option key={role.id} value={role.id}>
                {role.name}
                {role.isSystem ? '' : ' (custom)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedRole?.description && (
        <p className="staff-role-editor__hint text-muted text-sm">{selectedRole.description}</p>
      )}

      <div className="staff-role-editor__section staff-role-editor__zoho-readonly">
        <span className="staff-role-editor__label">Zoho salesperson</span>
        {value.zohoSalespersonLinks.length > 0 ? (
          <ul className="staff-role-editor__zoho-chips" aria-label="Linked Zoho salespersons">
            {value.zohoSalespersonLinks.map(link => (
              <li key={link.id} className="staff-role-editor__zoho-chip">
                {link.name || link.id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-role-editor__hint text-muted text-sm">Not linked</p>
        )}
        <p className="staff-role-editor__hint text-muted text-sm">
          Link or unlink Zoho salespersons in{' '}
          {zohoManageHref ? (
            <Link to={zohoManageHref}>Dealers → Salespersons</Link>
          ) : (
            'Dealers → Salespersons'
          )}
          .
        </p>
      </div>

      <details className="staff-role-editor__optional">
        <summary>Optional fields</summary>
        <label className="staff-role-editor__field">
          <span>Team ID</span>
          <input
            className="input-field staff-role-editor__team-input"
            disabled={disabled}
            placeholder="e.g. service-workshop"
            value={value.teamId ?? ''}
            onChange={e => onChange({ ...value, teamId: e.target.value || null })}
          />
        </label>
      </details>

      <div className="staff-role-editor__section staff-role-editor__advanced">
        <button
          type="button"
          className="staff-role-editor__advanced-toggle"
          onClick={() => enableCustom(!advancedOpen)}
          disabled={disabled || !value.roleId}
        >
          <ChevronDown size={16} className={advancedOpen ? 'is-open' : ''} aria-hidden />
          Custom access
          {value.accessMode === 'custom' && (
            <span className="staff-role-editor__advanced-badge">Active</span>
          )}
        </button>
        {advancedOpen && (
          <div className="staff-role-editor__advanced-body">
            <p className="staff-role-editor__hint text-muted text-sm">
              Override permissions for this person only. Most staff should use the role above.
            </p>
            <StaffRolePermissionsPanel
              permissions={effectivePermissions}
              defaultPermissions={selectedRole?.permissions ?? []}
              disabled={disabled}
              onChange={perms => onChange({
                ...value,
                accessMode: 'custom',
                permissions: perms,
              })}
            />
            {value.accessMode === 'custom' && selectedRole && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() => enableCustom(false)}
              >
                Reset to role defaults
              </button>
            )}
          </div>
        )}
      </div>

      <div className="staff-role-editor__preview panel glass">
        <Sparkles size={16} aria-hidden />
        <span>
          {selectedRole ? (
            <>
              Role: <strong>{selectedRole.name}</strong>
              {' · '}
              {STAFF_DEPARTMENT_LABELS[value.department]}
            </>
          ) : (
            'Select a role'
          )}
          {' · '}
          {effectivePermissions.length}/{ALL_STAFF_PERMISSIONS.length} permissions
        </span>
      </div>
    </div>
  );
};
