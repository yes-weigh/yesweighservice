import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Pencil, Trash2, UserX } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { HrStaffProfileView } from '../../components/hr/HrStaffProfileView';
import { getHrFileUrl } from '../../lib/hrStaff';
import { fetchStaffRoles, findStaffRole } from '../../lib/staffRoles';
import { canManageHr } from '../../lib/staffAccess';
import { deactivateUser, deleteUserPermanently } from '../../lib/userAdmin';
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

  return (
    <div className="hr-staff-detail">
      {error && <div className="login-error panel glass">{error}</div>}

      {canEdit && (
        <div className="hr-staff-detail__actions">
          <Link to={`${basePath}/hr/staff/${record.uid}/edit`} className="btn btn-primary btn-sm">
            <Pencil size={15} />
            Edit
          </Link>
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
    </div>
  );
};
