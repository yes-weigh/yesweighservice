import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, RefreshCw, Search } from 'lucide-react';
import { buildStaffWorkReport } from '../../lib/hrWorkReport';
import {
  currentWorkReportPeriod,
  periodLabel,
  type WorkReportPeriod,
} from '../../types/hr-work-report';
import {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  type StaffDepartment,
} from '../../types/staff-access';
import type { StaffWorkSummary } from '../../types/hr-work-report';

type HrWorkReportPageProps = {
  basePath: string;
};

export const HrWorkReportPage: React.FC<HrWorkReportPageProps> = ({ basePath }) => {
  const [period, setPeriod] = useState<WorkReportPeriod>(currentWorkReportPeriod);
  const [rows, setRows] = useState<StaffWorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');

  const monthValue = `${period.year}-${String(period.month).padStart(2, '0')}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await buildStaffWorkReport(period));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (deptFilter !== 'all' && row.department !== deptFilter) return false;
      if (!q) return true;
      return (
        row.displayName.toLowerCase().includes(q)
        || (row.employeeId ?? '').toLowerCase().includes(q)
        || (row.designation ?? '').toLowerCase().includes(q)
      );
    });
  }, [deptFilter, rows, search]);

  const totals = useMemo(() => ({
    dealers: filtered.reduce((sum, r) => sum + r.dealersManaged, 0),
    support: filtered.reduce((sum, r) => sum + r.supportResponses, 0),
    onboarded: filtered.reduce((sum, r) => sum + r.staffOnboarded, 0),
  }), [filtered]);

  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    if (year && month) setPeriod({ year, month });
  };

  return (
    <div className="hr-work-report">
      <div className="hr-work-report__intro panel glass">
        <BarChart3 size={20} aria-hidden />
        <div>
          <p className="text-sm">
            Monthly activity for YesOne staff — dealer KAM accounts, warranty &amp; support
            replies, and new staff onboarded in the portal.
          </p>
        </div>
      </div>

      <div className="hr-staff-list__toolbar panel glass">
        <label className="hr-work-report__month">
          <span className="text-sm text-muted">Period</span>
          <input
            type="month"
            className="input-field"
            value={monthValue}
            onChange={e => handleMonthChange(e.target.value)}
          />
        </label>
        <div className="hr-staff-list__search">
          <Search size={16} aria-hidden />
          <input
            className="input-field"
            placeholder="Search staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
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

      <div className="hr-work-report__summary panel glass">
        <div>
          <span className="text-muted text-sm">Period</span>
          <strong>{periodLabel(period)}</strong>
        </div>
        <div>
          <span className="text-muted text-sm">Dealer accounts (KAM)</span>
          <strong>{totals.dealers}</strong>
        </div>
        <div>
          <span className="text-muted text-sm">Support replies</span>
          <strong>{totals.support}</strong>
        </div>
        <div>
          <span className="text-muted text-sm">Staff onboarded</span>
          <strong>{totals.onboarded}</strong>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-muted text-sm">Loading work report…</p>
      ) : filtered.length === 0 ? (
        <div className="hr-staff-list__empty panel glass">
          <BarChart3 size={36} aria-hidden />
          <p className="text-muted text-sm">No staff activity for this period.</p>
        </div>
      ) : (
        <div className="hr-work-report__table-wrap panel glass">
          <table className="hr-work-report__table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Department</th>
                <th>Dealers (KAM)</th>
                <th>Support replies</th>
                <th>Staff added</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.staffUid} className={row.active ? '' : 'is-inactive'}>
                  <td>
                    <Link to={`${basePath}/hr/staff/${row.staffUid}`} className="hr-work-report__name">
                      {row.displayName}
                    </Link>
                    {row.designation && (
                      <span className="text-muted text-sm">{row.designation}</span>
                    )}
                  </td>
                  <td>{STAFF_DEPARTMENT_LABELS[row.department]}</td>
                  <td>{row.dealersManaged}</td>
                  <td>{row.supportResponses}</td>
                  <td>{row.staffOnboarded}</td>
                  <td>
                    <span className="hr-work-report__score">{row.activityScore}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
