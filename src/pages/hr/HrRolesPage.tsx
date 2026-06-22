import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { StaffRolePermissionsPanel } from '../../components/admin/StaffRoleEditor';
import { canManageStaffRolesInHr } from '../../lib/staffAccess';
import {
  createStaffRole,
  deleteStaffRole,
  fetchStaffRoles,
  updateStaffRole,
} from '../../lib/staffRoles';
import {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  type StaffDepartment,
  type StaffPermission,
} from '../../types/staff-access';
import type { StaffRoleTemplate } from '../../types/staff-role';

const EMPTY_FORM = {
  name: '',
  description: '',
  department: 'sales' as StaffDepartment,
  permissions: [] as StaffPermission[],
};

export const HrRolesPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<StaffRoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoles(await fetchStaffRoles(true));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError('');
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (role: StaffRoleTemplate) => {
    setForm({
      name: role.name,
      description: role.description ?? '',
      department: role.department,
      permissions: [...role.permissions],
    });
    setEditingId(role.id);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) {
      setError('Role name is required.');
      return;
    }
    if (form.permissions.length === 0) {
      setError('Select at least one permission.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      if (editingId) {
        await updateStaffRole(editingId, {
          name: form.name,
          description: form.description,
          department: form.department,
          permissions: form.permissions,
        });
      } else {
        await createStaffRole({
          name: form.name,
          description: form.description,
          department: form.department,
          permissions: form.permissions,
          createdByUid: user.uid,
        });
      }
      resetForm();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (role: StaffRoleTemplate) => {
    if (role.isSystem) return;
    const ok = await confirm({
      title: 'Delete role',
      message: `Delete "${role.name}"? Staff already assigned keep their current access until edited.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteStaffRole(role.id, role.isSystem);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (!canManageStaffRolesInHr(user)) {
    return (
      <div className="panel glass">
        <p className="text-muted">Only super admins can manage staff roles.</p>
      </div>
    );
  }

  return (
    <div className="hr-roles-page">
      <div className="hr-roles-page__toolbar panel glass">
        <p className="text-muted text-sm">
          Role templates used when adding staff. System roles cannot be deleted.
        </p>
        <div className="hr-roles-page__actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={15} />
            New role
          </button>
        </div>
      </div>

      {error && !showForm && <div className="login-error panel glass">{error}</div>}

      {showForm && (
        <InlineFormPanel
          title={editingId ? 'Edit role' : 'New role'}
          onClose={resetForm}
        >
          <form onSubmit={handleSubmit} className="hr-roles-page__form">
            {error && <div className="login-error">{error}</div>}
            <label className="staff-role-editor__field">
              <span>Role name</span>
              <input
                className="input-field"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="staff-role-editor__field">
              <span>Description</span>
              <input
                className="input-field"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Short summary for HR"
              />
            </label>
            <label className="staff-role-editor__field">
              <span>Department tag</span>
              <select
                className="catalog-select"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value as StaffDepartment }))}
              >
                {STAFF_DEPARTMENTS.map(dept => (
                  <option key={dept} value={dept}>{STAFF_DEPARTMENT_LABELS[dept]}</option>
                ))}
              </select>
            </label>
            <StaffRolePermissionsPanel
              permissions={form.permissions}
              onChange={permissions => setForm(f => ({ ...f, permissions }))}
              disabled={submitting}
            />
            <div className="hr-roles-page__form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={submitting}>
                <X size={15} />
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <Save size={15} />
                {submitting ? 'Saving…' : 'Save role'}
              </button>
            </div>
          </form>
        </InlineFormPanel>
      )}

      <div className="hr-roles-page__grid">
        {loading && roles.length === 0 ? (
          <p className="text-muted text-sm">Loading roles…</p>
        ) : (
          roles.map(role => (
            <article key={role.id} className="hr-roles-page__card panel glass">
              <div className="hr-roles-page__card-head">
                <div>
                  <strong>{role.name}</strong>
                  {role.isSystem && (
                    <span className="hr-roles-page__badge">System</span>
                  )}
                </div>
                <span className="text-muted text-sm">{STAFF_DEPARTMENT_LABELS[role.department]}</span>
              </div>
              {role.description && (
                <p className="text-sm text-muted">{role.description}</p>
              )}
              <p className="text-sm text-muted">{role.permissions.length} permissions</p>
              <div className="hr-roles-page__card-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(role)}>
                  <Pencil size={14} />
                  Edit
                </button>
                {!role.isSystem && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleDelete(role)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
};
