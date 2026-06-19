import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import {
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserX,
  Users,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  StaffRoleEditor,
  EMPTY_STAFF_ROLE_DRAFT,
  staffRoleDraftFromRecord,
  staffRoleDraftToPayload,
  type StaffRoleDraft,
} from '../../components/admin/StaffRoleEditor';
import {
  deactivateUser,
  deleteUserPermanently,
  registerUser,
  updateUserProfile,
} from '../../lib/userAdmin';
import { fetchKams } from '../../lib/dealers';
import {
  effectivePermissionSet,
  resolveStaffPermissions,
  staffDepartmentLabel,
} from '../../lib/staffAccess';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { STAFF_DEPARTMENTS, STAFF_DEPARTMENT_LABELS, type StaffDepartment } from '../../types';
import { normalizeRole } from '../../types';
import {
  formatLoginIdDisplay,
  loginIdTypeLabel,
  parseLoginId,
} from '../../lib/loginAuth';
import { resolveProfileLogin } from '../../lib/profileLogin';
import type { Kam } from '../../types/dealers';

const EMPTY_ACCOUNT = {
  loginId: '',
  password: '',
  displayName: '',
  phone: '',
  email: '',
};

function departmentTone(department: StaffDepartment | undefined): string {
  if (department === 'sales') return 'blue';
  if (department === 'service') return 'green';
  if (department === 'logistics') return 'orange';
  return 'purple';
}

export const StaffManagementPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [kams, setKams] = useState<Kam[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [roleDraft, setRoleDraft] = useState<StaffRoleDraft>(EMPTY_STAFF_ROLE_DRAFT);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canManage = user?.role === 'super_admin';

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const staff = snap.docs
        .map(d => {
          const data = d.data() as FirestoreUserDoc;
          const role = normalizeRole(String(data.role ?? ''));
          if (role !== 'staff') return null;
          return { uid: d.id, ...data, role } as UserRecord;
        })
        .filter((u): u is UserRecord => u !== null)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRecords(staff);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStaff();
    void fetchKams().then(setKams).catch(() => setKams([]));
  }, [fetchStaff]);

  const deptCounts = useMemo(() => {
    const counts: Record<StaffDepartment, number> = {
      sales: 0,
      service: 0,
      logistics: 0,
      admin: 0,
    };
    records.forEach(record => {
      const dept = record.staffDepartment ?? 'admin';
      counts[dept] += 1;
    });
    return counts;
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter(record => {
      if (deptFilter !== 'all' && (record.staffDepartment ?? 'admin') !== deptFilter) return false;
      if (!q) return true;
      const login = resolveProfileLogin(record);
      return (
        record.displayName.toLowerCase().includes(q)
        || (login?.value ?? '').includes(q)
        || (record.email ?? '').toLowerCase().includes(q)
      );
    });
  }, [deptFilter, records, search]);

  const resetForm = () => {
    setAccount(EMPTY_ACCOUNT);
    setRoleDraft(EMPTY_STAFF_ROLE_DRAFT);
    setEditingUid(null);
    setShowForm(false);
    setError('');
    setShowPw(false);
  };

  const openCreate = () => {
    setAccount(EMPTY_ACCOUNT);
    setRoleDraft(EMPTY_STAFF_ROLE_DRAFT);
    setEditingUid(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (record: UserRecord) => {
    const login = resolveProfileLogin(record);
    setAccount({
      loginId: login?.value ?? '',
      password: '',
      displayName: record.displayName,
      phone: record.phone ?? '',
      email: record.email ?? '',
    });
    setRoleDraft(staffRoleDraftFromRecord(record));
    setEditingUid(record.uid);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError('');

    const accessPayload = staffRoleDraftToPayload(roleDraft);

    try {
      if (editingUid) {
        await updateUserProfile(db, editingUid, {
          displayName: account.displayName,
          phone: account.phone || undefined,
          email: account.email || undefined,
          ...accessPayload,
        });
      } else {
        if (account.password.length < 6) throw new Error('Password must be at least 6 characters.');
        if (!parseLoginId(account.loginId)) {
          throw new Error('Enter a valid email, 10-digit phone, or 12-digit Aadhaar number.');
        }
        await registerUser(db, {
          loginId: account.loginId,
          password: account.password,
          displayName: account.displayName,
          role: 'staff',
          phone: account.phone || undefined,
          email: account.email || undefined,
          ...accessPayload,
          createdByUid: user.uid,
        });
      }
      resetForm();
      await fetchStaff();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (record: UserRecord) => {
    if (record.uid === user?.uid) return;
    const ok = await confirm({
      title: 'Deactivate staff',
      message: `Deactivate ${record.displayName}? They will not be able to sign in.`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await deactivateUser(db, record.uid);
    await fetchStaff();
  };

  const handleDelete = async (record: UserRecord) => {
    if (!user || user.role !== 'super_admin' || record.uid === user.uid) return;
    const ok = await confirm({
      title: 'Delete staff permanently',
      message: `Permanently delete ${record.displayName}? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteUserPermanently(record.uid);
      await fetchStaff();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (!user || !canManage) {
    return (
      <div className="page-content fade-in">
        <div className="panel glass">
          <p className="text-muted">You do not have permission to manage staff roles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in staff-management-page">
      <header className="staff-management-page__hero panel glass">
        <div>
          <h2 className="staff-management-page__title">Staff roles &amp; access</h2>
          <p className="text-muted text-sm">
            Assign departments and fine-tune permissions for YesWeigh internal teams.
          </p>
        </div>
        <div className="staff-management-page__hero-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void fetchStaff()}>
            <RefreshCw size={16} className={loading ? 'spin-icon' : undefined} />
            Refresh
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={16} />
            Add staff
          </button>
        </div>
      </header>

      <div className="staff-management-page__stats">
        <div className="staff-management-page__stat panel glass">
          <Users size={20} aria-hidden />
          <div>
            <span className="staff-management-page__stat-label">Total staff</span>
            <strong>{records.length}</strong>
          </div>
        </div>
        {STAFF_DEPARTMENTS.map((dept: StaffDepartment) => (
          <button
            key={dept}
            type="button"
            className={`staff-management-page__stat staff-management-page__stat--${departmentTone(dept)} panel glass ${deptFilter === dept ? 'is-active' : ''}`}
            onClick={() => setDeptFilter((prev: StaffDepartment | 'all') => (prev === dept ? 'all' : dept))}
          >
            <span className="staff-management-page__stat-label">{STAFF_DEPARTMENT_LABELS[dept]}</span>
            <strong>{deptCounts[dept]}</strong>
          </button>
        ))}
      </div>

      <div className="staff-management-page__toolbar panel glass">
        <div className="staff-management-page__search">
          <Search size={18} aria-hidden />
          <input
            className="input-field"
            placeholder="Search by name, login, or email"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {deptFilter !== 'all' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeptFilter('all')}>
            Clear filter
          </button>
        )}
      </div>

      {error && !showForm && (
        <div className="login-error panel glass">{error}</div>
      )}

      {showForm && (
        <InlineFormPanel
          title={editingUid ? 'Edit staff member' : 'New staff member'}
          onClose={resetForm}
        >
          <form onSubmit={handleSubmit} className="staff-management-page__form">
            {error && <div className="login-error">{error}</div>}

            <div className="staff-management-page__form-grid">
              <div className="staff-management-page__account panel glass">
                <h3>Account</h3>
                {!editingUid && (
                  <label className="staff-management-page__field">
                    <span>Login ID</span>
                    <input
                      className="input-field"
                      placeholder="Email, phone, or Aadhaar"
                      value={account.loginId}
                      onChange={e => setAccount(a => ({ ...a, loginId: e.target.value }))}
                      required
                    />
                  </label>
                )}
                <label className="staff-management-page__field">
                  <span>Full name</span>
                  <input
                    className="input-field"
                    value={account.displayName}
                    onChange={e => setAccount(a => ({ ...a, displayName: e.target.value }))}
                    required
                  />
                </label>
                <label className="staff-management-page__field">
                  <span>Phone</span>
                  <input
                    className="input-field"
                    value={account.phone}
                    onChange={e => setAccount(a => ({ ...a, phone: e.target.value }))}
                  />
                </label>
                <label className="staff-management-page__field">
                  <span>Email</span>
                  <input
                    className="input-field"
                    type="email"
                    value={account.email}
                    onChange={e => setAccount(a => ({ ...a, email: e.target.value }))}
                  />
                </label>
                {!editingUid && (
                  <label className="staff-management-page__field">
                    <span>Password</span>
                    <div className="staff-management-page__password">
                      <input
                        className="input-field"
                        type={showPw ? 'text' : 'password'}
                        value={account.password}
                        onChange={e => setAccount(a => ({ ...a, password: e.target.value }))}
                        required
                      />
                      <button
                        type="button"
                        className="staff-management-page__pw-toggle"
                        onClick={() => setShowPw(v => !v)}
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>
                )}
              </div>

              <div className="staff-management-page__roles panel glass">
                <h3>Role &amp; permissions</h3>
                <StaffRoleEditor
                  value={roleDraft}
                  onChange={setRoleDraft}
                  kams={kams}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="staff-management-page__form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <Save size={16} />
                {submitting ? 'Saving…' : editingUid ? 'Save changes' : 'Create staff'}
              </button>
            </div>
          </form>
        </InlineFormPanel>
      )}

      <div className="staff-management-page__grid">
        {loading && records.length === 0 ? (
          <p className="text-muted text-sm">Loading staff…</p>
        ) : filtered.length === 0 ? (
          <div className="staff-management-page__empty panel glass">
            <Users size={36} aria-hidden />
            <p className="text-muted text-sm">No staff members match your filters.</p>
          </div>
        ) : (
          filtered.map(record => {
            const login = resolveProfileLogin(record);
            const dept = record.staffDepartment ?? 'admin';
            const perms = resolveStaffPermissions({
              ...record,
              role: 'staff',
              uid: record.uid,
              loginId: login?.value ?? '',
              loginIdType: login?.type ?? 'phone',
              displayName: record.displayName,
              active: record.active !== false,
            });
            const kamName = record.staffKamId
              ? kams.find(k => k.id === record.staffKamId)?.name ?? 'KAM'
              : null;

            return (
              <article
                key={record.uid}
                className={`staff-management-page__card panel glass staff-management-page__card--${departmentTone(dept)}`}
              >
                <div className="staff-management-page__card-head">
                  <div>
                    <strong>{record.displayName}</strong>
                    <span className={`staff-management-page__dept-badge staff-management-page__dept-badge--${departmentTone(dept)}`}>
                      {staffDepartmentLabel(dept)}
                    </span>
                  </div>
                  <span className={`staff-management-page__status ${record.active === false ? 'is-inactive' : ''}`}>
                    {record.active === false ? 'Inactive' : 'Active'}
                  </span>
                </div>

                <p className="staff-management-page__login text-sm text-muted">
                  {login ? `${loginIdTypeLabel(login.type)} · ${formatLoginIdDisplay(login.type, login.value)}` : '—'}
                </p>

                <div className="staff-management-page__meta text-sm">
                  <span>{perms.length} permissions</span>
                  {record.staffAccessMode === 'custom' && <span>Custom access</span>}
                  {kamName && <span>KAM · {kamName}</span>}
                  {record.staffTeamId && <span>Team · {record.staffTeamId}</span>}
                </div>

                <div className="staff-management-page__chips">
                  {effectivePermissionSet(
                    dept,
                    record.staffAccessMode ?? 'department',
                    record.staffPermissions ?? [],
                  ).slice(0, 4).map(permission => (
                    <span key={permission} className="staff-management-page__chip">{permission.split('.')[0]}</span>
                  ))}
                  {perms.length > 4 && (
                    <span className="staff-management-page__chip">+{perms.length - 4}</span>
                  )}
                </div>

                <div className="staff-management-page__card-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(record)}>
                    <Pencil size={15} />
                    Edit
                  </button>
                  {record.uid !== user.uid && record.active !== false && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleDeactivate(record)}>
                      <UserX size={15} />
                      Deactivate
                    </button>
                  )}
                  {user.role === 'super_admin' && record.uid !== user.uid && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm staff-management-page__delete"
                      onClick={() => void handleDelete(record)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
};
