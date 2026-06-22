import React, { useMemo, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
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

export interface StaffRoleDraft {
  roleId: string | null;
  department: StaffDepartment;
  accessMode: StaffAccessMode;
  permissions: StaffPermission[];
  kamId: string | null;
  teamId: string | null;
}

export const EMPTY_STAFF_ROLE_DRAFT: StaffRoleDraft = {
  roleId: null,
  department: 'sales',
  accessMode: 'role',
  permissions: [],
  kamId: null,
  teamId: null,
};

export function staffRoleDraftFromRecord(
  input: {
    staffDepartment?: StaffDepartment;
    staffRoleId?: string | null;
    staffAccessMode?: StaffAccessMode;
    staffPermissions?: StaffPermission[];
    staffKamId?: string | null;
    staffTeamId?: string | null;
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
  };
}

export function staffRoleDraftToPayload(draft: StaffRoleDraft): {
  staffRoleId: string | null;
  staffDepartment: StaffDepartment;
  staffAccessMode: StaffAccessMode;
  staffPermissions: StaffPermission[];
  staffKamId: string | null;
  staffTeamId: string | null;
} {
  const effective = effectivePermissionSet(draft.accessMode, draft.department, draft.permissions);
  return {
    staffRoleId: draft.accessMode === 'role' ? draft.roleId : draft.roleId,
    staffDepartment: draft.department,
    staffAccessMode: draft.accessMode,
    staffPermissions: effective,
    staffKamId: draft.department === 'sales' ? draft.kamId : null,
    staffTeamId: draft.teamId?.trim() || null,
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
