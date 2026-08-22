import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Eye, EyeOff, Save, Upload, User } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  StaffRoleEditor,
  ZohoSalespersonPicker,
  EMPTY_STAFF_ROLE_DRAFT,
  staffRoleDraftFromRecord,
  staffRoleDraftToPayload,
  type StaffRoleDraft,
} from '../../components/admin/StaffRoleEditor';
import { fetchStaffRoles, SYSTEM_STAFF_ROLE_IDS } from '../../lib/staffRoles';
import type { StaffRoleTemplate } from '../../types/staff-role';
import { canManageHr } from '../../lib/staffAccess';
import {
  hrProfileToFirestorePatch,
  readHrProfileFromDoc,
  resolveHrPhotoUrl,
  uploadHrDocument,
  uploadHrPhoto,
} from '../../lib/hrStaff';
import { registerUser, updateUserProfile } from '../../lib/userAdmin';
import { parseLoginId } from '../../lib/loginAuth';
import { resolveProfileLogin } from '../../lib/profileLogin';
import {
  assertZohoSalespersonIdsAvailable,
  normalizeZohoSalespersonLinks,
  zohoLinksToFirestoreFields,
  type ZohoSalespersonLink,
} from '../../lib/zohoSalespersonStaff';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';
import { HrDocumentUpload } from '../../components/hr/HrDocumentUpload';
import {
  BLOOD_GROUPS,
  HR_DOCUMENT_LABELS,
  HR_DOCUMENT_TYPES,
  emptyHrProfile,
  type HrDocumentType,
  type StaffHrProfile,
} from '../../types/staff-hr';
type HrStaffFormPageProps = {
  basePath: string;
};

const EMPTY_ACCOUNT = {
  loginId: '',
  password: '',
  displayName: '',
  phone: '',
  email: '',
};

export const HrStaffFormPage: React.FC<HrStaffFormPageProps> = ({ basePath }) => {
  const { uid } = useParams<{ uid: string }>();
  const isEdit = Boolean(uid);
  const [searchParams] = useSearchParams();
  const managerUidParam = searchParams.get('managerUid')?.trim() || '';
  const { user } = useAuth();
  const navigate = useNavigate();
  const [staffRoles, setStaffRoles] = useState<StaffRoleTemplate[]>([]);
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [hr, setHr] = useState<StaffHrProfile>(emptyHrProfile());
  const [roleDraft, setRoleDraft] = useState<StaffRoleDraft>(EMPTY_STAFF_ROLE_DRAFT);
  const [zohoLinks, setZohoLinks] = useState<ZohoSalespersonLink[]>([]);
  const [editingRole, setEditingRole] = useState<'staff' | 'super_admin'>('staff');
  const [managerUid, setManagerUid] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [docFiles, setDocFiles] = useState<Partial<Record<HrDocumentType, File>>>({});
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isSuperAdminRecord = editingRole === 'super_admin';

  const loadRecord = useCallback(async (roles: StaffRoleTemplate[]) => {
    if (!uid) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) throw new Error('Staff not found');
      const data = snap.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (role !== 'staff' && role !== 'super_admin') {
        throw new Error('Not a staff or super admin HR profile');
      }
      const record = { uid: snap.id, ...data, role } as UserRecord;
      const login = resolveProfileLogin(record);
      setEditingRole(role);
      setAccount({
        loginId: login?.value ?? '',
        password: '',
        displayName: record.displayName,
        phone: record.phone ?? '',
        email: record.email ?? '',
      });
      setHr(readHrProfileFromDoc(record));
      setRoleDraft(staffRoleDraftFromRecord(record, roles));
      setZohoLinks(normalizeZohoSalespersonLinks(record));
      setManagerUid(record.managerUid?.trim() || null);
      void resolveHrPhotoUrl(record.uid, record).then(url => {
        if (url) setPhotoPreview(url);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void fetchStaffRoles(user?.role === 'super_admin').then(roles => {
      setStaffRoles(roles);
      if (isEdit) void loadRecord(roles);
      else {
        setEditingRole('staff');
        const defaultRole =
          roles.find(r => r.id === SYSTEM_STAFF_ROLE_IDS.sales) ?? roles[0];
        if (defaultRole) {
          setRoleDraft(staffRoleDraftFromRecord({
            staffRoleId: defaultRole.id,
            staffAccessMode: 'role',
          }, roles));
        }
        if (managerUidParam) setManagerUid(managerUidParam);
      }
    });
  }, [isEdit, loadRecord, managerUidParam, user?.role]);

  useEffect(() => {
    const id = managerUid?.trim();
    if (!id) {
      setManagerName(null);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'users', id)).then(snap => {
      if (cancelled) return;
      if (!snap.exists()) {
        setManagerName(null);
        return;
      }
      const data = snap.data() as FirestoreUserDoc;
      setManagerName(data.displayName?.trim() || id);
    });
    return () => { cancelled = true; };
  }, [managerUid]);

  const managerBanner = useMemo(() => {
    if (!managerUid) return null;
    return managerName || managerUid;
  }, [managerName, managerUid]);

  const onPhotoPick = (file: File | null) => {
    setPhotoFile(file);
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
    if (file) {
      setPhotoPreview(URL.createObjectURL(file));
      return;
    }
    if (uid) {
      void resolveHrPhotoUrl(uid, {
        hrPhotoStoragePath: hr.hrPhotoStoragePath,
        hrPhotoUrl: hr.hrPhotoUrl,
      }).then(url => setPhotoPreview(url));
      return;
    }
    setPhotoPreview(null);
  };

  const setHrField = <K extends keyof StaffHrProfile>(key: K, value: StaffHrProfile[K]) => {
    setHr(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError('');

    try {
      let targetUid = uid;
      const hrPatch = hrProfileToFirestorePatch(hr);

      if (isEdit && targetUid && isSuperAdminRecord) {
        const zohoFields = zohoLinksToFirestoreFields(zohoLinks);
        await assertZohoSalespersonIdsAvailable(zohoFields.zohoSalespersonIds, targetUid);
        await updateUserProfile(db, targetUid, {
          displayName: account.displayName,
          phone: account.phone || undefined,
          email: account.email || undefined,
          ...zohoFields,
          ...hrPatch,
        });
      } else if (isEdit && targetUid) {
        if (!roleDraft.roleId) throw new Error('Select a staff role.');
        const accessPayload = staffRoleDraftToPayload(roleDraft);
        await assertZohoSalespersonIdsAvailable(accessPayload.zohoSalespersonIds, targetUid);
        await updateUserProfile(db, targetUid, {
          displayName: account.displayName,
          phone: account.phone || undefined,
          email: account.email || undefined,
          ...accessPayload,
          managerUid: managerUid || null,
          ...hrPatch,
        });
      } else {
        if (!roleDraft.roleId) throw new Error('Select a staff role.');
        const accessPayload = staffRoleDraftToPayload(roleDraft);
        await assertZohoSalespersonIdsAvailable(accessPayload.zohoSalespersonIds, undefined);
        if (account.password.length < 6) throw new Error('Password must be at least 6 characters.');
        if (!parseLoginId(account.loginId)) {
          throw new Error('Enter a valid email, 10-digit phone, or 12-digit Aadhaar number.');
        }
        targetUid = await registerUser(db, {
          loginId: account.loginId,
          password: account.password,
          displayName: account.displayName,
          role: 'staff',
          phone: account.phone || undefined,
          email: account.email || undefined,
          ...accessPayload,
          managerUid: managerUid || null,
          createdByUid: user.uid,
          hr: hrPatch as Parameters<typeof registerUser>[1]['hr'],
        });
      }

      let photoStoragePath = hr.hrPhotoStoragePath ?? null;
      if (photoFile && targetUid) {
        const uploaded = await uploadHrPhoto(targetUid, photoFile);
        photoStoragePath = uploaded.storagePath;
        setPhotoPreview(uploaded.url);
      }

      const documents = { ...(hr.hrDocuments ?? {}) };
      for (const type of HR_DOCUMENT_TYPES) {
        const file = docFiles[type];
        if (!file || !targetUid) continue;
        documents[type] = await uploadHrDocument(targetUid, type, file);
      }

      if (
        targetUid
        && (photoStoragePath !== hr.hrPhotoStoragePath || Object.keys(docFiles).length > 0)
      ) {
        await updateUserProfile(db, targetUid, {
          hrPhotoStoragePath: photoStoragePath,
          hrPhotoUrl: null,
          hrDocuments: documents,
        });
      }

      navigate(`${basePath}/hr/staff/${targetUid}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || !canManageHr(user)) {
    return (
      <div className="panel glass">
        <p className="text-muted">You do not have permission to manage staff.</p>
      </div>
    );
  }

  if (loading) {
    return <p className="text-muted text-sm">Loading…</p>;
  }

  return (
    <div className="hr-staff-form">
      <form onSubmit={handleSubmit} className="hr-staff-form__body">
        {error && <div className="login-error panel glass">{error}</div>}
        {isSuperAdminRecord ? (
          <p className="hr-staff-form__banner panel glass text-sm">
            Editing a Super Admin HR profile. Portal access stays Super Admin; update photo, details, and Zoho salesperson links here.
          </p>
        ) : null}
        {!isEdit && managerBanner ? (
          <p className="hr-staff-form__banner panel glass text-sm">
            Creating staff under Super Admin <strong>{managerBanner}</strong>.
          </p>
        ) : null}

        <div className="hr-staff-form__grid">
          <section className="panel glass hr-staff-form__section">
            <h3>Photo</h3>
            <div className="hr-staff-form__photo">
              {photoPreview ? (
                <img src={photoPreview} alt="" />
              ) : (
                <div className="hr-staff-form__photo-placeholder">
                  <User size={32} />
                </div>
              )}
              <label className="btn btn-secondary btn-sm">
                <Upload size={15} />
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={e => onPhotoPick(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </section>

          <section className="panel glass hr-staff-form__section">
            <h3>Account</h3>
            {!isEdit && (
              <label className="hr-staff-form__field">
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
            <label className="hr-staff-form__field">
              <span>Full name</span>
              <input
                className="input-field"
                value={account.displayName}
                onChange={e => setAccount(a => ({ ...a, displayName: e.target.value }))}
                required
              />
            </label>
            <label className="hr-staff-form__field">
              <span>Phone</span>
              <input
                className="input-field"
                value={account.phone}
                onChange={e => setAccount(a => ({ ...a, phone: e.target.value }))}
              />
            </label>
            <label className="hr-staff-form__field">
              <span>Email</span>
              <input
                className="input-field"
                type="email"
                value={account.email}
                onChange={e => setAccount(a => ({ ...a, email: e.target.value }))}
              />
            </label>
            {!isEdit && (
              <label className="hr-staff-form__field">
                <span>Password</span>
                <div className="hr-staff-form__password">
                  <input
                    className="input-field"
                    type={showPw ? 'text' : 'password'}
                    value={account.password}
                    onChange={e => setAccount(a => ({ ...a, password: e.target.value }))}
                    required
                  />
                  <button
                    type="button"
                    className="hr-staff-form__pw-toggle"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            )}
          </section>

          <section className="panel glass hr-staff-form__section hr-staff-form__section--wide">
            <h3>Employment</h3>
            <div className="hr-staff-form__row">
              <label className="hr-staff-form__field">
                <span>Employee ID</span>
                <input
                  className="input-field"
                  value={hr.hrEmployeeId ?? ''}
                  onChange={e => setHrField('hrEmployeeId', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Designation</span>
                <input
                  className="input-field"
                  value={hr.hrDesignation ?? ''}
                  onChange={e => setHrField('hrDesignation', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Join date</span>
                <input
                  className="input-field"
                  type="date"
                  value={hr.hrJoinDate?.slice(0, 10) ?? ''}
                  onChange={e => setHrField('hrJoinDate', e.target.value || null)}
                />
              </label>
            </div>
          </section>

          <section className="panel glass hr-staff-form__section hr-staff-form__section--wide">
            <h3>Personal &amp; emergency</h3>
            <label className="hr-staff-form__field">
              <span>Residential address</span>
              <textarea
                className="input-field"
                rows={2}
                value={hr.hrResidentialAddress ?? ''}
                onChange={e => setHrField('hrResidentialAddress', e.target.value || null)}
              />
            </label>
            <div className="hr-staff-form__row">
              <label className="hr-staff-form__field">
                <span>Postal code</span>
                <input
                  className="input-field"
                  value={hr.hrPostalCode ?? ''}
                  onChange={e => setHrField('hrPostalCode', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Date of birth</span>
                <input
                  className="input-field"
                  type="date"
                  value={hr.hrDateOfBirth?.slice(0, 10) ?? ''}
                  onChange={e => setHrField('hrDateOfBirth', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Blood group</span>
                <select
                  className="input-field"
                  value={hr.hrBloodGroup ?? ''}
                  onChange={e => setHrField('hrBloodGroup', e.target.value || null)}
                >
                  <option value="">—</option>
                  {BLOOD_GROUPS.map(bg => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </label>
              <label className="hr-staff-form__field">
                <span>Police station</span>
                <input
                  className="input-field"
                  value={hr.hrPoliceStation ?? ''}
                  onChange={e => setHrField('hrPoliceStation', e.target.value || null)}
                />
              </label>
            </div>
            <div className="hr-staff-form__row">
              <label className="hr-staff-form__field">
                <span>Emergency contact</span>
                <input
                  className="input-field"
                  value={hr.hrEmergencyContactName ?? ''}
                  onChange={e => setHrField('hrEmergencyContactName', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Relationship</span>
                <input
                  className="input-field"
                  value={hr.hrEmergencyContactRelationship ?? ''}
                  onChange={e => setHrField('hrEmergencyContactRelationship', e.target.value || null)}
                />
              </label>
              <label className="hr-staff-form__field">
                <span>Emergency phone</span>
                <input
                  className="input-field"
                  value={hr.hrEmergencyContactPhone ?? ''}
                  onChange={e => setHrField('hrEmergencyContactPhone', e.target.value || null)}
                />
              </label>
            </div>
          </section>

          <section className="panel glass hr-staff-form__section hr-staff-form__section--wide">
            <h3>Documents</h3>
            <p className="hr-staff-form__section-hint text-muted text-sm">
              Upload staff documents. Existing files stay until replaced.
            </p>
            <div className="hr-staff-form__docs">
              {HR_DOCUMENT_TYPES.map(type => (
                <HrDocumentUpload
                  key={type}
                  label={HR_DOCUMENT_LABELS[type]}
                  fileName={docFiles[type]?.name ?? null}
                  hasExisting={Boolean(hr.hrDocuments?.[type]) && !docFiles[type]}
                  disabled={submitting}
                  onPick={file => {
                    setDocFiles(prev => {
                      const next = { ...prev };
                      if (file) next[type] = file;
                      else delete next[type];
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          </section>

          {isSuperAdminRecord ? (
            <section className="panel glass hr-staff-form__section hr-staff-form__section--wide">
              <h3>Zoho salesperson</h3>
              <p className="hr-staff-form__section-hint text-muted text-sm">
                Link Zoho salespersons to this Super Admin for dealer / order assignment.
              </p>
              <ZohoSalespersonPicker
                links={zohoLinks}
                onChange={setZohoLinks}
                excludeUid={uid ?? null}
                loadEnabled
                disabled={submitting}
              />
            </section>
          ) : (
            <section className="panel glass hr-staff-form__section hr-staff-form__section--wide">
              <h3>Access</h3>
              <StaffRoleEditor
                value={roleDraft}
                onChange={setRoleDraft}
                roles={staffRoles}
                excludeUid={uid ?? null}
                zohoManageHref={`${basePath}/dealers?tab=salespersons`}
                disabled={submitting}
              />
            </section>
          )}
        </div>

        <div className="hr-staff-form__actions">
          <Link to={isEdit && uid ? `${basePath}/hr/staff/${uid}` : `${basePath}/hr/staff`} className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <Save size={16} />
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create staff'}
          </button>
        </div>
      </form>
    </div>
  );
};
