import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Eye, EyeOff, KeyRound, Pencil, ShieldCheck, Trash2, UserX, X } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { HrStaffProfileView } from '../../components/hr/HrStaffProfileView';
import { getHrFileUrl } from '../../lib/hrStaff';
import { fetchStaffRoles, findStaffRole } from '../../lib/staffRoles';
import { canManageHr, canManageSuperAdminsInHr, canSuperAdminWrite } from '../../lib/staffAccess';
import {
  deactivateUser,
  deleteUserPermanently,
  promoteStaffToSuperAdmin,
  setManagedUserPassword,
} from '../../lib/userAdmin';
import { resolveProfileLogin } from '../../lib/profileLogin';
import { formatLoginIdDisplay, loginIdTypeLabel } from '../../lib/loginAuth';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';
import type { HrDocumentType } from '../../types/staff-hr';
import { HR_DOCUMENT_TYPES } from '../../types/staff-hr';

type HrStaffDetailPageProps = {
  basePath: string;
};

export const HrStaffDetailPage: React.FC<HrStaffDetailPageProps> = ({ basePath }) => {
  const { uid } = useParams<{ uid: string }>();
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [record, setRecord] = useState<UserRecord | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [docUrls, setDocUrls] = useState<Partial<Record<HrDocumentType, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError('');
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) {
        setRecord(null);
        return;
      }
      const data = snap.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (role !== 'staff') {
        setRecord(null);
        return;
      }
      const full: UserRecord = { uid: snap.id, ...data, role };
      setRecord(full);
      const roles = await fetchStaffRoles();
      setRoleName(findStaffRole(roles, full.staffRoleId)?.name ?? null);

      const urls: Partial<Record<HrDocumentType, string>> = {};
      await Promise.all(
        HR_DOCUMENT_TYPES.map(async type => {
          const path = full.hrDocuments?.[type]?.storagePath;
          if (!path) return;
          try {
            urls[type] = await getHrFileUrl(path);
          } catch {
            // ignore
          }
        }),
      );
      setDocUrls(urls);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeResetModal = () => {
    if (resetting) return;
    setResetOpen(false);
    setResetPassword('');
    setShowResetPw(false);
    setResetError('');
  };

  const openResetModal = () => {
    setResetSuccess('');
    setResetError('');
    setResetPassword('');
    setShowResetPw(false);
    setResetOpen(true);
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!record || !canSuperAdminWrite(user) || record.uid === user?.uid) return;
    const next = resetPassword.trim();
    if (next.length < 6) {
      setResetError('Password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    setResetError('');
    try {
      await setManagedUserPassword(record.uid, next);
      setResetSuccess(`Password updated for ${record.displayName}.`);
      setResetOpen(false);
      setResetPassword('');
      setShowResetPw(false);
      await load();
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : 'Could not reset password.');
    } finally {
      setResetting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!record || record.uid === user?.uid) return;
    const ok = await confirm({
      title: 'Deactivate staff',
      message: `Deactivate ${record.displayName}? They will not be able to sign in.`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    await deactivateUser(db, record.uid);
    await load();
  };

  const handleDelete = async () => {
    if (!record || !user || user.role !== 'super_admin' || record.uid === user.uid) return;
    const ok = await confirm({
      title: 'Delete staff permanently',
      message: `Permanently delete ${record.displayName}? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteUserPermanently(record.uid);
      navigate(`${basePath}/hr/staff`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handlePromoteToSuperAdmin = async () => {
    if (
      !record
      || !user
      || !canManageSuperAdminsInHr(user)
      || !canSuperAdminWrite(user)
      || record.uid === user.uid
    ) return;
    const ok = await confirm({
      title: 'Promote to Super Admin',
      message: `Promote ${record.displayName} to Super Admin? They will leave the staff directory and gain full super admin access. Zoho salesperson links and dealer assignments are kept. Login and HR profile stay the same.`,
      confirmLabel: 'Promote',
    });
    if (!ok) return;
    setPromoting(true);
    setError('');
    try {
      await promoteStaffToSuperAdmin(db, record.uid);
      navigate(`${basePath}/hr/super-admins`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not promote to Super Admin.');
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return <p className="text-muted text-sm">Loading staff profile…</p>;
  }

  if (!record) {
    return (
      <div className="panel glass">
        <p className="text-muted">Staff member not found.</p>
        <Link to={`${basePath}/hr/staff`} className="btn btn-secondary btn-sm">
          Back to directory
        </Link>
      </div>
    );
  }

  const canEdit = canManageHr(user);
  const canResetPassword = canSuperAdminWrite(user) && record.uid !== user?.uid;
  const login = resolveProfileLogin(record);

  return (
    <div className="hr-staff-detail">
      {error && <div className="login-error panel glass">{error}</div>}
      {resetSuccess && (
        <div className="hr-staff-detail__success panel glass" role="status">
          {resetSuccess}
        </div>
      )}

      {canEdit && (
        <div className="hr-staff-detail__actions">
          <Link to={`${basePath}/hr/staff/${record.uid}/edit`} className="btn btn-primary btn-sm">
            <Pencil size={15} />
            Edit
          </Link>
          {canResetPassword && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openResetModal}
            >
              <KeyRound size={15} />
              Reset password
            </button>
          )}
          {canManageSuperAdminsInHr(user)
            && canSuperAdminWrite(user)
            && record.uid !== user?.uid
            && record.active !== false && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={promoting}
              onClick={() => void handlePromoteToSuperAdmin()}
            >
              <ShieldCheck size={15} />
              {promoting ? 'Promoting…' : 'Promote to Super Admin'}
            </button>
          )}
          {record.uid !== user?.uid && record.active !== false && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleDeactivate()}>
              <UserX size={15} />
              Deactivate
            </button>
          )}
          {user?.role === 'super_admin' && record.uid !== user.uid && (
            <button
              type="button"
              className="btn btn-secondary btn-sm hr-staff-detail__delete"
              onClick={() => void handleDelete()}
            >
              <Trash2 size={15} />
              Delete
            </button>
          )}
        </div>
      )}

      <HrStaffProfileView
        record={record}
        roleName={roleName}
        documentUrls={docUrls}
        onOpenDocument={type => {
          const url = docUrls[type];
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }}
      />

      {resetOpen && (
        <div
          className="dealers-modal-backdrop"
          role="presentation"
          onClick={closeResetModal}
        >
          <div
            className="dealers-modal panel glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-reset-password-title"
            onClick={e => e.stopPropagation()}
          >
            <header className="dealers-modal__header">
              <h2 id="hr-reset-password-title">Reset password</h2>
              <button
                type="button"
                className="dealers-modal__close"
                onClick={closeResetModal}
                aria-label="Close"
                disabled={resetting}
              >
                <X size={18} aria-hidden />
              </button>
            </header>

            <p className="text-muted text-sm" style={{ marginTop: 0 }}>
              Set a new login password for <strong>{record.displayName}</strong>
              {login ? (
                <>
                  {' '}({loginIdTypeLabel(login.type)} · {formatLoginIdDisplay(login.type, login.value)})
                </>
              ) : null}
              .
            </p>

            <form className="dealers-modal__form" onSubmit={e => void handleResetPassword(e)}>
              <label className="dealers-modal__field">
                <span>New password</span>
                <div className="dealers-modal__pw">
                  <input
                    type={showResetPw ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    autoFocus
                    required
                    minLength={6}
                    autoComplete="new-password"
                    disabled={resetting}
                  />
                  <button
                    type="button"
                    className="dealers-modal__pw-toggle"
                    onClick={() => setShowResetPw(v => !v)}
                    aria-label={showResetPw ? 'Hide password' : 'Show password'}
                  >
                    {showResetPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              {resetError && <p className="dealers-modal__error">{resetError}</p>}
              <div className="dealers-modal__actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeResetModal}
                  disabled={resetting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={resetting}>
                  {resetting ? 'Saving…' : 'Save password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
