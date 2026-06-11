import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2, Save } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  deactivateUser,
  registerUser,
  updateUserProfile,
} from '../../lib/userAdmin';
import type { FirestoreUserDoc, Role, UserRecord } from '../../types';
import { ROLE_LABELS, canManageRole, normalizeRole, readDealerId } from '../../types';

const EMPTY_FORM = {
  email: '',
  password: '',
  displayName: '',
  phone: '',
  dealerId: '',
};

type UserManagementProps = {
  role: Role;
  title: string;
  description: string;
  /** When set, only list/create users under this dealer (dealer portal). */
  scopedDealerId?: string;
  showDealerPicker?: boolean;
};

export const UserManagement: React.FC<UserManagementProps> = ({
  role,
  title,
  description,
  scopedDealerId,
  showDealerPicker = false,
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

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, dealerId: scopedDealerId ?? '' });
    setEditingUid(null);
    setShowForm(false);
    setError('');
    setShowPw(false);
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, dealerId: scopedDealerId ?? '' });
    setEditingUid(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (record: UserRecord) => {
    setForm({
      email: record.email,
      password: '',
      displayName: record.displayName,
      phone: record.phone ?? '',
      dealerId: readDealerId(record) ?? scopedDealerId ?? '',
    });
    setEditingUid(record.uid);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError('');

    try {
      if (editingUid) {
        await updateUserProfile(db, editingUid, {
          displayName: form.displayName,
          phone: form.phone || undefined,
          dealerId:
            role === 'dealer_staff' ? form.dealerId || scopedDealerId : undefined,
        });
      } else {
        if (form.password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        await registerUser(db, {
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          role,
          phone: form.phone || undefined,
          dealerId:
            role === 'dealer_staff' ? form.dealerId || scopedDealerId : undefined,
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

  const handleDeactivate = async (record: UserRecord) => {
    if (record.uid === user?.uid) return;
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

  const dealerName = (dealerId?: string) =>
    dealers.find(d => d.uid === dealerId)?.displayName ?? '—';

  if (!user || !canManageRole(user.role, role)) {
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
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              <Plus size={16} />
              Add {ROLE_LABELS[role]}
            </button>
          </div>
        </div>

        {showForm && (
          <InlineFormPanel
            title={editingUid ? `Edit ${ROLE_LABELS[role]}` : `New ${ROLE_LABELS[role]}`}
            onClose={resetForm}
          >
            <form onSubmit={handleSubmit} className="form-grid-2">
              {error && <div className="login-error col-span-all">{error}</div>}

              {!editingUid && (
                <div className="form-group">
                  <label htmlFor="user-email">Email</label>
                  <input
                    id="user-email"
                    type="email"
                    className="input-field"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required
                  />
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

              {showDealerPicker && role === 'dealer_staff' && !scopedDealerId && (
                <div className="form-group">
                  <label htmlFor="user-dealer">Dealer</label>
                  <select
                    id="user-dealer"
                    className="input-field"
                    value={form.dealerId}
                    onChange={e => setForm(f => ({ ...f, dealerId: e.target.value }))}
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

              <div className="form-group">
                <label htmlFor="user-password">
                  {editingUid ? 'Password (set at creation only)' : 'Password'}
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
                ) : (
                  <p className="text-muted text-sm">Contact admin to reset password.</p>
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
                  <th>Email</th>
                  <th>Phone</th>
                  {role === 'dealer_staff' && !scopedDealerId && <th>Dealer</th>}
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr key={record.uid}>
                    <td>{record.displayName}</td>
                    <td>{record.email}</td>
                    <td>{record.phone || '—'}</td>
                    {role === 'dealer_staff' && !scopedDealerId && (
                      <td>{dealerName(readDealerId(record))}</td>
                    )}
                    <td>
                      <span className={`status-badge ${record.active === false ? 'inactive' : 'active'}`}>
                        {record.active === false ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-icon"
                        title="Edit"
                        onClick={() => openEdit(record)}
                      >
                        <Pencil size={16} />
                      </button>
                      {record.uid !== user?.uid && record.active !== false && (
                        <button
                          type="button"
                          className="btn-icon text-red"
                          title="Deactivate"
                          onClick={() => void handleDeactivate(record)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
