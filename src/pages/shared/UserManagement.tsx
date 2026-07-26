import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Shield, Trash2, Save, UserX } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  deactivateUser,
  deleteUserPermanently,
  registerUser,
  setManagedUserPassword,
  updateUserProfile,
} from '../../lib/userAdmin';
import type { FirestoreUserDoc, Role, SuperAdminAccess, UserRecord } from '../../types';
import {
  ROLE_LABELS,
  SUPER_ADMIN_ACCESS_LABELS,
  canManageRole,
  normalizeRole,
  normalizeSuperAdminAccess,
  readDealerId,
} from '../../types';
import { canManageWarehouseUsers, canSuperAdminWrite } from '../../lib/staffAccess';
import { isLocalhostDev } from '../../lib/isLocalhost';
import {
  formatLoginIdDisplay,
  loginIdTypeLabel,
  parseLoginId,
} from '../../lib/loginAuth';
import { resolveProfileLogin } from '../../lib/profileLogin';
import {
  DealerRoleEditor,
  EMPTY_DEALER_ROLE_DRAFT,
  dealerRoleDraftFromRecord,
  dealerRoleDraftToPayload,
  type DealerRoleDraft,
} from '../../components/admin/DealerRoleEditor';
import { DEALER_TIER_LABELS } from '../../types';

const EMPTY_FORM = {
  loginId: '',
  password: '',
  displayName: '',
  phone: '',
  email: '',
  dealerId: '',
  superAdminAccess: 'full' as SuperAdminAccess,
};

type UserManagementProps = {
  role: Role;
  title: string;
  description: string;
  /** When set, only list/create users under this dealer (dealer portal). */
  scopedDealerId?: string;
  showDealerPicker?: boolean;
  /** Prefer short User IDs for warehouse/media roles (UI: Stock auditor / Media). */
  preferUsernameLogin?: boolean;
};

function displayLoginForRecord(record: UserRecord): { label: string; value: string } {
  const login = resolveProfileLogin(record);
  if (!login) return { label: '—', value: '—' };
  return {
    label: loginIdTypeLabel(login.type),
    value: formatLoginIdDisplay(login.type, login.value),
  };
}

export const UserManagement: React.FC<UserManagementProps> = ({
  role,
  title,
  description,
  scopedDealerId,
  showDealerPicker = false,
  preferUsernameLogin = false,
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [dealers, setDealers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [roleDraft, setRoleDraft] = useState<DealerRoleDraft>(EMPTY_DEALER_ROLE_DRAFT);
  const showDealerAccess = role === 'dealer' || role === 'dealer_staff';
  /** Access column / toggle / form — localhost only so production super admins don't see tiers. */
  const showSuperAdminAccess = role === 'super_admin' && isLocalhostDev();
  const canWriteUsers = canSuperAdminWrite(user) || (
    user?.role !== 'super_admin' && Boolean(user)
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const all = snap.docs
        .map(d => {
          const data = d.data() as FirestoreUserDoc;
          const normalizedRole = normalizeRole(String(data.role ?? ''));
          if (!normalizedRole) return null;
          return { uid: d.id, ...data, role: normalizedRole } as UserRecord;
        })
        .filter((u): u is UserRecord => u !== null);
      setDealers(all.filter(u => u.role === 'dealer' && u.active !== false));

      let filtered = all.filter(u => u.role === role);
      if (scopedDealerId) {
        filtered = filtered.filter(u => readDealerId(u) === scopedDealerId);
      }
      filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRecords(filtered);
    } finally {
      setLoading(false);
    }
  }, [role, scopedDealerId]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const parentDealerRecord = useCallback((dealerId?: string) => {
    const id = dealerId || scopedDealerId;
    if (!id) return null;
    if (user?.uid === id && user.role === 'dealer') {
      return {
        uid: user.uid,
        displayName: user.displayName,
        role: user.role,
        dealerTier: user.dealerTier,
        dealerAccessMode: user.dealerAccessMode,
        dealerPermissions: user.dealerPermissions,
        active: user.active,
        createdAt: '',
      } as UserRecord;
    }
    return dealers.find(d => d.uid === id) ?? null;
  }, [dealers, scopedDealerId, user]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, dealerId: scopedDealerId ?? '' });
    setRoleDraft(EMPTY_DEALER_ROLE_DRAFT);
    setEditingUid(null);
    setShowForm(false);
    setError('');
    setShowPw(false);
  };

  const openCreate = () => {
    if (!canWriteUsers) return;
    setForm({ ...EMPTY_FORM, dealerId: scopedDealerId ?? '', superAdminAccess: 'full' });
    const parent = role === 'dealer_staff' ? parentDealerRecord(scopedDealerId) : null;
    setRoleDraft(parent ? dealerRoleDraftFromRecord(parent) : EMPTY_DEALER_ROLE_DRAFT);
    setEditingUid(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (record: UserRecord) => {
    if (!canWriteUsers) return;
    const login = resolveProfileLogin(record);
    setForm({
      loginId: login?.value ?? '',
      password: '',
      displayName: record.displayName,
      phone: record.phone ?? '',
      email: record.email ?? '',
      dealerId: readDealerId(record) ?? scopedDealerId ?? '',
      superAdminAccess: normalizeSuperAdminAccess(record.superAdminAccess),
    });
    setRoleDraft(dealerRoleDraftFromRecord(record));
    setEditingUid(record.uid);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canWriteUsers) return;
    if (showSuperAdminAccess && !canSuperAdminWrite(user)) {
      setError('View-only super admins cannot change access.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const accessPayload = showDealerAccess ? dealerRoleDraftToPayload(roleDraft) : {};
      const superAccessPayload = showSuperAdminAccess
        ? { superAdminAccess: normalizeSuperAdminAccess(form.superAdminAccess) }
        : {};
      if (editingUid) {
        await updateUserProfile(db, editingUid, {
          displayName: form.displayName,
          phone: form.phone || undefined,
          email: form.email || undefined,
          dealerId:
            role === 'dealer_staff' ? form.dealerId || scopedDealerId : undefined,
          ...accessPayload,
          ...superAccessPayload,
        });
        const nextPassword = form.password.trim();
        if (nextPassword) {
          if (!canSuperAdminWrite(user)) {
            throw new Error('Only full super admins can reset passwords.');
          }
          if (nextPassword.length < 6) {
            throw new Error('Password must be at least 6 characters.');
          }
          await setManagedUserPassword(editingUid, nextPassword);
        }
      } else {
        if (form.password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        if (!parseLoginId(form.loginId)) {
          throw new Error(
            preferUsernameLogin
              ? 'Enter a valid User ID (letters, numbers, dots, dashes).'
              : 'Enter a valid email, 10-digit phone, or 12-digit Aadhaar number.',
          );
        }
        await registerUser(db, {
          loginId: form.loginId,
          password: form.password,
          displayName: form.displayName,
          role,
          phone: form.phone || undefined,
          email: form.email || undefined,
          dealerId:
            role === 'dealer_staff' ? form.dealerId || scopedDealerId : undefined,
          ...accessPayload,
          ...superAccessPayload,
          createdByUid: user.uid,
        });
      }
      resetForm();
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSuperAdminAccess = async (record: UserRecord) => {
    if (!user || !canSuperAdminWrite(user) || record.uid === user.uid) return;
    const current = normalizeSuperAdminAccess(record.superAdminAccess);
    const next: SuperAdminAccess = current === 'full' ? 'view_only' : 'full';
    const ok = await confirm({
      title: `Set ${SUPER_ADMIN_ACCESS_LABELS[next]} access`,
      message: next === 'view_only'
        ? `${record.displayName} will be able to view the portal but not update stock, products, or other data.`
        : `${record.displayName} will regain full edit permissions.`,
      confirmLabel: `Make ${SUPER_ADMIN_ACCESS_LABELS[next]}`,
    });
    if (!ok) return;
    setError('');
    try {
      await updateUserProfile(db, record.uid, { superAdminAccess: next });
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update access.');
    }
  };

  const handleDeactivate = async (record: UserRecord) => {
    if (!canWriteUsers || record.uid === user?.uid) return;
    const ok = await confirm({
      title: 'Deactivate user',
      message: `Deactivate ${record.displayName}? They will not be able to sign in.`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await deactivateUser(db, record.uid);
    await fetchUsers();
  };

  const handleDeletePermanently = async (record: UserRecord) => {
    if (
      !user
      || !canSuperAdminWrite(user)
      || !canPermanentlyDelete
      || record.uid === user.uid
    ) {
      return;
    }
    const extraNote =
      role === 'dealer'
        ? ' Linked dealer staff will also be removed.'
        : '';
    const ok = await confirm({
      title: `Delete ${ROLE_LABELS[role]} permanently`,
      message: `Permanently delete ${record.displayName}? This removes their account and login.${extraNote} This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    setError('');
    try {
      await deleteUserPermanently(record.uid);
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const canPermanentlyDelete =
    canSuperAdminWrite(user)
    && (role === 'super_admin' || role === 'dealer' || role === 'staff' || role === 'dealer_staff' || role === 'warehouse' || role === 'media');

  const dealerName = (dealerId?: string) =>
    dealers.find(d => d.uid === dealerId)?.displayName ?? '—';

  const canManageThisRole = user
    ? (role === 'warehouse' || role === 'media' ? canManageWarehouseUsers(user) : canManageRole(user.role, role))
    : false;

  if (!user || !canManageThisRole) {
    return (
      <div className="page-content fade-in">
        <div className="panel glass">
          <p className="text-muted">You do not have permission to manage {ROLE_LABELS[role]} users.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in">
      <div className="panel glass panel--table">
        <div className="panel-header flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2>{title}</h2>
            <p className="text-muted text-sm">{description}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void fetchUsers()}>
              <RefreshCw size={16} />
              Refresh
            </button>
            {canWriteUsers ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <Plus size={16} />
                Add {ROLE_LABELS[role]}
              </button>
            ) : null}
          </div>
        </div>
        {showSuperAdminAccess && !canWriteUsers ? (
          <p className="text-muted text-sm mx-4 mb-2">
            Your account is view-only. You can browse this list but cannot add, edit, or change access.
          </p>
        ) : null}

        {error && !showForm && (
          <div className="login-error mx-4 mb-3">{error}</div>
        )}

        {showForm && (
          <InlineFormPanel
            title={editingUid ? `Edit ${ROLE_LABELS[role]}` : `New ${ROLE_LABELS[role]}`}
            onClose={resetForm}
          >
            <form onSubmit={handleSubmit} className="form-grid-2">
              {error && <div className="login-error col-span-all">{error}</div>}

              {!editingUid && (
                <div className="form-group">
                  <label htmlFor="user-login-id">Login ID</label>
                  <input
                    id="user-login-id"
                    type="text"
                    className="input-field"
                    placeholder={
                      preferUsernameLogin
                        // role id remains `warehouse`; login ids often still use warehouse1, …
                        ? (role === 'media' ? 'User ID (e.g. media1)' : 'User ID (e.g. warehouse1)')
                        : 'Email, phone, or Aadhaar'
                    }
                    value={form.loginId}
                    onChange={e => setForm(f => ({ ...f, loginId: e.target.value }))}
                    required
                  />
                  <p className="text-muted text-sm">
                    {preferUsernameLogin
                      ? 'Short User ID — letters, numbers, dots, dashes — used to sign in'
                      : 'Email, 10-digit mobile, or 12-digit Aadhaar — used to sign in'}
                  </p>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="user-name">Full name</label>
                <input
                  id="user-name"
                  type="text"
                  className="input-field"
                  value={form.displayName}
                  onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="user-phone">Phone</label>
                <input
                  id="user-phone"
                  type="tel"
                  className="input-field"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="user-email">Contact email (optional)</label>
                <input
                  id="user-email"
                  type="email"
                  className="input-field"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {showDealerPicker && role === 'dealer_staff' && !scopedDealerId && (
                <div className="form-group">
                  <label htmlFor="user-dealer">Dealer</label>
                  <select
                    id="user-dealer"
                    className="input-field"
                    value={form.dealerId}
                    onChange={e => {
                      const dealerId = e.target.value;
                      setForm(f => ({ ...f, dealerId }));
                      const parent = parentDealerRecord(dealerId);
                      if (parent) setRoleDraft(dealerRoleDraftFromRecord(parent));
                    }}
                    required
                  >
                    <option value="">Select dealer</option>
                    {dealers.map(d => (
                      <option key={d.uid} value={d.uid}>
                        {d.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showDealerAccess && (
                <div className="col-span-all user-management__access panel glass">
                  <h3 className="user-management__access-title">Portal access</h3>
                  <DealerRoleEditor
                    value={roleDraft}
                    onChange={setRoleDraft}
                    disabled={submitting}
                  />
                </div>
              )}

              {showSuperAdminAccess && (
                <div className="form-group col-span-all">
                  <label htmlFor="super-admin-access">Access</label>
                  <select
                    id="super-admin-access"
                    className="input-field"
                    value={form.superAdminAccess}
                    onChange={e => setForm(f => ({
                      ...f,
                      superAdminAccess: normalizeSuperAdminAccess(e.target.value),
                    }))}
                    disabled={submitting || !canSuperAdminWrite(user)}
                  >
                    <option value="full">Full — can edit stock, products, locations, HR, etc.</option>
                    <option value="view_only">View only — browse everything, no edits</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="user-password">
                  {editingUid ? 'Reset password' : 'Password'}
                </label>
                {!editingUid ? (
                  <div className="input-icon-wrap">
                    <input
                      id="user-password"
                      type={showPw ? 'text' : 'password'}
                      className="input-field"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="input-icon-right"
                      onClick={() => setShowPw(p => !p)}
                    >
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                ) : canSuperAdminWrite(user) && editingUid !== user?.uid ? (
                  <>
                    <div className="input-icon-wrap">
                      <input
                        id="user-password"
                        type={showPw ? 'text' : 'password'}
                        className="input-field"
                        placeholder="Leave blank to keep current password"
                        value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        minLength={6}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="input-icon-right"
                        onClick={() => setShowPw(p => !p)}
                      >
                        {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="text-muted text-sm">
                      Enter a new password (min 6 characters) and save to reset their login.
                    </p>
                  </>
                ) : (
                  <p className="text-muted text-sm">
                    Dealers can reset via WhatsApp on the dealer login page.
                  </p>
                )}
              </div>

              <div className="col-span-all flex gap-2 justify-end">
                <button type="submit" className="btn btn-success btn-sm" disabled={submitting}>
                  {submitting ? <span className="spinner-inline" /> : <><Save size={16} /> Save</>}
                </button>
              </div>
            </form>
          </InlineFormPanel>
        )}

        <div className="table-scroll-wrap">
          {loading ? (
            <div className="text-center p-4"><div className="loader-ring mx-auto" /></div>
          ) : records.length === 0 ? (
            <p className="text-muted text-center p-4">No users yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login ID</th>
                  <th>Phone</th>
                  {showDealerAccess && <th>Access</th>}
                  {showSuperAdminAccess && <th>Access</th>}
                  {role === 'dealer_staff' && !scopedDealerId && <th>Dealer</th>}
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(record => {
                  const loginDisplay = displayLoginForRecord(record);
                  const access = normalizeSuperAdminAccess(record.superAdminAccess);
                  return (
                    <tr key={record.uid}>
                      <td>{record.displayName}</td>
                      <td>
                        <span className="text-muted text-sm">{loginDisplay.label}</span>
                        <br />
                        {loginDisplay.value}
                      </td>
                      <td>{record.phone || '—'}</td>
                      {showDealerAccess && (
                        <td>
                          <span className={`user-management__tier user-management__tier--${record.dealerTier ?? 'standard'}`}>
                            {DEALER_TIER_LABELS[record.dealerTier ?? 'standard']}
                          </span>
                          {record.dealerAccessMode === 'custom' && (
                            <span className="text-muted text-sm"> · Custom</span>
                          )}
                        </td>
                      )}
                      {showSuperAdminAccess && (
                        <td>
                          <span
                            className={[
                              'status-badge',
                              access === 'full' ? 'active' : 'inactive',
                            ].join(' ')}
                          >
                            {SUPER_ADMIN_ACCESS_LABELS[access]}
                          </span>
                        </td>
                      )}
                      {role === 'dealer_staff' && !scopedDealerId && (
                        <td>{dealerName(readDealerId(record))}</td>
                      )}
                      <td>
                        <span className={`status-badge ${record.active === false ? 'inactive' : 'active'}`}>
                          {record.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td className="text-right">
                        {canWriteUsers ? (
                          <button
                            type="button"
                            className="btn-icon"
                            title="Edit"
                            onClick={() => openEdit(record)}
                          >
                            <Pencil size={16} />
                          </button>
                        ) : null}
                        {showSuperAdminAccess
                          && canSuperAdminWrite(user)
                          && record.uid !== user?.uid
                          && record.active !== false ? (
                          <button
                            type="button"
                            className="btn-icon"
                            title={
                              access === 'full'
                                ? 'Switch to view only'
                                : 'Switch to full access'
                            }
                            onClick={() => { void handleToggleSuperAdminAccess(record); }}
                          >
                            <Shield size={16} />
                          </button>
                        ) : null}
                        {canWriteUsers && record.uid !== user?.uid && record.active !== false && (
                          <button
                            type="button"
                            className="btn-icon text-red"
                            title="Deactivate"
                            onClick={() => void handleDeactivate(record)}
                          >
                            <UserX size={16} />
                          </button>
                        )}
                        {canPermanentlyDelete && record.uid !== user?.uid && (
                          <button
                            type="button"
                            className="btn-icon text-red"
                            title="Delete permanently"
                            onClick={() => void handleDeletePermanently(record)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
