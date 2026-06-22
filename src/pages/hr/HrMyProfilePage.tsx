import React, { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { HrStaffProfileView } from '../../components/hr/HrStaffProfileView';
import { getHrFileUrl } from '../../lib/hrStaff';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';
import type { HrDocumentType } from '../../types/staff-hr';
import { HR_DOCUMENT_TYPES } from '../../types/staff-hr';

export const HrMyProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [record, setRecord] = useState<UserRecord | null>(null);
  const [docUrls, setDocUrls] = useState<Partial<Record<HrDocumentType, string>>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return;
      const data = snap.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (!role) return;
      const full: UserRecord = { uid: snap.id, ...data, role };
      setRecord(full);

      const urls: Partial<Record<HrDocumentType, string>> = {};
      await Promise.all(
        HR_DOCUMENT_TYPES.map(async type => {
          const path = full.hrDocuments?.[type]?.storagePath;
          if (!path) return;
          try {
            urls[type] = await getHrFileUrl(path);
          } catch {
            // ignore broken links
          }
        }),
      );
      setDocUrls(urls);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  if (loading) {
    return <p className="text-muted text-sm">Loading your profile…</p>;
  }

  if (!record) {
    return (
      <div className="panel glass">
        <p className="text-muted">Profile not found.</p>
      </div>
    );
  }

  return (
    <div className="hr-my-profile">
      <p className="text-muted text-sm hr-my-profile__hint">
        Your HR profile is read-only. Contact HR to request changes.
      </p>
      <HrStaffProfileView
        record={record}
        documentUrls={docUrls}
        onOpenDocument={type => {
          const url = docUrls[type];
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }}
      />
    </div>
  );
};
