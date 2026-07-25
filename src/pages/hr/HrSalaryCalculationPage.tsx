import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Plus, RefreshCw, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchHrHolidays, holidaysInMonth } from '../../lib/hrHolidays';
import {
  createPayrollEmployee,
  payrollEmployeeSalaryKey,
} from '../../lib/hrPayrollEmployees';
import {
  buildMonthDayCells,
  buildSalaryCalculationRows,
  computeSalaryCalc,
  createOvertimeEntry,
  formatInr,
  formatLeaveDays,
  formatOtHours,
  leaveKindForDate,
  overtimeEntryHours,
  saveSalaryMonth,
  type HrSalaryStaffRow,
} from '../../lib/hrSalary';
import { isLocalhostDev } from '../../lib/isLocalhost';
import { canViewHrSalary } from '../../lib/staffAccess';
import type { HrHoliday } from '../../types/hr-holiday';
import {
  currentSalaryPeriod,
  HR_SALARY_HOURS_PER_DAY,
  salaryPeriodKey,
  salaryPeriodLabel,
  type HrLeaveKind,
  type HrOvertimeEntry,
  type HrSalaryPeriod,
} from '../../types/hr-salary';
import {
  STAFF_DEPARTMENTS,
  STAFF_DEPARTMENT_LABELS,
  type StaffDepartment,
} from '../../types/staff-access';

const AUTOSAVE_MS = 550;

type Props = {
  basePath: string;
};

type DraftRow = {
  monthlySalary: string;
  leaveEntries: Array<{ date: string; kind: HrLeaveKind }>;
  overtimeEntries: HrOvertimeEntry[];
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string;
};

type NewPayrollForm = {
  displayName: string;
  designation: string;
  employeeId: string;
  department: StaffDepartment;
  monthlySalary: string;
};

const EMPTY_PAYROLL_FORM: NewPayrollForm = {
  displayName: '',
  designation: '',
  employeeId: '',
  department: 'admin',
  monthlySalary: '',
};

function emptyDraft(row: HrSalaryStaffRow): DraftRow {
  return {
    monthlySalary: row.monthlySalary > 0 ? String(row.monthlySalary) : '',
    leaveEntries: row.leaveEntries.map(e => ({ ...e })),
    overtimeEntries: row.overtimeEntries.map(e => ({ ...e })),
    dirty: false,
    saving: false,
    savedAt: null,
    error: '',
  };
}

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function isSundayDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

function DayAttendanceSheet({
  date,
  canEdit,
  canSetLeave,
  leaveKind,
  holidayName,
  entries,
  onClose,
  onSetLeave,
  onAddOt,
  onPatchOt,
  onRemoveOt,
}: {
  date: string;
  canEdit: boolean;
  canSetLeave: boolean;
  leaveKind: HrLeaveKind | null;
  holidayName: string | null;
  entries: HrOvertimeEntry[];
  onClose: () => void;
  onSetLeave: (kind: HrLeaveKind | null) => void;
  onAddOt: () => void;
  onPatchOt: (entryId: string, patch: Partial<Pick<HrOvertimeEntry, 'startTime' | 'endTime'>>) => void;
  onRemoveOt: (entryId: string) => void;
}) {
  const dayOtHours = entries.reduce(
    (sum, e) => sum + overtimeEntryHours(e.startTime, e.endTime),
    0,
  );
  const dayKindLabel = isSundayDate(date)
    ? 'Sunday'
    : holidayName
      ? `Holiday · ${holidayName}`
      : leaveKind === 'full'
        ? 'Full-day leave'
        : leaveKind === 'half'
          ? 'Half-day leave'
          : 'Working day';

  return (
    <div
      className="hr-salary__day-sheet"
      role="region"
      aria-label={`Day attendance for ${formatDayLabel(date)}`}
    >
      <header className="hr-salary__day-sheet-head">
        <div>
          <h4 className="hr-salary__day-sheet-title">{formatDayLabel(date)}</h4>
          <p className="text-sm text-muted hr-salary__day-sheet-sub">{dayKindLabel}</p>
        </div>
        <button
          type="button"
          className="hr-salary__day-sheet-close"
          aria-label="Close day editor"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="hr-salary__day-sheet-body">
        <section className="hr-salary__day-sheet-section">
          <div className="hr-salary__day-sheet-section-head">
            <span>Leave</span>
            {!canSetLeave ? (
              <span className="text-sm text-muted">N/A</span>
            ) : null}
          </div>
          {canSetLeave ? (
            <div className="hr-salary__leave-seg" role="group" aria-label="Leave type">
              <button
                type="button"
                className={!leaveKind ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave(null)}
              >
                Working
              </button>
              <button
                type="button"
                className={leaveKind === 'half' ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave('half')}
              >
                Half day
              </button>
              <button
                type="button"
                className={leaveKind === 'full' ? 'is-active' : ''}
                disabled={!canEdit}
                onClick={() => onSetLeave('full')}
              >
                Full day
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted hr-salary__ot-empty">
              Sundays and holidays are already non-payable.
            </p>
          )}
        </section>

        <section className="hr-salary__day-sheet-section">
          <div className="hr-salary__day-sheet-section-head">
            <span>Overtime shifts</span>
            <span className="text-muted">{formatOtHours(dayOtHours)}</span>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm text-muted hr-salary__ot-empty">
              No OT yet. Add morning and/or night shifts.
            </p>
          ) : (
            <ul className="hr-salary__ot-list">
              {entries.map(entry => (
                <li key={entry.id} className="hr-salary__ot-row">
                  <label>
                    <span>Start</span>
                    <input
                      type="time"
                      className="input-field"
                      value={entry.startTime}
                      disabled={!canEdit}
                      onChange={e => onPatchOt(entry.id, { startTime: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="time"
                      className="input-field"
                      value={entry.endTime}
                      disabled={!canEdit}
                      onChange={e => onPatchOt(entry.id, { endTime: e.target.value })}
                    />
                  </label>
                  <span className="hr-salary__ot-hours">
                    {formatOtHours(overtimeEntryHours(entry.startTime, entry.endTime))}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm hr-salary__ot-remove"
                      aria-label="Remove overtime shift"
                      onClick={() => onRemoveOt(entry.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm hr-salary__ot-add"
              onClick={onAddOt}
            >
              <Plus size={14} aria-hidden />
              Add OT shift
            </button>
          ) : null}
          <p className="text-sm text-muted hr-salary__ot-note">
            End earlier than start counts as overnight.
          </p>
        </section>
      </div>
    </div>
  );
}

export const HrSalaryCalculationPage: React.FC<Props> = ({ basePath: _basePath }) => {
  const { user } = useAuth();
  const canAccess = canViewHrSalary(user) && isLocalhostDev();
  const canEdit = canAccess;
  const [period, setPeriod] = useState<HrSalaryPeriod>(currentSalaryPeriod);
  const [rows, setRows] = useState<HrSalaryStaffRow[]>([]);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');
  const [loadError, setLoadError] = useState('');
  const [showAddPayroll, setShowAddPayroll] = useState(false);
  const [payrollForm, setPayrollForm] = useState<NewPayrollForm>(EMPTY_PAYROLL_FORM);
  const [addingPayroll, setAddingPayroll] = useState(false);
  const [addPayrollError, setAddPayrollError] = useState('');
  const autosaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const draftsRef = useRef(drafts);
  const periodRef = useRef(period);
  const holidaysRef = useRef(holidays);
  const skipAutosaveRef = useRef(false);

  draftsRef.current = drafts;
  periodRef.current = period;
  holidaysRef.current = holidays;

  const monthValue = salaryPeriodKey(period);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    skipAutosaveRef.current = true;
    try {
      const holidayList = await fetchHrHolidays();
      const nextRows = await buildSalaryCalculationRows(period, holidayList);
      setHolidays(holidayList);
      setRows(nextRows);
      setDrafts(Object.fromEntries(nextRows.map(r => [r.staffUid, emptyDraft(r)])));
      setSelectedDate(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load salary data.');
    } finally {
      setLoading(false);
      // Allow autosave after drafts settle from load.
      window.setTimeout(() => {
        skipAutosaveRef.current = false;
      }, 0);
    }
  }, [period]);

  useEffect(() => {
    if (!canAccess) return;
    void load();
  }, [canAccess, load]);

  useEffect(() => () => {
    for (const timer of autosaveTimers.current.values()) clearTimeout(timer);
    autosaveTimers.current.clear();
  }, []);

  const persistDraft = useCallback(async (uid: string) => {
    if (!user || !canViewHrSalary(user)) return;
    const draft = draftsRef.current[uid];
    if (!draft || !draft.dirty) return;
    const periodNow = periodRef.current;
    const holidaysNow = holidaysRef.current;
    setDrafts(prev => {
      const cur = prev[uid];
      if (!cur) return prev;
      return { ...prev, [uid]: { ...cur, saving: true, error: '' } };
    });
    try {
      const monthlySalary = Math.max(0, Number.parseFloat(draft.monthlySalary) || 0);
      const leaveEntries = draft.leaveEntries.map(e => ({ ...e }));
      const overtimeEntries = draft.overtimeEntries.map(e => ({ ...e }));
      await saveSalaryMonth(
        {
          uid,
          year: periodNow.year,
          month: periodNow.month,
          monthlySalary,
          leaveEntries,
          overtimeEntries,
        },
        user.uid,
      );
      setRows(prev => prev.map(row => {
        if (row.staffUid !== uid) return row;
        return {
          ...row,
          monthlySalary,
          leaveEntries,
          overtimeEntries,
          calc: computeSalaryCalc(
            monthlySalary,
            periodNow,
            holidaysNow,
            leaveEntries,
            overtimeEntries,
          ),
        };
      }));
      let stillDirty = false;
      setDrafts(prev => {
        const cur = prev[uid];
        if (!cur) return prev;
        // Another edit landed while saving — keep dirty for next autosave.
        stillDirty = (
          cur.monthlySalary !== (monthlySalary > 0 ? String(monthlySalary) : '')
          || JSON.stringify(cur.leaveEntries) !== JSON.stringify(leaveEntries)
          || JSON.stringify(cur.overtimeEntries) !== JSON.stringify(overtimeEntries)
        );
        return {
          ...prev,
          [uid]: {
            ...cur,
            dirty: stillDirty,
            saving: false,
            savedAt: Date.now(),
            error: '',
          },
        };
      });
      if (stillDirty) {
        window.setTimeout(() => {
          void persistDraft(uid);
        }, AUTOSAVE_MS);
      }
    } catch (err) {
      setDrafts(prev => {
        const cur = prev[uid];
        if (!cur) return prev;
        return {
          ...prev,
          [uid]: {
            ...cur,
            saving: false,
            error: err instanceof Error ? err.message : 'Autosave failed.',
          },
        };
      });
    }
  }, [user]);

  const scheduleAutosave = useCallback((uid: string) => {
    if (skipAutosaveRef.current || !canEdit) return;
    const existing = autosaveTimers.current.get(uid);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      autosaveTimers.current.delete(uid);
      void persistDraft(uid);
    }, AUTOSAVE_MS);
    autosaveTimers.current.set(uid, timer);
  }, [canEdit, persistDraft]);

  const monthHolidays = useMemo(
    () => holidaysInMonth(holidays, period.year, period.month),
    [holidays, period.month, period.year],
  );

  const holidayDateSet = useMemo(
    () => new Set(monthHolidays.map(h => h.date)),
    [monthHolidays],
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
    if (!canEdit) return;
    setDrafts(prev => {
      const cur = prev[uid];
      if (!cur) return prev;
      return { ...prev, [uid]: { ...cur, ...patch, dirty: true, error: '' } };
    });
    scheduleAutosave(uid);
  };

  const liveCalc = (row: HrSalaryStaffRow) => {
    const draft = drafts[row.staffUid];
    if (!draft) return row.calc;
    const salary = Number.parseFloat(draft.monthlySalary) || 0;
    return computeSalaryCalc(
      salary,
      period,
      holidays,
      draft.leaveEntries,
      draft.overtimeEntries,
    );
  };

  const selectDay = (uid: string, date: string) => {
    if (expandedUid !== uid) setExpandedUid(uid);
    setSelectedDate(prev => (expandedUid === uid && prev === date ? null : date));
  };

  const setLeaveForDay = (uid: string, date: string, kind: HrLeaveKind | null) => {
    if (!canEdit) return;
    if (isSundayDate(date) || holidayDateSet.has(date)) return;
    const draft = drafts[uid];
    if (!draft) return;
    const leaveEntries = draft.leaveEntries.filter(e => e.date !== date);
    if (kind) leaveEntries.push({ date, kind });
    leaveEntries.sort((a, b) => a.date.localeCompare(b.date));
    updateDraft(uid, { leaveEntries });
  };

  const addOtEntry = (uid: string, date: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    const existing = draft.overtimeEntries.filter(e => e.date === date);
    const startTime = existing.length === 0 ? '18:00' : '06:00';
    const endTime = existing.length === 0 ? '20:00' : '08:00';
    updateDraft(uid, {
      overtimeEntries: [...draft.overtimeEntries, createOvertimeEntry(date, startTime, endTime)],
    });
  };

  const patchOtEntry = (
    uid: string,
    entryId: string,
    patch: Partial<Pick<HrOvertimeEntry, 'startTime' | 'endTime'>>,
  ) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      overtimeEntries: draft.overtimeEntries.map(entry => (
        entry.id === entryId ? { ...entry, ...patch } : entry
      )),
    });
  };

  const removeOtEntry = (uid: string, entryId: string) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      overtimeEntries: draft.overtimeEntries.filter(entry => entry.id !== entryId),
    });
  };

  const handleAddPayroll = async () => {
    if (!user || !canEdit || addingPayroll) return;
    const name = payrollForm.displayName.trim();
    if (!name) {
      setAddPayrollError('Name is required.');
      return;
    }
    setAddingPayroll(true);
    setAddPayrollError('');
    try {
      const monthlySalary = Math.max(0, Number.parseFloat(payrollForm.monthlySalary) || 0);
      const emp = await createPayrollEmployee(
        {
          displayName: name,
          designation: payrollForm.designation.trim() || null,
          employeeId: payrollForm.employeeId.trim() || null,
          department: payrollForm.department,
          defaultMonthlySalary: monthlySalary,
        },
        user.uid,
      );
      const staffUid = payrollEmployeeSalaryKey(emp.id);
      await saveSalaryMonth(
        {
          uid: staffUid,
          year: period.year,
          month: period.month,
          monthlySalary,
          leaveEntries: [],
          overtimeEntries: [],
        },
        user.uid,
      );
      setShowAddPayroll(false);
      setPayrollForm(EMPTY_PAYROLL_FORM);
      await load();
      setExpandedUid(staffUid);
    } catch (err) {
      setAddPayrollError(err instanceof Error ? err.message : 'Could not add employee.');
    } finally {
      setAddingPayroll(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="page-content fade-in">
        <div className="panel glass">
          <p className="text-muted">
            Salary calculation is only available on the local dev system (super admin).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hr-salary">
      <div className="hr-work-report__intro panel glass">
        <Calculator size={20} aria-hidden />
        <div>
          <p className="text-sm">
            Salary for {salaryPeriodLabel(period)}. Each payable workday = {HR_SALARY_HOURS_PER_DAY} hrs.
            Changes save automatically. Full leave = 1 day, half = 0.5.
            Total work hours = (payable days × {HR_SALARY_HOURS_PER_DAY}) + OT hours.
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
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setShowAddPayroll(v => !v);
            setAddPayrollError('');
          }}
        >
          <UserPlus size={15} aria-hidden />
          Add non-portal staff
        </button>
      </div>

      {showAddPayroll && (
        <div className="hr-salary__add-panel panel glass">
          <div className="hr-salary__add-head">
            <h3>Add non-portal staff</h3>
            <p className="text-sm text-muted">
              For people without a portal login. They appear in salary calculation only.
            </p>
          </div>
          <div className="hr-salary__add-grid">
            <label>
              <span>Name *</span>
              <input
                className="input-field"
                value={payrollForm.displayName}
                onChange={e => setPayrollForm(f => ({ ...f, displayName: e.target.value }))}
                autoComplete="name"
              />
            </label>
            <label>
              <span>Employee ID</span>
              <input
                className="input-field"
                value={payrollForm.employeeId}
                onChange={e => setPayrollForm(f => ({ ...f, employeeId: e.target.value }))}
              />
            </label>
            <label>
              <span>Designation</span>
              <input
                className="input-field"
                value={payrollForm.designation}
                onChange={e => setPayrollForm(f => ({ ...f, designation: e.target.value }))}
              />
            </label>
            <label>
              <span>Department</span>
              <select
                className="input-field"
                value={payrollForm.department}
                onChange={e => setPayrollForm(f => ({
                  ...f,
                  department: e.target.value as StaffDepartment,
                }))}
              >
                {STAFF_DEPARTMENTS.map(dept => (
                  <option key={dept} value={dept}>{STAFF_DEPARTMENT_LABELS[dept]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Monthly salary</span>
              <input
                type="number"
                min={0}
                step={100}
                className="input-field"
                value={payrollForm.monthlySalary}
                onChange={e => setPayrollForm(f => ({ ...f, monthlySalary: e.target.value }))}
              />
            </label>
          </div>
          {addPayrollError ? <p className="hr-salary__row-error">{addPayrollError}</p> : null}
          <div className="hr-salary__add-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={addingPayroll}
              onClick={() => {
                setShowAddPayroll(false);
                setPayrollForm(EMPTY_PAYROLL_FORM);
                setAddPayrollError('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={addingPayroll}
              onClick={() => { void handleAddPayroll(); }}
            >
              {addingPayroll ? 'Adding…' : 'Add & open'}
            </button>
          </div>
        </div>
      )}

      {loadError && <p className="hr-salary__error panel glass">{loadError}</p>}

      <div className="hr-work-report__table-wrap panel glass">
        <table className="hr-work-report__table hr-salary__table">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Monthly salary</th>
              <th>Per day</th>
              <th>Leave</th>
              <th>OT</th>
              <th>Holidays</th>
              <th>Payable days</th>
              <th>Work hrs</th>
              <th>Earned</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="text-muted">Loading…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-muted">No staff found.</td>
              </tr>
            )}
            {!loading && filtered.map(row => {
              const draft = drafts[row.staffUid] ?? emptyDraft(row);
              const calc = liveCalc(row);
              const expanded = expandedUid === row.staffUid;
              const cells = buildMonthDayCells(
                period,
                holidays,
                draft.leaveEntries,
                draft.overtimeEntries,
              );
              const leadingPads = new Date(period.year, period.month - 1, 1).getDay();
              const salaryValue = Number.parseFloat(draft.monthlySalary) || 0;

              return (
                <React.Fragment key={row.staffUid}>
                  <tr
                    className={[
                      'hr-salary__summary-row',
                      expanded ? 'is-expanded' : '',
                      row.active ? '' : 'is-inactive',
                      draft.dirty ? 'is-dirty' : '',
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => {
                      if (expanded) {
                        setExpandedUid(null);
                        setSelectedDate(null);
                      } else {
                        setExpandedUid(row.staffUid);
                        setSelectedDate(null);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (expanded) {
                          setExpandedUid(null);
                          setSelectedDate(null);
                        } else {
                          setExpandedUid(row.staffUid);
                          setSelectedDate(null);
                        }
                      }
                    }}
                  >
                    <td>
                      <div className="hr-work-report__name">
                        {row.displayName}
                        {draft.saving ? (
                          <span className="hr-salary__badge is-saving">Saving…</span>
                        ) : draft.dirty ? (
                          <span className="hr-salary__badge">Saving soon…</span>
                        ) : draft.savedAt ? (
                          <span className="hr-salary__badge is-saved">Saved</span>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted">
                        {[row.employeeId, row.designation, STAFF_DEPARTMENT_LABELS[row.department]]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>{formatInr(salaryValue)}</td>
                    <td>{formatInr(calc.perDaySalary)}</td>
                    <td>{formatLeaveDays(calc.leaveDays)}</td>
                    <td>{formatOtHours(calc.overtimeHours)}</td>
                    <td>{calc.weekdayHolidays}</td>
                    <td>
                      {calc.payableDays}
                      <span className="text-muted text-sm"> / {calc.rateDays}</span>
                    </td>
                    <td title={`${formatOtHours(calc.regularHours)} regular + ${formatOtHours(calc.overtimeHours)} OT`}>
                      {formatOtHours(calc.totalWorkHours)}
                    </td>
                    <td>{formatInr(calc.earnedSalary)}</td>
                  </tr>
                  {expanded && (
                    <tr className="hr-salary__expand-row">
                      <td colSpan={9}>
                        <div className="hr-salary__expand-layout">
                          <div className="hr-salary__expand-cal">
                            <div className="hr-salary__cal-head">
                              <h4 className="hr-salary__cal-title">{salaryPeriodLabel(period)}</h4>
                              <div className="hr-salary__legend text-sm text-muted">
                                <span><i className="hr-salary__swatch is-working" /> Working</span>
                                <span><i className="hr-salary__swatch is-leave-half" /> Half leave</span>
                                <span><i className="hr-salary__swatch is-leave" /> Full leave</span>
                                <span><i className="hr-salary__swatch is-overtime" /> Overtime</span>
                                <span><i className="hr-salary__swatch is-sunday" /> Sunday</span>
                                <span><i className="hr-salary__swatch is-holiday" /> Holiday</span>
                              </div>
                              <p className="hr-salary__cal-hint text-sm text-muted">
                                Click a day to edit leave & overtime below the calendar.
                              </p>
                            </div>
                            <div
                              className="hr-salary__cal"
                              role="group"
                              aria-label={`Attendance calendar for ${salaryPeriodLabel(period)}`}
                            >
                              <div className="hr-salary__cal-weekdays" aria-hidden>
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => (
                                  <span key={label} className="hr-salary__cal-weekday">{label}</span>
                                ))}
                              </div>
                              <div className="hr-salary__days">
                                {Array.from({ length: leadingPads }, (_, i) => (
                                  <span key={`pad-${i}`} className="hr-salary__day-pad" />
                                ))}
                                {cells.map(cell => (
                                  <button
                                    key={cell.date}
                                    type="button"
                                    title={
                                      cell.overtimeHours > 0
                                        ? `${formatOtHours(cell.overtimeHours)} OT`
                                        : cell.kind === 'holiday'
                                          ? cell.holidayName
                                          : cell.kind === 'sunday'
                                            ? 'Sunday'
                                            : cell.kind === 'leave'
                                              ? 'Full-day leave'
                                              : cell.kind === 'leave_half'
                                                ? 'Half-day leave'
                                              : cell.date
                                    }
                                    className={[
                                      'hr-salary__day',
                                      `is-${cell.kind}`,
                                      selectedDate === cell.date ? 'is-selected' : '',
                                      cell.leaveKind === 'half' && cell.kind === 'overtime'
                                        ? 'has-leave-half'
                                        : '',
                                      cell.leaveKind === 'full' && cell.kind === 'overtime'
                                        ? 'has-leave'
                                        : '',
                                    ].filter(Boolean).join(' ')}
                                    onClick={e => {
                                      e.stopPropagation();
                                      selectDay(row.staffUid, cell.date);
                                    }}
                                  >
                                    <span className="hr-salary__day-num">{cell.day}</span>
                                    {cell.overtimeHours > 0 ? (
                                      <span className="hr-salary__day-ot">
                                        {cell.overtimeHours % 1 === 0
                                          ? `${cell.overtimeHours}h`
                                          : `${cell.overtimeHours.toFixed(1)}h`}
                                      </span>
                                    ) : null}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {selectedDate ? (
                              <DayAttendanceSheet
                                date={selectedDate}
                                canEdit={canEdit}
                                canSetLeave={
                                  !isSundayDate(selectedDate) && !holidayDateSet.has(selectedDate)
                                }
                                leaveKind={leaveKindForDate(draft.leaveEntries, selectedDate)}
                                holidayName={
                                  monthHolidays.find(h => h.date === selectedDate)?.name ?? null
                                }
                                entries={draft.overtimeEntries
                                  .filter(e => e.date === selectedDate)
                                  .sort((a, b) => a.startTime.localeCompare(b.startTime))}
                                onClose={() => setSelectedDate(null)}
                                onSetLeave={kind => setLeaveForDay(row.staffUid, selectedDate, kind)}
                                onAddOt={() => addOtEntry(row.staffUid, selectedDate)}
                                onPatchOt={(entryId, patch) => patchOtEntry(row.staffUid, entryId, patch)}
                                onRemoveOt={entryId => removeOtEntry(row.staffUid, entryId)}
                              />
                            ) : null}

                            <p className="text-sm text-muted hr-salary__math">
                              Rate days {calc.rateDays} (month {calc.daysInMonth} − {calc.sundays} Sundays)
                              · − {calc.weekdayHolidays} holiday{calc.weekdayHolidays === 1 ? '' : 's'}
                              · − {formatLeaveDays(calc.leaveDays)} leave
                              = {calc.payableDays} payable × {HR_SALARY_HOURS_PER_DAY}h
                              = {formatOtHours(calc.regularHours)} regular
                              · + {formatOtHours(calc.overtimeHours)} OT
                              = {formatOtHours(calc.totalWorkHours)} total
                              · pay {formatInr(calc.earnedSalary)}
                            </p>
                          </div>

                          <aside className="hr-salary__expand-side">
                            <label className="hr-salary__salary-field">
                              <span>Monthly salary</span>
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
                            </label>

                            <dl className="hr-salary__side-stats">
                              <div>
                                <dt>Per day</dt>
                                <dd>{formatInr(calc.perDaySalary)}</dd>
                              </div>
                              <div>
                                <dt>Hourly</dt>
                                <dd>{formatInr(calc.hourlyRate)}</dd>
                              </div>
                              <div>
                                <dt>Leave</dt>
                                <dd>{formatLeaveDays(calc.leaveDays)}</dd>
                              </div>
                              <div>
                                <dt>Payable</dt>
                                <dd>{calc.payableDays} / {calc.rateDays}</dd>
                              </div>
                              <div>
                                <dt>Regular hrs</dt>
                                <dd>{formatOtHours(calc.regularHours)}</dd>
                              </div>
                              <div>
                                <dt>OT hours</dt>
                                <dd>{formatOtHours(calc.overtimeHours)}</dd>
                              </div>
                              <div>
                                <dt>Total work hrs</dt>
                                <dd>{formatOtHours(calc.totalWorkHours)}</dd>
                              </div>
                              <div>
                                <dt>OT pay</dt>
                                <dd>{formatInr(calc.overtimePay)}</dd>
                              </div>
                              <div>
                                <dt>Earned</dt>
                                <dd>{formatInr(calc.earnedSalary)}</dd>
                              </div>
                            </dl>

                            <p className="hr-salary__autosave-status text-sm text-muted">
                              {draft.saving
                                ? 'Saving to Firestore…'
                                : draft.dirty
                                  ? 'Changes will save automatically…'
                                  : draft.savedAt
                                    ? 'All changes saved'
                                    : 'Edits save automatically'}
                            </p>
                            {draft.error && <p className="hr-salary__row-error">{draft.error}</p>}
                          </aside>
                        </div>
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
