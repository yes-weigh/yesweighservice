import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, RefreshCw, Save, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchHrHolidays, holidaysInMonth } from '../../lib/hrHolidays';
import {
  buildMonthDayCells,
  buildSalaryCalculationRows,
  computeSalaryCalc,
  formatInr,
  saveSalaryMonth,
  type HrSalaryStaffRow,
} from '../../lib/hrSalary';
import { canManageHr } from '../../lib/staffAccess';
import type { HrHoliday } from '../../types/hr-holiday';
import {
  currentSalaryPeriod,
  salaryPeriodKey,
  salaryPeriodLabel,
  type HrSalaryPeriod,
} from '../../types/hr-salary';
import {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  type StaffDepartment,
} from '../../types/staff-access';

type Props = {
  basePath: string;
};

type DraftRow = {
  monthlySalary: string;
  leaveDates: string[];
  dirty: boolean;
  saving: boolean;
  error: string;
};

function emptyDraft(row: HrSalaryStaffRow): DraftRow {
  return {
    monthlySalary: row.monthlySalary > 0 ? String(row.monthlySalary) : '',
    leaveDates: [...row.leaveDates],
    dirty: false,
    saving: false,
    error: '',
  };
}

export const HrSalaryCalculationPage: React.FC<Props> = ({ basePath: _basePath }) => {
  const { user } = useAuth();
  const canEdit = canManageHr(user);
  const [period, setPeriod] = useState<HrSalaryPeriod>(currentSalaryPeriod);
  const [rows, setRows] = useState<HrSalaryStaffRow[]>([]);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');
  const [loadError, setLoadError] = useState('');

  const monthValue = salaryPeriodKey(period);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const holidayList = await fetchHrHolidays();
      const nextRows = await buildSalaryCalculationRows(period, holidayList);
      setHolidays(holidayList);
      setRows(nextRows);
      setDrafts(Object.fromEntries(nextRows.map(r => [r.staffUid, emptyDraft(r)])));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load salary data.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthHolidays = useMemo(
    () => holidaysInMonth(holidays, period.year, period.month),
    [holidays, period.month, period.year],
  );

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

  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    if (year && month) setPeriod({ year, month });
  };

  const updateDraft = (uid: string, patch: Partial<DraftRow>) => {
    setDrafts(prev => {
      const cur = prev[uid];
      if (!cur) return prev;
      return { ...prev, [uid]: { ...cur, ...patch, dirty: true, error: '' } };
    });
  };

  const liveCalc = (row: HrSalaryStaffRow) => {
    const draft = drafts[row.staffUid];
    if (!draft) return row.calc;
    const salary = Number.parseFloat(draft.monthlySalary) || 0;
    return computeSalaryCalc(salary, period, holidays, draft.leaveDates);
  };

  const toggleLeave = (uid: string, date: string, kind: string) => {
    if (!canEdit) return;
    if (kind === 'sunday' || kind === 'holiday') return;
    const draft = drafts[uid];
    if (!draft) return;
    const has = draft.leaveDates.includes(date);
    const leaveDates = has
      ? draft.leaveDates.filter(d => d !== date)
      : [...draft.leaveDates, date].sort();
    updateDraft(uid, { leaveDates });
  };

  const handleSave = async (uid: string) => {
    if (!canEdit || !user) return;
    const draft = drafts[uid];
    if (!draft) return;
    setDrafts(prev => ({
      ...prev,
      [uid]: { ...draft, saving: true, error: '' },
    }));
    try {
      const monthlySalary = Math.max(0, Number.parseFloat(draft.monthlySalary) || 0);
      await saveSalaryMonth(
        {
          uid,
          year: period.year,
          month: period.month,
          monthlySalary,
          leaveDates: draft.leaveDates,
        },
        user.uid,
      );
      setRows(prev => prev.map(row => {
        if (row.staffUid !== uid) return row;
        const leaveDates = [...draft.leaveDates];
        return {
          ...row,
          monthlySalary,
          leaveDates,
          calc: computeSalaryCalc(monthlySalary, period, holidays, leaveDates),
        };
      }));
      setDrafts(prev => ({
        ...prev,
        [uid]: {
          monthlySalary: monthlySalary > 0 ? String(monthlySalary) : '',
          leaveDates: [...draft.leaveDates],
          dirty: false,
          saving: false,
          error: '',
        },
      }));
    } catch (err) {
      setDrafts(prev => ({
        ...prev,
        [uid]: {
          ...draft,
          saving: false,
          error: err instanceof Error ? err.message : 'Save failed.',
        },
      }));
    }
  };

  return (
    <div className="hr-salary">
      <div className="hr-work-report__intro panel glass">
        <Calculator size={20} aria-hidden />
        <div>
          <p className="text-sm">
            Salary for {salaryPeriodLabel(period)}. Per-day rate = monthly ÷ (days in month − Sundays).
            Weekday holidays from the holiday calendar and marked leave days reduce payable days.
          </p>
          {monthHolidays.length > 0 && (
            <p className="text-sm text-muted hr-salary__holiday-note">
              Holidays this month:{' '}
              {monthHolidays.map(h => `${h.date.slice(8)} ${h.name}`).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="hr-staff-list__toolbar panel glass">
        <label className="hr-work-report__month">
          <span className="text-sm text-muted">Month</span>
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
        <select
          className="input-field hr-salary__dept"
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value as StaffDepartment | 'all')}
          aria-label="Department"
        >
          <option value="all">All departments</option>
          {STAFF_DEPARTMENTS.map(dept => (
            <option key={dept} value={dept}>{STAFF_DEPARTMENT_LABELS[dept]}</option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
        </button>
      </div>

      {loadError && <p className="hr-salary__error panel glass">{loadError}</p>}

      <div className="hr-work-report__table-wrap panel glass">
        <table className="hr-work-report__table hr-salary__table">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Monthly salary</th>
              <th>Per day</th>
              <th>Leave</th>
              <th>Holidays</th>
              <th>Payable days</th>
              <th>Earned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-muted">Loading…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted">No staff found.</td>
              </tr>
            )}
            {!loading && filtered.map(row => {
              const draft = drafts[row.staffUid] ?? emptyDraft(row);
              const calc = liveCalc(row);
              const expanded = expandedUid === row.staffUid;
              const cells = buildMonthDayCells(period, holidays, draft.leaveDates);
              return (
                <React.Fragment key={row.staffUid}>
                  <tr className={row.active ? undefined : 'is-inactive'}>
                    <td>
                      <div className="hr-work-report__name">{row.displayName}</div>
                      <div className="text-sm text-muted">
                        {[row.employeeId, row.designation, STAFF_DEPARTMENT_LABELS[row.department]]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        className="input-field hr-salary__salary-input"
                        value={draft.monthlySalary}
                        disabled={!canEdit}
                        onChange={e => updateDraft(row.staffUid, { monthlySalary: e.target.value })}
                        aria-label={`Monthly salary for ${row.displayName}`}
                      />
                    </td>
                    <td>{formatInr(calc.perDaySalary)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setExpandedUid(expanded ? null : row.staffUid)}
                      >
                        {calc.leaveDays} day{calc.leaveDays === 1 ? '' : 's'}
                      </button>
                    </td>
                    <td>{calc.weekdayHolidays}</td>
                    <td>
                      {calc.payableDays}
                      <span className="text-muted text-sm"> / {calc.rateDays}</span>
                    </td>
                    <td>{formatInr(calc.earnedSalary)}</td>
                    <td>
                      {canEdit && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!draft.dirty || draft.saving}
                          onClick={() => void handleSave(row.staffUid)}
                        >
                          <Save size={14} aria-hidden />
                          {draft.saving ? 'Saving…' : 'Save'}
                        </button>
                      )}
                      {draft.error && <p className="hr-salary__row-error">{draft.error}</p>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="hr-salary__expand-row">
                      <td colSpan={8}>
                        <div className="hr-salary__legend text-sm text-muted">
                          <span><i className="hr-salary__swatch is-working" /> Working</span>
                          <span><i className="hr-salary__swatch is-leave" /> Leave (click to toggle)</span>
                          <span><i className="hr-salary__swatch is-sunday" /> Sunday</span>
                          <span><i className="hr-salary__swatch is-holiday" /> Holiday</span>
                        </div>
                        <div className="hr-salary__days" role="group" aria-label="Leave calendar">
                          {cells.map(cell => (
                            <button
                              key={cell.date}
                              type="button"
                              title={
                                cell.kind === 'holiday'
                                  ? cell.holidayName
                                  : cell.kind === 'sunday'
                                    ? 'Sunday'
                                    : cell.date
                              }
                              className={`hr-salary__day is-${cell.kind}`}
                              disabled={!canEdit || cell.kind === 'sunday' || cell.kind === 'holiday'}
                              onClick={() => toggleLeave(row.staffUid, cell.date, cell.kind)}
                            >
                              {cell.day}
                            </button>
                          ))}
                        </div>
                        <p className="text-sm text-muted hr-salary__math">
                          Rate days {calc.rateDays} (month {calc.daysInMonth} − {calc.sundays} Sundays)
                          · − {calc.weekdayHolidays} holiday{calc.weekdayHolidays === 1 ? '' : 's'}
                          · − {calc.leaveDays} leave
                          = {calc.payableDays} payable × {formatInr(calc.perDaySalary)}
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
