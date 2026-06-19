import React, { useMemo } from 'react';
import {
  Briefcase,
  Headphones,
  Shield,
  Truck,
  Sparkles,
} from 'lucide-react';
import {
  ALL_STAFF_PERMISSIONS,
  DEPARTMENT_DEFAULT_PERMISSIONS,
  STAFF_DEPARTMENT_DESCRIPTIONS,
  STAFF_DEPARTMENT_LABELS,
  STAFF_PERMISSION_GROUPS,
  STAFF_PERMISSION_LABELS,
  type StaffAccessMode,
  type StaffDepartment,
  type StaffPermission,
} from '../../types/staff-access';
import type { Kam } from '../../types/dealers';
import { effectivePermissionSet } from '../../lib/staffAccess';

export interface StaffRoleDraft {
  department: StaffDepartment;
  accessMode: StaffAccessMode;
  permissions: StaffPermission[];
  kamId: string | null;
  teamId: string | null;
}

export const EMPTY_STAFF_ROLE_DRAFT: StaffRoleDraft = {
  department: 'sales',
  accessMode: 'department',
  permissions: [],
  kamId: null,
  teamId: null,
};

const DEPARTMENT_ICONS: Record<StaffDepartment, React.ReactNode> = {
  sales: <Briefcase size={22} aria-hidden />,
  service: <Headphones size={22} aria-hidden />,
  logistics: <Truck size={22} aria-hidden />,
  admin: <Shield size={22} aria-hidden />,
};

const DEPARTMENT_TONES: Record<StaffDepartment, string> = {
  sales: 'blue',
  service: 'green',
  logistics: 'orange',
  admin: 'purple',
};

export function staffRoleDraftFromRecord(input: {
  staffDepartment?: StaffDepartment;
  staffAccessMode?: StaffAccessMode;
  staffPermissions?: StaffPermission[];
  staffKamId?: string | null;
  staffTeamId?: string | null;
}): StaffRoleDraft {
  const department = input.staffDepartment ?? 'admin';
  const accessMode = input.staffAccessMode ?? 'department';
  const permissions = accessMode === 'custom' && input.staffPermissions?.length
    ? input.staffPermissions
    : DEPARTMENT_DEFAULT_PERMISSIONS[department];

  return {
    department,
    accessMode,
    permissions,
    kamId: input.staffKamId ?? null,
    teamId: input.staffTeamId ?? null,
  };
}

export function staffRoleDraftToPayload(draft: StaffRoleDraft): {
  staffDepartment: StaffDepartment;
  staffAccessMode: StaffAccessMode;
  staffPermissions: StaffPermission[];
  staffKamId: string | null;
  staffTeamId: string | null;
} {
  const effective = effectivePermissionSet(draft.department, draft.accessMode, draft.permissions);
  return {
    staffDepartment: draft.department,
    staffAccessMode: draft.accessMode,
    staffPermissions: draft.accessMode === 'custom' ? effective : [],
    staffKamId: draft.department === 'sales' ? draft.kamId : null,
    staffTeamId: draft.teamId?.trim() || null,
  };
}

interface StaffRoleEditorProps {
  value: StaffRoleDraft;
  onChange: (next: StaffRoleDraft) => void;
  kams: Kam[];
  disabled?: boolean;
}

export const StaffRoleEditor: React.FC<StaffRoleEditorProps> = ({
  value,
  onChange,
  kams,
  disabled,
}) => {
  const effectivePermissions = useMemo(
    () => effectivePermissionSet(value.department, value.accessMode, value.permissions),
    [value.accessMode, value.department, value.permissions],
  );

  const defaultSet = useMemo(
    () => new Set(DEPARTMENT_DEFAULT_PERMISSIONS[value.department]),
    [value.department],
  );

  const setDepartment = (department: StaffDepartment) => {
    const nextDefaults = DEPARTMENT_DEFAULT_PERMISSIONS[department];
    onChange({
      ...value,
      department,
      accessMode: 'department',
      permissions: nextDefaults,
      kamId: department === 'sales' ? value.kamId : null,
    });
  };

  const enableCustomize = (enabled: boolean) => {
    if (enabled) {
      onChange({
        ...value,
        accessMode: 'custom',
        permissions: effectivePermissions,
      });
      return;
    }
    onChange({
      ...value,
      accessMode: 'department',
      permissions: DEPARTMENT_DEFAULT_PERMISSIONS[value.department],
    });
  };

  const togglePermission = (permission: StaffPermission) => {
    const next = new Set(effectivePermissions);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange({
      ...value,
      accessMode: 'custom',
      permissions: ALL_STAFF_PERMISSIONS.filter(item => next.has(item)),
    });
  };

  const customize = value.accessMode === 'custom';

  return (
    <div className="staff-role-editor">
      <div className="staff-role-editor__section">
        <h4 className="staff-role-editor__heading">Department</h4>
        <p className="staff-role-editor__hint text-muted text-sm">
          Sets the default menu and access for this employee.
        </p>
        <div className="staff-role-editor__departments">
          {(['sales', 'service', 'logistics', 'admin'] as StaffDepartment[]).map(department => (
            <button
              key={department}
              type="button"
              disabled={disabled}
              className={`staff-role-editor__dept staff-role-editor__dept--${DEPARTMENT_TONES[department]} ${value.department === department ? 'is-active' : ''}`}
              onClick={() => setDepartment(department)}
            >
              <span className="staff-role-editor__dept-icon">{DEPARTMENT_ICONS[department]}</span>
              <span className="staff-role-editor__dept-label">{STAFF_DEPARTMENT_LABELS[department]}</span>
              <span className="staff-role-editor__dept-desc">{STAFF_DEPARTMENT_DESCRIPTIONS[department]}</span>
            </button>
          ))}
        </div>
      </div>

      {value.department === 'sales' && (
        <div className="staff-role-editor__section">
          <label className="staff-role-editor__field">
            <span>Key account manager (KAM)</span>
            <select
              className="catalog-select"
              disabled={disabled}
              value={value.kamId ?? ''}
              onChange={e => onChange({ ...value, kamId: e.target.value || null })}
            >
              <option value="">All dealers (no KAM filter)</option>
              {kams.map(kam => (
                <option key={kam.id} value={kam.id}>{kam.name}</option>
              ))}
            </select>
          </label>
          <p className="staff-role-editor__hint text-muted text-sm">
            When set, this person only sees dealers assigned to this KAM.
          </p>
        </div>
      )}

      <div className="staff-role-editor__section">
        <label className="staff-role-editor__field">
          <span>Team ID (optional)</span>
          <input
            className="input-field"
            disabled={disabled}
            placeholder="e.g. service-workshop"
            value={value.teamId ?? ''}
            onChange={e => onChange({ ...value, teamId: e.target.value || null })}
          />
        </label>
      </div>

      <div className="staff-role-editor__section">
        <div className="staff-role-editor__perm-head">
          <div>
            <h4 className="staff-role-editor__heading">Permissions</h4>
            <p className="staff-role-editor__hint text-muted text-sm">
              {effectivePermissions.length} active
              {!customize && ` · using ${STAFF_DEPARTMENT_LABELS[value.department]} defaults`}
            </p>
          </div>
          <label className="staff-role-editor__customize">
            <input
              type="checkbox"
              checked={customize}
              disabled={disabled}
              onChange={e => enableCustomize(e.target.checked)}
            />
            Customize
          </label>
        </div>

        {!customize ? (
          <div className="staff-role-editor__chips">
            {effectivePermissions.map(permission => (
              <span key={permission} className="staff-role-editor__chip">
                {STAFF_PERMISSION_LABELS[permission]}
              </span>
            ))}
          </div>
        ) : (
          <div className="staff-role-editor__groups">
            {STAFF_PERMISSION_GROUPS.map(group => (
              <div key={group.id} className="staff-role-editor__group panel glass">
                <h5>{group.label}</h5>
                <ul className="staff-role-editor__perm-list">
                  {group.permissions.map(permission => {
                    const on = effectivePermissions.includes(permission);
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
        )}
      </div>

      <div className="staff-role-editor__preview panel glass">
        <Sparkles size={16} aria-hidden />
        <span>
          Effective access: <strong>{STAFF_DEPARTMENT_LABELS[value.department]}</strong>
          {' · '}
          {effectivePermissions.length}/{ALL_STAFF_PERMISSIONS.length} permissions
        </span>
      </div>
    </div>
  );
};
