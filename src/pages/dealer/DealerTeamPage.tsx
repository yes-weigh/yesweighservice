import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Camera, Eye, EyeOff, Pencil, Plus, User, X } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { registerUser, resetDealerStaffPassword, updateUserProfile } from '../../lib/userAdmin';
import { uploadDealerStaffPhoto } from '../../lib/dealerStaffPhoto';
import {
  isValidAadhar,
  isValidPhone,
  normalizeAadhar,
  normalizePhone,
} from '../../lib/loginAuth';
import { ageYearsFromDob, formatAadharDisplay } from '../../lib/hrStaff';
import { HrStaffPhoto } from '../../components/hr/HrStaffPhoto';
import { authErrorMessage } from '../../lib/authErrors';
import { useCatalogPageHeader, useTopBarAction } from '../../context/PageHeaderContext';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { BLOOD_GROUPS, normalizeRole } from '../../types';
import type { StaffDepartment } from '../../types/staff-access';

const LEVELS: Array<{ id: Extract<StaffDepartment, 'sales' | 'service'>; label: string }> = [
  { id: 'sales', label: 'Sales' },
  { id: 'service', label: 'Service' },
];

type DealerTeamId = 'sales' | 'service';

function teamsFromRecord(record: UserRecord): DealerTeamId[] {
  const stored = Array.isArray(record.dealerTeams)
    ? record.dealerTeams.filter((team): team is DealerTeamId => team === 'sales' || team === 'service')
    : [];
  if (stored.length) return [...new Set(stored)];
  if (record.staffDepartment === 'service') return ['service'];
  if (record.staffDepartment === 'sales') return ['sales'];
  return ['sales'];
}

function primaryDepartment(teams: DealerTeamId[]): 'sales' | 'service' {
  return teams.includes('service') ? 'service' : 'sales';
}

function levelLabel(department: string | undefined): string | null {
  if (department === 'sales') return 'Sales';
  if (department === 'service') return 'Service';
  return null;
}

function revokePreview(url: string | null) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

function aadharFromRecord(record: UserRecord): string {
  return normalizeAadhar(
    record.aadhar || (record.loginIdType === 'aadhar' ? record.loginId : '') || '',
  );
}

export const DealerTeamPage: React.FC = () => {
  const { user } = useAuth();
  useCatalogPageHeader({ title: 'Team' });
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [teams, setTeams] = useState<DealerTeamId[]>([]);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [aadhar, setAadhar] = useState('');
  const [dob, setDob] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const dealerAccountUid = user?.role === 'dealer'
    ? user.uid
    : (user?.dealerId?.trim() || null);
  const canCreate = user?.role === 'dealer';
  const isEditing = Boolean(editingUid);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const age = ageYearsFromDob(dob);
  const shownPhoto = photoPreview || existingPhotoUrl;

  const fetchStaff = useCallback(async () => {
    if (!dealerAccountUid) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('dealerId', '==', dealerAccountUid)),
      );
      const staff = snap.docs
        .map(d => {
          const data = d.data() as FirestoreUserDoc;
          const role = normalizeRole(String(data.role ?? ''));
          if (role !== 'dealer_staff') return null;
          return { uid: d.id, ...data, role } as UserRecord;
        })
        .filter((row): row is UserRecord => row !== null)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRecords(staff);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [dealerAccountUid]);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  const resetForm = useCallback(() => {
    setEditingUid(null);
    setTeams([]);
    setName('');
    setMobile('');
    setAadhar('');
    setDob('');
    setBloodGroup('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirm(false);
    setPhotoFile(null);
    setExistingPhotoUrl(null);
    setPhotoPreview(prev => {
      revokePreview(prev);
      return null;
    });
    setError('');
  }, []);

  const openForm = useCallback(() => {
    resetForm();
    setFormOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((record: UserRecord) => {
    setPhotoPreview(prev => {
      revokePreview(prev);
      return null;
    });
    setEditingUid(record.uid);
    setTeams(teamsFromRecord(record));
    setName(record.displayName ?? '');
    setMobile(normalizePhone(record.phone ?? ''));
    setAadhar(aadharFromRecord(record));
    setDob(record.hrDateOfBirth?.slice(0, 10) ?? '');
    setBloodGroup(record.hrBloodGroup ?? '');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirm(false);
    setPhotoFile(null);
    setExistingPhotoUrl(record.hrPhotoUrl ?? null);
    setError('');
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    if (submitting) return;
    resetForm();
    setFormOpen(false);
  }, [resetForm, submitting]);

  const addButton = useMemo(
    () => (
      <button
        type="button"
        className="top-bar__action-btn top-bar__action-btn--primary dealer-team__add-btn"
        onClick={openForm}
      >
        <Plus size={16} strokeWidth={2.4} />
        Add team
      </button>
    ),
    [openForm],
  );

  useTopBarAction(addButton, canCreate && !formOpen);

  useEffect(() => {
    if (!formOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [formOpen]);

  const onPhotoPick = (file: File | null) => {
    setPhotoPreview(prev => {
      revokePreview(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setPhotoFile(file);
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !canCreate) return;
    setError('');

    const displayName = name.trim();
    if (!displayName) {
      setError('Enter name.');
      return;
    }
    if (!teams.length) {
      setError('Select Sales, Service, or both.');
      return;
    }
    const phone = normalizePhone(mobile);
    if (!isValidPhone(phone)) {
      setError('Enter a 10-digit mobile number.');
      return;
    }
    const aadharId = normalizeAadhar(aadhar);
    if (!isValidAadhar(aadharId)) {
      setError('Enter a 12-digit Aadhaar number.');
      return;
    }
    if (!dob || age == null) {
      setError('Enter a valid date of birth.');
      return;
    }
    if (!BLOOD_GROUPS.includes(bloodGroup as (typeof BLOOD_GROUPS)[number])) {
      setError('Select blood group.');
      return;
    }
    if (!isEditing) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (!photoFile) {
        setError('Upload a photo.');
        return;
      }
    } else if (password || confirmPassword) {
      if (password.length < 6) {
        setError('New password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editingUid) {
        await updateUserProfile(db, editingUid, {
          displayName,
          phone,
          staffDepartment: primaryDepartment(teams),
          dealerTeams: teams,
          hrDateOfBirth: dob,
          hrBloodGroup: bloodGroup,
        });
        if (photoFile) {
          const uploaded = await uploadDealerStaffPhoto(user.uid, editingUid, photoFile);
          await updateUserProfile(db, editingUid, {
            hrPhotoStoragePath: uploaded.storagePath,
            hrPhotoUrl: uploaded.url,
          });
        }
        if (password) {
          await resetDealerStaffPassword(editingUid, password);
        }
      } else {
        const uid = await registerUser(db, {
          loginId: aadharId,
          password,
          displayName,
          role: 'dealer_staff',
          phone,
          dealerId: user.uid,
          staffDepartment: primaryDepartment(teams),
          dealerTeams: teams,
          dealerTier: user.dealerTier ?? 'standard',
          dealerAccessMode: user.dealerAccessMode ?? 'tier',
          dealerPermissions: user.dealerPermissions ?? [],
          createdByUid: user.uid,
          hr: {
            hrDateOfBirth: dob,
            hrBloodGroup: bloodGroup,
          },
        });
        const uploaded = await uploadDealerStaffPhoto(user.uid, uid, photoFile!);
        await updateUserProfile(db, uid, {
          hrPhotoStoragePath: uploaded.storagePath,
          hrPhotoUrl: uploaded.url,
        });
      }
      resetForm();
      setFormOpen(false);
      await fetchStaff();
    } catch (err) {
      setError(authErrorMessage(err, isEditing ? 'Could not save staff.' : 'Could not create staff.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="page-content fade-in dealer-team">
      <div className="dealer-team__list">
        {loading && records.length === 0 ? (
          <div className="loader-ring mx-auto" />
        ) : records.length === 0 ? (
          <div className="dealer-team__empty panel glass">
            <p>No team members yet.</p>
            {canCreate ? <p>Tap Add team to add staff.</p> : null}
          </div>
        ) : (
          records.map(record => {
            const departments = teamsFromRecord(record);
            const aadharValue = record.aadhar
              || (record.loginIdType === 'aadhar' ? record.loginId : null);
            const years = ageYearsFromDob(record.hrDateOfBirth);
            return (
              <article key={record.uid} className="dealer-team__card panel glass">
                <HrStaffPhoto
                  userId={record.uid}
                  photo={record}
                  className="dealer-team__card-photo"
                  placeholderClassName="dealer-team__card-photo dealer-team__card-photo--placeholder"
                  iconSize={22}
                />
                <div className="dealer-team__card-body">
                  <div className="dealer-team__card-top">
                    <strong>{record.displayName}</strong>
                  </div>
                  {record.phone ? <p><span>Phone</span> {record.phone}</p> : null}
                  {aadharValue ? <p><span>Aadhaar</span> {formatAadharDisplay(aadharValue)}</p> : null}
                  {years != null || record.hrBloodGroup ? (
                    <p>
                      {[years != null ? `${years} yrs` : null, record.hrBloodGroup]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="dealer-team__card-side">
                  {departments.map(team => (
                    <span
                      key={team}
                      className={`dealer-team__badge dealer-team__badge--${team}`}
                    >
                      {levelLabel(team)}
                    </span>
                  ))}
                  {canCreate ? (
                    <button
                      type="button"
                      className="dealer-team__card-edit"
                      onClick={() => openEdit(record)}
                      aria-label="Edit"
                    >
                      <Pencil size={15} strokeWidth={2.2} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      {canCreate && formOpen ? (
      <div
        className="dealers-modal-backdrop dealer-team__backdrop"
        onClick={closeForm}
      >
        <div
        className="dealers-modal dealer-team__dialog"
          onClick={event => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dealer-team-add-title"
        >
          <div className="dealers-modal__header dealer-team__header">
            <div>
              <h2 id="dealer-team-add-title">{isEditing ? 'Edit team' : 'Add team'}</h2>
              <p className="dealer-team__subtitle">
                {isEditing ? 'Update staff details' : 'New staff profile'}
              </p>
            </div>
            <button
              type="button"
              className="dealers-modal__close"
              onClick={closeForm}
              disabled={submitting}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
      <form className="dealer-team__form" onSubmit={handleSubmit}>
        <label className="dealer-team__avatar" aria-label={shownPhoto ? 'Change photo' : 'Add photo'}>
          {shownPhoto ? (
            <img src={shownPhoto} alt="" className="dealer-team__avatar-img" />
          ) : (
            <span className="dealer-team__avatar-empty">
              <User size={28} strokeWidth={1.6} aria-hidden />
            </span>
          )}
          <span className="dealer-team__avatar-cam" aria-hidden>
            <Camera size={13} strokeWidth={2.2} />
          </span>
          <span className="dealer-team__avatar-hint">
              {shownPhoto ? 'Change photo' : 'Add photo'}
            {isEditing ? null : <span className="form-label__required"> *</span>}
          </span>
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={submitting}
            onChange={e => {
              onPhotoPick(e.target.files?.[0] ?? null);
              e.currentTarget.value = '';
            }}
          />
        </label>

        <div className="dealer-team__field">
          <span>Sales / Service</span>
          <div className="dealer-team__levels" role="group" aria-label="Sales and Service">
            {LEVELS.map(item => {
              const on = teams.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`dealer-team__level${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    setTeams(current => (
                      current.includes(item.id)
                        ? current.filter(team => team !== item.id)
                        : [...current, item.id]
                    ));
                    setError('');
                  }}
                  disabled={submitting}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="dealer-team__field">
          <span>Name</span>
          <input
            className="input-field"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            placeholder="Full name"
            disabled={submitting}
          />
        </label>

        <label className="dealer-team__field">
          <span>Aadhaar number</span>
          <input
            className="input-field"
            inputMode="numeric"
            value={aadhar}
            onChange={e => setAadhar(normalizeAadhar(e.target.value))}
            placeholder="12-digit number"
            disabled={submitting || isEditing}
            readOnly={isEditing}
          />
        </label>

        <label className="dealer-team__field">
          <span>Phone number</span>
          <input
            className="input-field"
            inputMode="numeric"
            autoComplete="tel"
            value={mobile}
            onChange={e => setMobile(normalizePhone(e.target.value))}
            placeholder="10-digit mobile"
            disabled={submitting}
          />
        </label>

        <label className="dealer-team__field">
          <span className="dealer-team__field-head">
            Date of birth
            <span className={`dealer-team__age${age == null ? '' : ' is-on'}`}>
              {age == null ? 'Age' : `${age} yrs`}
            </span>
          </span>
          <input
            className="input-field"
            type="date"
            max={today}
            value={dob}
            onChange={e => setDob(e.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="dealer-team__field">
          <span>Blood group</span>
          <select
            className="input-field"
            value={bloodGroup}
            onChange={e => setBloodGroup(e.target.value)}
            disabled={submitting}
          >
            <option value="">Select</option>
            {BLOOD_GROUPS.map(group => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>
        </label>

        <label className="dealer-team__field">
          <span>{isEditing ? 'Reset password' : 'Password'}</span>
          <span className="input-icon-wrap">
            <input
              className="input-field"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={isEditing ? 'Leave blank to keep' : 'Min. 6 characters'}
              disabled={submitting}
            />
            <button
              type="button"
              className="input-icon-right"
              onClick={() => setShowPassword(on => !on)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        <label className="dealer-team__field">
          <span>{isEditing ? 'Confirm new password' : 'Confirm password'}</span>
          <span className="input-icon-wrap">
            <input
              className="input-field"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={isEditing ? 'Repeat new password' : 'Repeat password'}
              disabled={submitting}
            />
            <button
              type="button"
              className="input-icon-right"
              onClick={() => setShowConfirm(on => !on)}
              aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
            >
              {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        {error ? <p className="dealer-team__error">{error}</p> : null}

        <div className="dealer-team__footer">
          <button type="submit" className="btn btn-primary dealer-team__create" disabled={submitting}>
            {submitting
              ? (isEditing ? 'Saving…' : 'Creating…')
              : (isEditing ? 'Save' : 'Create')}
          </button>
        </div>
      </form>
        </div>
      </div>
      ) : null}
    </div>
  );
};
