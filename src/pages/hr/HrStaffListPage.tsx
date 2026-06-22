import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { RefreshCw, Search, Users } from 'lucide-react';
import { db } from '../../firebase';
import { fetchStaffRoles } from '../../lib/staffRoles';
import { formatAadharDisplay, readHrProfileFromDoc } from '../../lib/hrStaff';
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
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');

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
    void fetchStaffRoles().then(roles => {
      setRoleNames(Object.fromEntries(roles.map(r => [r.id, r.name])));
    });
  }, [fetchStaff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter(record => {
      if (deptFilter !== 'all' && (record.staffDepartment ?? 'admin') !== deptFilter) return false;
      if (!q) return true;
      const hr = readHrProfileFromDoc(record);
      const login = resolveProfileLogin(record);
      return (
        record.displayName.toLowerCase().includes(q)
        || (login?.value ?? '').includes(q)
        || (hr.hrEmployeeId ?? '').toLowerCase().includes(q)
        || (record.phone ?? '').includes(q)
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
        {STAFF_DEPARTMENTS.map(dept => (
          <button
            key={dept}
            type="button"
            className={`hr-staff-list__filter ${deptFilter === dept ? 'is-active' : ''}`}
            onClick={() => setDeptFilter(prev => (prev === dept ? 'all' : dept))}
          >
            {STAFF_DEPARTMENT_LABELS[dept]}
          </button>
        ))}
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
                  {hr.hrPhotoUrl ? (
                    <img src={hr.hrPhotoUrl} alt="" className="hr-staff-list__photo" />
                  ) : (
                    <div className="hr-staff-list__photo hr-staff-list__photo--placeholder">
                      <Users size={20} />
                    </div>
                  )}
                  <div>
                    <strong>{record.displayName}</strong>
                    <span className="text-muted text-sm">
                      {hr.hrDesignation
                        || (record.staffRoleId && roleNames[record.staffRoleId])
                        || 'Staff'}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted">
                  {aadhar ? formatAadharDisplay(aadhar) : '—'}
                  {record.phone ? ` · ${record.phone}` : ''}
                </p>
                <span className={`hr-staff-list__status ${record.active === false ? 'is-inactive' : ''}`}>
                  {record.active === false ? 'Inactive' : 'Active'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
