import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { RefreshCw, Search, Users } from 'lucide-react';
import { db } from '../../firebase';
import { fetchStaffRoles } from '../../lib/staffRoles';
import { formatAadharDisplay, readHrProfileFromDoc } from '../../lib/hrStaff';
import { HrStaffPhoto } from '../../components/hr/HrStaffPhoto';
import { resolveProfileLogin } from '../../lib/profileLogin';
import type { FirestoreUserDoc, UserRecord } from '../../types';
import { normalizeRole } from '../../types';
import { STAFF_DEPARTMENTS, STAFF_DEPARTMENT_LABELS, type StaffDepartment } from '../../types/staff-access';

type HrStaffListPageProps = {
  basePath: string;
};

export const HrStaffListPage: React.FC<HrStaffListPageProps> = ({ basePath }) => {
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all' | 'super_admin'>('all');

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const staff = snap.docs
        .map(d => {
          const data = d.data() as FirestoreUserDoc;
          const role = normalizeRole(String(data.role ?? ''));
          // Include promoted super admins so HR can still edit profile / photo / Zoho links.
          if (role !== 'staff' && role !== 'super_admin') return null;
          return { uid: d.id, ...data, role } as UserRecord;
        })
        .filter((u): u is UserRecord => u !== null)
        .sort((a, b) => {
          // Super admins after staff within the same name sort — still alphabetical overall.
          return a.displayName.localeCompare(b.displayName);
        });
      setRecords(staff);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStaff();
    void fetchStaffRoles().then(roles => {
      setRoleNames(Object.fromEntries(roles.map(r => [r.id, r.name])));
    });
  }, [fetchStaff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter(record => {
      if (deptFilter === 'super_admin') {
        if (record.role !== 'super_admin') return false;
      } else if (deptFilter !== 'all') {
        // Department chips are staff-only.
        if (record.role !== 'staff') return false;
        if ((record.staffDepartment ?? 'admin') !== deptFilter) return false;
      }
      if (!q) return true;
      const hr = readHrProfileFromDoc(record);
      const login = resolveProfileLogin(record);
      return (
        record.displayName.toLowerCase().includes(q)
        || (login?.value ?? '').includes(q)
        || (hr.hrEmployeeId ?? '').toLowerCase().includes(q)
        || (record.phone ?? '').includes(q)
        || (record.role === 'super_admin' && 'super admin'.includes(q))
      );
    });
  }, [deptFilter, records, search]);

  return (
    <div className="hr-staff-list">
      <div className="hr-staff-list__toolbar panel glass">
        <div className="hr-staff-list__search">
          <Search size={16} aria-hidden />
          <input
            className="input-field"
            placeholder="Search staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void fetchStaff()}>
          <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
        </button>
      </div>

      <div className="hr-staff-list__filters">
        <button
          type="button"
          className={`hr-staff-list__filter ${deptFilter === 'all' ? 'is-active' : ''}`}
          onClick={() => setDeptFilter('all')}
        >
          All
        </button>
        {STAFF_DEPARTMENTS.map(dept => (
          <button
            key={dept}
            type="button"
            className={`hr-staff-list__filter ${deptFilter === dept ? 'is-active' : ''}`}
            onClick={() => setDeptFilter(dept)}
          >
            {STAFF_DEPARTMENT_LABELS[dept]}
          </button>
        ))}
        <button
          type="button"
          className={`hr-staff-list__filter ${deptFilter === 'super_admin' ? 'is-active' : ''}`}
          onClick={() => setDeptFilter('super_admin')}
        >
          Super Admin
        </button>
      </div>

      {loading && records.length === 0 ? (
        <p className="text-muted text-sm">Loading staff…</p>
      ) : filtered.length === 0 ? (
        <div className="hr-staff-list__empty panel glass">
          <Users size={36} aria-hidden />
          <p className="text-muted text-sm">No staff found.</p>
        </div>
      ) : (
        <div className="hr-staff-list__grid">
          {filtered.map(record => {
            const hr = readHrProfileFromDoc(record);
            const login = resolveProfileLogin(record);
            const aadhar = record.aadhar ?? (login?.type === 'aadhar' ? login.value : null);
            return (
              <Link
                key={record.uid}
                to={`${basePath}/hr/staff/${record.uid}`}
                className="hr-staff-list__card panel glass"
              >
                <div className="hr-staff-list__card-head">
                  {hr.hrPhotoStoragePath || hr.hrPhotoUrl ? (
                    <HrStaffPhoto
                      userId={record.uid}
                      photo={record}
                      className="hr-staff-list__photo"
                      placeholderClassName="hr-staff-list__photo hr-staff-list__photo--placeholder"
                    />
                  ) : (
                    <div className="hr-staff-list__photo hr-staff-list__photo--placeholder">
                      <Users size={20} />
                    </div>
                  )}
                  <div>
                    <strong>{record.displayName}</strong>
                    <span className="text-muted text-sm">
                      {hr.hrDesignation
                        || (record.role === 'super_admin' ? 'Super Admin' : null)
                        || (record.staffRoleId && roleNames[record.staffRoleId])
                        || 'Staff'}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted">
                  {aadhar ? formatAadharDisplay(aadhar) : '—'}
                  {record.phone ? ` · ${record.phone}` : ''}
                </p>
                <div className="hr-staff-list__card-meta">
                  <span className={`hr-staff-list__status ${record.active === false ? 'is-inactive' : ''}`}>
                    {record.active === false ? 'Inactive' : 'Active'}
                  </span>
                  {record.role === 'super_admin' ? (
                    <span className="hr-staff-list__sa-badge">Super Admin</span>
                  ) : null}
                  {(record.zohoSalespersonIds?.length || record.zohoSalespersonId) ? (
                    <span
                      className="hr-staff-list__zoho-badge"
                      title={
                        (record.zohoSalespersonIds?.length
                          ? record.zohoSalespersonIds.join(', ')
                          : record.zohoSalespersonId) || undefined
                      }
                    >
                      Zoho linked
                      {record.zohoSalespersonIds && record.zohoSalespersonIds.length > 1
                        ? ` · ${record.zohoSalespersonIds.length}`
                        : ''}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
