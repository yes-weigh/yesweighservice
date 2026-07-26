import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import type { Kam } from '../../types/dealers';
import { effectivePermissionSet } from '../../lib/staffAccess';
import { findStaffRole, legacyDepartmentToRoleId } from '../../lib/staffRoles';
import {
  listZohoSalespersons,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';

export interface StaffRoleDraft {
  roleId: string | null;
  department: StaffDepartment;
  accessMode: StaffAccessMode;
  permissions: StaffPermission[];
  kamId: string | null;
  teamId: string | null;
  zohoSalespersonId: string | null;
  zohoSalespersonName: string | null;
}

export const EMPTY_STAFF_ROLE_DRAFT: StaffRoleDraft = {
  roleId: null,
  department: 'sales',
  accessMode: 'role',
  permissions: [],
  kamId: null,
  teamId: null,
  zohoSalespersonId: null,
  zohoSalespersonName: null,
};

export function staffRoleDraftFromRecord(
  input: {
    staffDepartment?: StaffDepartment;
    staffRoleId?: string | null;
    staffAccessMode?: StaffAccessMode;
    staffPermissions?: StaffPermission[];
    staffKamId?: string | null;
    staffTeamId?: string | null;
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
    kamId: input.staffKamId ?? null,
    teamId: input.staffTeamId ?? null,
    zohoSalespersonId: input.zohoSalespersonId?.trim() || null,
    zohoSalespersonName: input.zohoSalespersonName?.trim() || null,
  };
}

export function staffRoleDraftToPayload(draft: StaffRoleDraft): {
  staffRoleId: string | null;
  staffDepartment: StaffDepartment;
  staffAccessMode: StaffAccessMode;
  staffPermissions: StaffPermission[];
  staffKamId: string | null;
  staffTeamId: string | null;
  zohoSalespersonId: string | null;
  zohoSalespersonName: string | null;
} {
  const effective = effectivePermissionSet(draft.accessMode, draft.department, draft.permissions);
  const zohoId = draft.zohoSalespersonId?.trim() || null;
  return {
    staffRoleId: draft.accessMode === 'role' ? draft.roleId : draft.roleId,
    staffDepartment: draft.department,
    staffAccessMode: draft.accessMode,
    staffPermissions: effective,
    staffKamId: draft.department === 'sales' ? draft.kamId : null,
    staffTeamId: draft.teamId?.trim() || null,
    zohoSalespersonId: zohoId,
    zohoSalespersonName: zohoId
      ? (draft.zohoSalespersonName?.trim() || null)
      : null,
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

function ZohoSalespersonPicker({
  salespersonId,
  salespersonName,
  disabled,
  loadEnabled,
  onChange,
}: {
  salespersonId: string | null;
  salespersonName: string | null;
  disabled?: boolean;
  /** When true (Zoho details open), fetch the Zoho list. */
  loadEnabled?: boolean;
  onChange: (next: { zohoSalespersonId: string | null; zohoSalespersonName: string | null }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<ZohoSalespersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedLabel = salespersonName?.trim()
    || (salespersonId
      ? (options.find(o => o.id === salespersonId)?.name ?? salespersonId)
      : '');

  useEffect(() => {
    if (salespersonId) {
      setQuery(selectedLabel);
    } else {
      setQuery('');
    }
  }, [salespersonId, selectedLabel]);

  useEffect(() => {
    if (!loadEnabled || loaded || loading) return;
    let active = true;
    setLoading(true);
    setError('');
    void listZohoSalespersons()
      .then(rows => {
        if (!active) return;
        setOptions(rows);
        setLoaded(true);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load Zoho salespersons.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
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
    if (!q) return options.slice(0, 50);
    return options
      .filter(row =>
        row.name.toLowerCase().includes(q)
        || row.id.toLowerCase().includes(q)
        || (row.email?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const pick = (row: ZohoSalespersonOption) => {
    onChange({
      zohoSalespersonId: row.id,
      zohoSalespersonName: row.name,
    });
    setQuery(row.name);
    setOpen(false);
  };

  const clear = () => {
    onChange({ zohoSalespersonId: null, zohoSalespersonName: null });
    setQuery('');
    setOpen(false);
  };

  const showOptions = open && !disabled;

  return (
    <div className="staff-role-editor__zoho-picker" ref={rootRef}>
      <label className="staff-role-editor__field" htmlFor="staff-zoho-salesperson-search">
        <span>Zoho salesperson</span>
        <div className={`staff-role-editor__zoho-search${showOptions ? ' is-open' : ''}`}>
          <Search size={16} aria-hidden className="staff-role-editor__zoho-search-icon" />
          <input
            id="staff-zoho-salesperson-search"
            type="search"
            className="input-field staff-role-editor__zoho-search-input"
            placeholder={loading ? 'Loading salespersons…' : 'Search Zoho salesperson…'}
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
              const next = e.target.value;
              setQuery(next);
              setOpen(true);
              if (salespersonId && next !== selectedLabel) {
                onChange({ zohoSalespersonId: null, zohoSalespersonName: null });
              }
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
                if (row) pick(row);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {loading ? (
            <Loader2 size={16} className="spin-icon staff-role-editor__zoho-spinner" aria-hidden />
          ) : salespersonId ? (
            <button
              type="button"
              className="staff-role-editor__zoho-clear"
              disabled={disabled}
              aria-label="Clear Zoho salesperson"
              onClick={clear}
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
              Loading from Zoho…
            </li>
          ) : matches.length === 0 ? (
            <li className="staff-role-editor__zoho-option-empty text-muted text-sm">
              No salespersons match.
            </li>
          ) : (
            matches.map((row, index) => (
              <li key={row.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={[
                    'staff-role-editor__zoho-option',
                    index === activeIndex ? 'is-active' : '',
                    row.id === salespersonId ? 'is-selected' : '',
                    !row.active ? 'is-inactive' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(row)}
                >
                  <span className="staff-role-editor__zoho-option-name">{row.name}</span>
                  <span className="staff-role-editor__zoho-option-meta text-muted text-sm">
                    {[!row.active ? 'Inactive' : null, row.email].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {salespersonId ? (
        <p className="staff-role-editor__hint text-muted text-sm">
          Linked ID: {salespersonId}
        </p>
      ) : null}
    </div>
  );
}

interface StaffRoleEditorProps {
  value: StaffRoleDraft;
  onChange: (next: StaffRoleDraft) => void;
  roles: StaffRoleTemplate[];
  kams: Kam[];
  disabled?: boolean;
}

export const StaffRoleEditor: React.FC<StaffRoleEditorProps> = ({
  value,
  onChange,
  roles,
  kams,
  disabled,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(value.accessMode === 'custom');
  const [zohoDetailsOpen, setZohoDetailsOpen] = useState(Boolean(value.zohoSalespersonId));
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
      kamId: role.department === 'sales' ? value.kamId : null,
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

        {value.department === 'sales' && (
          <label className="staff-role-editor__field staff-role-editor__field--kam">
            <span>Key account manager</span>
            <select
              className="catalog-select"
              disabled={disabled}
              value={value.kamId ?? ''}
              onChange={e => onChange({ ...value, kamId: e.target.value || null })}
            >
              <option value="">All dealers</option>
              {kams.map(kam => (
                <option key={kam.id} value={kam.id}>{kam.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {selectedRole?.description && (
        <p className="staff-role-editor__hint text-muted text-sm">{selectedRole.description}</p>
      )}

      <details
        className="staff-role-editor__optional"
        open={zohoDetailsOpen}
        onToggle={event => {
          setZohoDetailsOpen(event.currentTarget.open);
        }}
      >
        <summary>Zoho salesperson (KAM on SO / invoice)</summary>
        <ZohoSalespersonPicker
          salespersonId={value.zohoSalespersonId}
          salespersonName={value.zohoSalespersonName}
          disabled={disabled}
          loadEnabled={zohoDetailsOpen}
          onChange={next => onChange({ ...value, ...next })}
        />
        <p className="staff-role-editor__hint text-muted text-sm">
          Search and select a Zoho salesperson so sales orders and invoices show this staff member as KAM.
        </p>
      </details>

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
