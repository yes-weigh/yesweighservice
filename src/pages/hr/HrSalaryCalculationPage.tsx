import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Link2, RefreshCw, Search, Trash2, UserPlus } from 'lucide-react';
import { toPng } from 'html-to-image';
import { DayAttendanceSheet } from '../../components/hr/DayAttendanceSheet';
import { ExpenseSettlementCard } from '../../components/hr/ExpenseSettlementCard';
import { DecimalTextInput } from '../../components/DecimalAmountInput';
import { useAuth } from '../../context/AuthContext';
import { fetchHrHolidays, holidaysInMonth } from '../../lib/hrHolidays';
import {
  createPayrollEmployee,
  payrollEmployeeSalaryKey,
} from '../../lib/hrPayrollEmployees';
import {
  applyDayClockPatch,
  buildMonthDayCells,
  buildSalaryCalculationRows,
  computeOvertimePayWithMakeup,
  computeSalaryCalc,
  createExpenseEntry,
  createOvertimeEntry,
  createSalaryProject,
  createSalaryReceiptEntry,
  createWorkShiftEntry,
  computeExpenseSettlement,
  formatInr,
  formatLeaveDays,
  formatOtHours,
  formatTimeAmPm,
  formatWorkPercent,
  leaveKindForDate,
  overtimeEntryHours,
  projectWorkSharePercents,
  projectWorkTotals,
  saveSalaryMonth,
  workProjectIdForDate,
  type HrSalaryStaffRow,
} from '../../lib/hrSalary';
import { copyTextToClipboard } from '../../lib/clipboard';
import {
  createSalaryShareToken,
  salarySharePublicUrl,
  saveSalaryMonthShareToken,
  upsertSalaryShare,
} from '../../lib/hrSalaryShares';
import { isLocalhostDev } from '../../lib/isLocalhost';
import { canEditHrSalary, canViewHrSalary } from '../../lib/staffAccess';
import type { HrHoliday } from '../../types/hr-holiday';
import {
  currentSalaryPeriod,
  HR_SALARY_HOURS_PER_DAY,
  salaryPeriodKey,
  salaryPeriodLabel,
  type HrLeaveKind,
  type HrDayJoinEntry,
  type HrExpenseEntry,
  type HrOvertimeEntry,
  type HrSalaryPeriod,
  type HrSalaryProject,
  type HrSalaryReceiptEntry,
  type HrSalaryReceiptKind,
  type HrWorkDayEntry,
  type HrWorkShiftEntry,
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
  otPerDaySalary: string;
  leaveEntries: Array<{ date: string; kind: HrLeaveKind }>;
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  workShiftEntries: HrWorkShiftEntry[];
  dayJoinEntries: HrDayJoinEntry[];
  overtimeEntries: HrOvertimeEntry[];
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
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
  otPerDaySalary: string;
};

const EMPTY_PAYROLL_FORM: NewPayrollForm = {
  displayName: '',
  designation: '',
  employeeId: '',
  department: 'admin',
  monthlySalary: '',
  otPerDaySalary: '',
};

function rateInputValue(n: number): string {
  if (!(n > 0)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function emptyDraft(row: HrSalaryStaffRow): DraftRow {
  return {
    monthlySalary: rateInputValue(row.monthlySalary),
    otPerDaySalary: rateInputValue(row.otPerDaySalary),
    leaveEntries: row.leaveEntries.map(e => ({ ...e })),
    projects: row.projects.map(p => ({ ...p })),
    workDayEntries: row.workDayEntries.map(e => ({ ...e })),
    workShiftEntries: (row.workShiftEntries ?? []).map(e => ({ ...e })),
    dayJoinEntries: (row.dayJoinEntries ?? []).map(e => ({ ...e })),
    overtimeEntries: row.overtimeEntries.map(e => ({ ...e })),
    expenseEntries: (row.expenseEntries ?? []).map(e => ({ ...e })),
    receiptEntries: (row.receiptEntries ?? []).map(e => ({ ...e })),
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

export const HrSalaryCalculationPage: React.FC<Props> = ({ basePath: _basePath }) => {
  const { user } = useAuth();
  const canAccess = canViewHrSalary(user) && isLocalhostDev();
  const canEdit = canAccess && canEditHrSalary(user);
  const [period, setPeriod] = useState<HrSalaryPeriod>(currentSalaryPeriod);
  const [rows, setRows] = useState<HrSalaryStaffRow[]>([]);
  const [holidays, setHolidays] = useState<HrHoliday[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<StaffDepartment | 'all'>('all');
  const [loadError, setLoadError] = useState('');
  const [showAddPayroll, setShowAddPayroll] = useState(false);
  const [payrollForm, setPayrollForm] = useState<NewPayrollForm>(EMPTY_PAYROLL_FORM);
  const [addingPayroll, setAddingPayroll] = useState(false);
  const [addPayrollError, setAddPayrollError] = useState('');
  const [capturingExpand, setCapturingExpand] = useState(false);
  const [shareTokens, setShareTokens] = useState<Record<string, string>>({});
  const [copyingShareUid, setCopyingShareUid] = useState<string | null>(null);
  const [copiedShareUid, setCopiedShareUid] = useState<string | null>(null);
  const autosaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const expandCaptureRef = useRef<HTMLDivElement | null>(null);
  const draftsRef = useRef(drafts);
  const periodRef = useRef(period);
  const holidaysRef = useRef(holidays);
  const shareTokensRef = useRef(shareTokens);
  const rowsRef = useRef(rows);
  const skipAutosaveRef = useRef(false);

  draftsRef.current = drafts;
  periodRef.current = period;
  holidaysRef.current = holidays;
  shareTokensRef.current = shareTokens;
  rowsRef.current = rows;

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
      setShareTokens(Object.fromEntries(
        nextRows
          .filter(r => r.publicShareToken)
          .map(r => [r.staffUid, r.publicShareToken as string]),
      ));
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
      const otPerDaySalary = Math.max(0, Number.parseFloat(draft.otPerDaySalary) || 0);
      const leaveEntries = draft.leaveEntries.map(e => ({ ...e }));
      const projects = draft.projects.map(p => ({ ...p }));
      const workDayEntries = draft.workDayEntries.map(e => ({ ...e }));
      const workShiftEntries = draft.workShiftEntries.map(e => ({ ...e }));
      const dayJoinEntries = draft.dayJoinEntries.map(e => ({ ...e }));
      const overtimeEntries = draft.overtimeEntries.map(e => ({ ...e }));
      const expenseEntries = draft.expenseEntries.map(e => ({ ...e }));
      const receiptEntries = draft.receiptEntries.map(e => ({ ...e }));
      await saveSalaryMonth(
        {
          uid,
          year: periodNow.year,
          month: periodNow.month,
          monthlySalary,
          otPerDaySalary,
          leaveEntries,
          projects,
          workDayEntries,
          workShiftEntries,
          dayJoinEntries,
          overtimeEntries,
          expenseEntries,
          receiptEntries,
        },
        user.uid,
        holidaysNow,
      );
      const shareToken = shareTokensRef.current[uid]
        || rowsRef.current.find(r => r.staffUid === uid)?.publicShareToken
        || null;
      if (shareToken) {
        const row = rowsRef.current.find(r => r.staffUid === uid);
        const monthHs = holidaysInMonth(holidaysNow, periodNow.year, periodNow.month);
        await upsertSalaryShare(
          {
            token: shareToken,
            uid,
            displayName: row?.displayName || 'Staff',
            period: periodNow,
            monthlySalary,
            otPerDaySalary,
            leaveEntries,
            projects,
            workDayEntries,
            workShiftEntries,
            dayJoinEntries,
            overtimeEntries,
            expenseEntries,
            receiptEntries,
            holidays: monthHs.map(h => ({ date: h.date, name: h.name })),
          },
          user.uid,
        ).catch(err => {
          console.warn('Could not refresh public salary share:', err);
        });
      }
      const calc = computeSalaryCalc(
        monthlySalary,
        otPerDaySalary,
        periodNow,
        holidaysNow,
        leaveEntries,
        overtimeEntries,
        workShiftEntries,
        workDayEntries,
        dayJoinEntries,
        projects,
      );
      setRows(prev => prev.map(row => {
        if (row.staffUid !== uid) return row;
        return {
          ...row,
          monthlySalary,
          perDaySalary: calc.perDaySalary,
          otPerDaySalary,
          leaveEntries,
          projects,
          workDayEntries,
          workShiftEntries,
          dayJoinEntries,
          overtimeEntries,
          expenseEntries,
          receiptEntries,
          calc,
        };
      }));
      let stillDirty = false;
      setDrafts(prev => {
        const cur = prev[uid];
        if (!cur) return prev;
        stillDirty = (
          (Number.parseFloat(cur.monthlySalary) || 0) !== monthlySalary
          || (Number.parseFloat(cur.otPerDaySalary) || 0) !== otPerDaySalary
          || JSON.stringify(cur.leaveEntries) !== JSON.stringify(leaveEntries)
          || JSON.stringify(cur.projects) !== JSON.stringify(projects)
          || JSON.stringify(cur.workDayEntries) !== JSON.stringify(workDayEntries)
          || JSON.stringify(cur.workShiftEntries) !== JSON.stringify(workShiftEntries)
          || JSON.stringify(cur.dayJoinEntries) !== JSON.stringify(dayJoinEntries)
          || JSON.stringify(cur.overtimeEntries) !== JSON.stringify(overtimeEntries)
          || JSON.stringify(cur.expenseEntries) !== JSON.stringify(expenseEntries)
          || JSON.stringify(cur.receiptEntries) !== JSON.stringify(receiptEntries)
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
    const monthlySalary = Number.parseFloat(draft.monthlySalary) || 0;
    const otPerDaySalary = Number.parseFloat(draft.otPerDaySalary) || 0;
    return computeSalaryCalc(
      monthlySalary,
      otPerDaySalary,
      period,
      holidays,
      draft.leaveEntries,
      draft.overtimeEntries,
      draft.workShiftEntries,
      draft.workDayEntries,
      draft.dayJoinEntries,
      draft.projects,
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

  const addProject = (uid: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    const project = createSalaryProject(`Project ${draft.projects.length + 1}`, draft.projects);
    const isFirst = draft.projects.length === 0;
    updateDraft(uid, {
      projects: [...draft.projects, project],
      workShiftEntries: isFirst
        ? draft.workShiftEntries.map(entry => (
          entry.projectId ? entry : { ...entry, projectId: project.id }
        ))
        : draft.workShiftEntries,
      overtimeEntries: isFirst
        ? draft.overtimeEntries.map(entry => (
          entry.projectId ? entry : { ...entry, projectId: project.id }
        ))
        : draft.overtimeEntries,
    });
    setActiveProjectId(project.id);
  };

  const renameProject = (uid: string, projectId: string, name: string) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      projects: draft.projects.map(p => (
        p.id === projectId ? { ...p, name } : p
      )),
    });
  };

  const removeProject = (uid: string, projectId: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      projects: draft.projects.filter(p => p.id !== projectId),
      workDayEntries: draft.workDayEntries.filter(e => e.projectId !== projectId),
      workShiftEntries: draft.workShiftEntries.map(entry => (
        entry.projectId === projectId ? { ...entry, projectId: null } : entry
      )),
      overtimeEntries: draft.overtimeEntries.map(entry => (
        entry.projectId === projectId ? { ...entry, projectId: null } : entry
      )),
    });
    if (activeProjectId === projectId) {
      const next = draft.projects.find(p => p.id !== projectId);
      setActiveProjectId(next?.id ?? null);
    }
  };

  const setDayProject = (uid: string, date: string, projectId: string | null) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    const nextWork = draft.workDayEntries.filter(e => e.date !== date);
    if (projectId) nextWork.push({ date, projectId });
    if (projectId) setActiveProjectId(projectId);
    // Whole-day mode clears timed daytime shifts for this date.
    updateDraft(uid, {
      workDayEntries: nextWork.sort((a, b) => a.date.localeCompare(b.date)),
      workShiftEntries: draft.workShiftEntries.filter(e => e.date !== date),
      dayJoinEntries: draft.dayJoinEntries.filter(e => e.date !== date),
    });
  };

  const setDayClockForDay = (
    uid: string,
    date: string,
    patch: { joinedAt?: string | null; clockedOutAt?: string | null },
  ) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      dayJoinEntries: applyDayClockPatch(date, draft.dayJoinEntries, patch),
    });
  };

  const addWorkShiftEntry = (uid: string, date: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    let projects = draft.projects;
    const dayProject = workProjectIdForDate(draft.workDayEntries, date);
    let projectId = (
      dayProject
      || (activeProjectId && projects.some(p => p.id === activeProjectId) ? activeProjectId : null)
      || projects[0]?.id
      || null
    );
    if (!projectId) {
      const project = createSalaryProject('Project 1', projects);
      projects = [project];
      projectId = project.id;
    }
    if (activeProjectId !== projectId) setActiveProjectId(projectId);
    const existing = draft.workShiftEntries.filter(e => e.date === date);
    const entry = existing.length === 0
      ? createWorkShiftEntry(date, '09:30', '17:30', projectId)
      : createWorkShiftEntry(date, '14:00', '18:00', projectId);
    updateDraft(uid, {
      projects,
      // Timed shifts override whole-day assignment and explicit join time.
      workDayEntries: draft.workDayEntries.filter(e => e.date !== date),
      dayJoinEntries: draft.dayJoinEntries.filter(e => e.date !== date),
      workShiftEntries: [...draft.workShiftEntries, entry],
    });
  };

  const patchWorkShiftEntry = (
    uid: string,
    entryId: string,
    patch: Partial<Pick<HrWorkShiftEntry, 'startTime' | 'endTime' | 'projectId'>>,
  ) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      workShiftEntries: draft.workShiftEntries.map(entry => (
        entry.id === entryId ? { ...entry, ...patch } : entry
      )),
    });
  };

  const removeWorkShiftEntry = (uid: string, entryId: string) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      workShiftEntries: draft.workShiftEntries.filter(entry => entry.id !== entryId),
    });
  };

  const addOtEntry = (uid: string, date: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    let projects = draft.projects;
    const dayProject = workProjectIdForDate(draft.workDayEntries, date);
    let projectId = (
      dayProject
      || (activeProjectId && projects.some(p => p.id === activeProjectId) ? activeProjectId : null)
      || projects[0]?.id
      || null
    );
    if (!projectId) {
      const project = createSalaryProject('Project 1', projects);
      projects = [project];
      projectId = project.id;
    }
    if (activeProjectId !== projectId) setActiveProjectId(projectId);
    const existing = draft.overtimeEntries.filter(e => e.date === date);
    const startTime = existing.length === 0 ? '18:00' : '06:00';
    const endTime = existing.length === 0 ? '20:00' : '08:00';
    updateDraft(uid, {
      projects,
      overtimeEntries: [
        ...draft.overtimeEntries,
        createOvertimeEntry(date, startTime, endTime, projectId),
      ],
    });
  };

  const patchOtEntry = (
    uid: string,
    entryId: string,
    patch: Partial<Pick<HrOvertimeEntry, 'startTime' | 'endTime' | 'projectId'>>,
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

  const addExpenseEntry = (uid: string, date: string) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      expenseEntries: [...draft.expenseEntries, createExpenseEntry(date)],
    });
  };

  const patchExpenseEntry = (
    uid: string,
    entryId: string,
    patch: Partial<Pick<HrExpenseEntry, 'amount' | 'note'>>,
  ) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      expenseEntries: draft.expenseEntries.map(entry => (
        entry.id === entryId ? { ...entry, ...patch } : entry
      )),
    });
  };

  const removeExpenseEntry = (uid: string, entryId: string) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      expenseEntries: draft.expenseEntries.filter(entry => entry.id !== entryId),
    });
  };

  const addReceiptEntry = (uid: string, date: string, kind: HrSalaryReceiptKind) => {
    if (!canEdit) return;
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      receiptEntries: [...draft.receiptEntries, createSalaryReceiptEntry(date, kind)],
    });
  };

  const patchReceiptEntry = (
    uid: string,
    entryId: string,
    patch: Partial<Pick<HrSalaryReceiptEntry, 'amount' | 'note' | 'kind'>>,
  ) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      receiptEntries: draft.receiptEntries.map(entry => (
        entry.id === entryId ? { ...entry, ...patch } : entry
      )),
    });
  };

  const removeReceiptEntry = (uid: string, entryId: string) => {
    const draft = drafts[uid];
    if (!draft) return;
    updateDraft(uid, {
      receiptEntries: draft.receiptEntries.filter(entry => entry.id !== entryId),
    });
  };

  const copyPublicShareLink = async (row: HrSalaryStaffRow) => {
    if (!user || copyingShareUid) return;
    const draft = drafts[row.staffUid] ?? emptyDraft(row);
    setCopyingShareUid(row.staffUid);
    try {
      const token = shareTokens[row.staffUid] || row.publicShareToken || createSalaryShareToken();
      const url = salarySharePublicUrl(token);
      const monthHs = holidaysInMonth(holidays, period.year, period.month);
      await upsertSalaryShare(
        {
          token,
          uid: row.staffUid,
          displayName: row.displayName,
          period,
          monthlySalary: Math.max(0, Number.parseFloat(draft.monthlySalary) || 0),
          otPerDaySalary: Math.max(0, Number.parseFloat(draft.otPerDaySalary) || 0),
          leaveEntries: draft.leaveEntries,
          projects: draft.projects,
          workDayEntries: draft.workDayEntries,
          workShiftEntries: draft.workShiftEntries,
          dayJoinEntries: draft.dayJoinEntries,
          overtimeEntries: draft.overtimeEntries,
          expenseEntries: draft.expenseEntries,
          receiptEntries: draft.receiptEntries,
          holidays: monthHs.map(h => ({ date: h.date, name: h.name })),
        },
        user.uid,
      );
      if (!shareTokens[row.staffUid] && !row.publicShareToken) {
        await saveSalaryMonthShareToken(row.staffUid, period, token);
      }
      setShareTokens(prev => ({ ...prev, [row.staffUid]: token }));
      setRows(prev => prev.map(r => (
        r.staffUid === row.staffUid ? { ...r, publicShareToken: token } : r
      )));
      // Clipboard user-activation often expires after Firestore awaits — use fallback.
      await copyTextToClipboard(url);
      setCopiedShareUid(row.staffUid);
      window.setTimeout(() => {
        setCopiedShareUid(prev => (prev === row.staffUid ? null : prev));
      }, 2000);
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : 'Could not copy public link.');
    } finally {
      setCopyingShareUid(null);
    }
  };

  const captureExpandedView = async (displayName: string) => {
    const el = expandCaptureRef.current;
    if (!el || capturingExpand) return;
    setCapturingExpand(true);
    const previousDate = selectedDate;
    setSelectedDate(null);
    el.classList.add('is-capturing');
    // Let the day editor close and capture layout settle before rasterizing.
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      // Measure after capture-mode CSS expands scroll areas / hides controls.
      const rect = el.getBoundingClientRect();
      const width = Math.ceil(Math.max(el.scrollWidth, rect.width));
      const height = Math.ceil(Math.max(el.scrollHeight, rect.height));
      // 4× raster keeps text sharp when zoomed; fallback if the canvas is too large.
      const tryRatios = [4, 3, 2];
      let dataUrl = '';
      let lastError: unknown;
      for (const pixelRatio of tryRatios) {
        try {
          dataUrl = await toPng(el, {
            cacheBust: true,
            pixelRatio,
            width,
            height,
            canvasWidth: Math.round(width * pixelRatio),
            canvasHeight: Math.round(height * pixelRatio),
            backgroundColor: '#13151b',
            // Avoid forcing height on the clone — that collapses flex/grid alignment.
            style: {
              transform: 'none',
              width: `${width}px`,
              height: 'auto',
              maxWidth: 'none',
              margin: '0',
              boxSizing: 'border-box',
            },
            filter: node => !(
              node instanceof HTMLElement
              && node.dataset.captureIgnore === '1'
            ),
          });
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!dataUrl) throw lastError ?? new Error('Could not capture image.');
      const slug = displayName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'staff';
      const link = document.createElement('a');
      link.download = `${slug}-salary-${salaryPeriodKey(period)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : 'Could not capture image.');
    } finally {
      el.classList.remove('is-capturing');
      setSelectedDate(previousDate);
      setCapturingExpand(false);
    }
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
      const otPerDaySalary = Math.max(
        0,
        Number.parseFloat(payrollForm.otPerDaySalary) || 0,
      );
      const emp = await createPayrollEmployee(
        {
          displayName: name,
          designation: payrollForm.designation.trim() || null,
          employeeId: payrollForm.employeeId.trim() || null,
          department: payrollForm.department,
          defaultMonthlySalary: monthlySalary,
          defaultOtPerDaySalary: otPerDaySalary,
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
          otPerDaySalary,
          leaveEntries: [],
          projects: [],
          workDayEntries: [],
          workShiftEntries: [],
          dayJoinEntries: [],
          overtimeEntries: [],
          expenseEntries: [],
          receiptEntries: [],
        },
        user.uid,
        holidays,
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
            placeholder="Search…"
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
              <span>Per month</span>
              <DecimalTextInput
                className="input-field"
                value={payrollForm.monthlySalary}
                onChange={monthlySalary => setPayrollForm(f => ({ ...f, monthlySalary }))}
                aria-label="Monthly salary"
              />
            </label>
            <label>
              <span>OT per day ({HR_SALARY_HOURS_PER_DAY} hrs)</span>
              <DecimalTextInput
                className="input-field"
                value={payrollForm.otPerDaySalary}
                onChange={otPerDaySalary => setPayrollForm(f => ({ ...f, otPerDaySalary }))}
                aria-label="OT per day salary"
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
              <th>Per month</th>
              <th>OT / day</th>
              <th>Leave</th>
              <th>OT</th>
              <th>Payable</th>
              <th>Work hrs</th>
              <th>Net payable</th>
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
                <td colSpan={8} className="text-muted">
                  No staff.
                </td>
              </tr>
            )}
            {!loading && filtered.map(row => {
              const draft = drafts[row.staffUid] ?? emptyDraft(row);
              const calc = liveCalc(row);
              const settlement = computeExpenseSettlement(
                draft.expenseEntries,
                draft.receiptEntries,
                calc.earnedSalary,
                period,
              );
              const expanded = expandedUid === row.staffUid;
              const cells = buildMonthDayCells(
                period,
                holidays,
                draft.leaveEntries,
                draft.overtimeEntries,
                draft.projects,
                draft.workDayEntries,
                draft.workShiftEntries,
              );
              const leadingPads = new Date(period.year, period.month - 1, 1).getDay();
              const monthlyValue = Number.parseFloat(draft.monthlySalary) || 0;
              const otPerDayValue = Number.parseFloat(draft.otPerDaySalary) || 0;
              const projectTotals = projectWorkTotals(
                draft.projects,
                draft.workDayEntries,
                draft.leaveEntries,
                draft.overtimeEntries,
                period,
                holidays,
                calc.perDaySalary,
                calc.otHourlyRate,
                draft.workShiftEntries,
                draft.dayJoinEntries,
                calc.hourlyRate,
              );
              const projectSharePercents = projectWorkSharePercents(projectTotals);
              const otPaySplit = computeOvertimePayWithMakeup(
                draft.overtimeEntries,
                draft.workShiftEntries,
                draft.dayJoinEntries,
                period,
                calc.hourlyRate,
                calc.otHourlyRate,
              );
              const otLines = draft.overtimeEntries
                .map(entry => {
                  const hours = overtimeEntryHours(entry.startTime, entry.endTime);
                  const split = otPaySplit.entryPay.get(entry.id);
                  const project = draft.projects.find(p => p.id === entry.projectId) ?? null;
                  return {
                    ...entry,
                    hours,
                    makeupHours: split?.makeupHours ?? 0,
                    billableOtHours: split?.billableOtHours ?? hours,
                    pay: split?.pay ?? hours * calc.otHourlyRate,
                    project,
                  };
                })
                .filter(line => line.hours > 0)
                .sort((a, b) => (
                  a.date.localeCompare(b.date)
                  || a.startTime.localeCompare(b.startTime)
                ));
              const currentActiveProjectId = (
                activeProjectId && draft.projects.some(p => p.id === activeProjectId)
                  ? activeProjectId
                  : draft.projects[0]?.id ?? null
              );

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
                        setActiveProjectId(draft.projects[0]?.id ?? null);
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
                          setActiveProjectId(draft.projects[0]?.id ?? null);
                        }
                      }
                    }}
                  >
                    <td>
                      <div className="hr-work-report__name">
                        {row.displayName}
                      </div>
                      <div className="text-sm text-muted">
                        {[row.employeeId, row.designation, STAFF_DEPARTMENT_LABELS[row.department]]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>{formatInr(monthlyValue)}</td>
                    <td>{formatInr(otPerDayValue)}</td>
                    <td>{formatLeaveDays(calc.leaveDays)}</td>
                    <td>{formatOtHours(calc.overtimeHours)}</td>
                    <td>
                      {calc.payableDays}
                      <span className="text-muted text-sm"> / {calc.rateDays}</span>
                    </td>
                    <td title={`${formatOtHours(calc.regularHours)} regular + ${formatOtHours(calc.overtimeHours)} OT`}>
                      {formatOtHours(calc.totalWorkHours)}
                    </td>
                    <td>{formatInr(settlement.netPayable)}</td>
                  </tr>
                  {expanded && (
                    <tr className="hr-salary__expand-row">
                      <td colSpan={8}>
                        <div className="hr-salary__expand" ref={expandCaptureRef}>
                          <header className="hr-salary__dash-header">
                            <div className="hr-salary__dash-header-info">
                              <h3>{row.displayName}</h3>
                              <span>{salaryPeriodLabel(period)}</span>
                            </div>
                            <div className="hr-salary__dash-header-right">
                              <div className="hr-salary__dash-header-totals">
                                <h4>{formatInr(settlement.netPayable)}</h4>
                                <p>
                                  {formatInr(calc.earnedSalary)} earned
                                  {settlement.unreimbursedExpenses > 0
                                    ? ` + ${formatInr(settlement.unreimbursedExpenses)} expenses`
                                    : ''}
                                  {settlement.totalSalaryAdvances > 0
                                    ? ` − ${formatInr(settlement.totalSalaryAdvances)} advance`
                                    : ''}
                                </p>
                                <p className="text-sm text-muted">
                                  {formatOtHours(calc.overtimeHours)} OT
                                  {' · '}
                                  {calc.payableDays} days worked
                                </p>
                              </div>
                              <button
                                type="button"
                                className="hr-salary__capture-btn"
                                data-capture-ignore="1"
                                disabled={copyingShareUid === row.staffUid}
                                onClick={() => { void copyPublicShareLink(row); }}
                              >
                                <Link2 size={15} aria-hidden />
                                {copyingShareUid === row.staffUid
                                  ? 'Copying…'
                                  : copiedShareUid === row.staffUid
                                    ? 'Link copied'
                                    : 'Copy public link'}
                              </button>
                              <button
                                type="button"
                                className="hr-salary__capture-btn"
                                data-capture-ignore="1"
                                disabled={capturingExpand}
                                onClick={() => { void captureExpandedView(row.displayName); }}
                              >
                                <Camera size={15} aria-hidden />
                                {capturingExpand ? 'Capturing…' : 'Capture'}
                              </button>
                            </div>
                          </header>

                          <div className="hr-salary__config-row">
                            <div className="hr-salary__rate-group">
                              <label className="hr-salary__rate-item">
                                <span>Per month</span>
                                <DecimalTextInput
                                  className="hr-salary__rate-value-input"
                                  value={draft.monthlySalary}
                                  disabled={!canEdit}
                                  onChange={monthlySalary => updateDraft(row.staffUid, { monthlySalary })}
                                  aria-label={`Monthly salary for ${row.displayName}`}
                                />
                                <span className="hr-salary__rate-sub">
                                  {formatInr(calc.perDaySalary)}/day · {calc.rateDays} days
                                  {calc.weekdayHolidays > 0
                                    ? ` (−${calc.weekdayHolidays} holiday${calc.weekdayHolidays === 1 ? '' : 's'})`
                                    : ''}
                                </span>
                              </label>
                              <label className="hr-salary__rate-item">
                                <span>OT per day ({HR_SALARY_HOURS_PER_DAY}hrs)</span>
                                <DecimalTextInput
                                  className="hr-salary__rate-value-input"
                                  value={draft.otPerDaySalary}
                                  disabled={!canEdit}
                                  onChange={otPerDaySalary => updateDraft(row.staffUid, { otPerDaySalary })}
                                  aria-label={`OT per day salary for ${row.displayName}`}
                                />
                                <span className="hr-salary__rate-sub">
                                  {formatInr(calc.otHourlyRate)}/hr
                                </span>
                              </label>
                            </div>

                            <div className="hr-salary__project-selector">
                              <span className="hr-salary__projects-label">Projects:</span>
                              {draft.projects.map(project => (
                                <div
                                  key={project.id}
                                  className={[
                                    'hr-salary__project-pill',
                                    currentActiveProjectId === project.id ? 'is-active' : '',
                                  ].filter(Boolean).join(' ')}
                                  style={{ ['--proj-color' as string]: project.color }}
                                >
                                  <button
                                    type="button"
                                    className="hr-salary__project-pill-select"
                                    onClick={() => setActiveProjectId(project.id)}
                                    aria-label={`Select ${project.name}`}
                                  >
                                    <i
                                      className="hr-salary__proj-dot"
                                      style={{ background: project.color }}
                                    />
                                  </button>
                                  <input
                                    className="hr-salary__project-pill-name"
                                    value={project.name}
                                    disabled={!canEdit}
                                    onFocus={() => setActiveProjectId(project.id)}
                                    onChange={e => renameProject(
                                      row.staffUid,
                                      project.id,
                                      e.target.value,
                                    )}
                                    aria-label="Project name"
                                  />
                                  {canEdit ? (
                                    <button
                                      type="button"
                                      className="hr-salary__project-pill-remove"
                                      aria-label={`Remove ${project.name}`}
                                      onClick={() => removeProject(row.staffUid, project.id)}
                                    >
                                      <Trash2 size={13} aria-hidden />
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                              {canEdit ? (
                                <button
                                  type="button"
                                  className="hr-salary__btn-add"
                                  onClick={() => addProject(row.staffUid)}
                                >
                                  + Add project
                                </button>
                              ) : null}
                            </div>
                            {draft.error ? <p className="hr-salary__row-error">{draft.error}</p> : null}
                          </div>

                          <div className="hr-salary__main-grid">
                            <div className="hr-salary__cal-row">
                              <div className="hr-salary__card hr-salary__expand-cal">
                              <div className="hr-salary__cal-head">
                                <h4>{salaryPeriodLabel(period)}</h4>
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
                                  {cells.map(cell => {
                                    const hasOt = cell.overtimeHours > 0;
                                    const sunday = isSundayDate(cell.date);
                                    const fullLeave = (
                                      cell.kind === 'leave' || cell.leaveKind === 'full'
                                    );
                                    const halfLeave = (
                                      cell.kind === 'leave_half' || cell.leaveKind === 'half'
                                    );
                                    const hasWork = (
                                      hasOt
                                      || cell.projectColors.length > 0
                                      || cell.kind === 'working'
                                    );
                                    // Weekday work stays teal even with OT — badge alone marks overtime.
                                    const showAsWorkday = (
                                      hasWork
                                      && !fullLeave
                                      && !halfLeave
                                      && !sunday
                                    );
                                    const dayTitle = [
                                      cell.hasUnassignedRegular
                                        ? 'Unassigned regular day — set a whole-day project or daytime shifts'
                                        : null,
                                      hasOt ? `${formatOtHours(cell.overtimeHours)} OT` : null,
                                      cell.kind === 'holiday' ? cell.holidayName : null,
                                      cell.kind === 'sunday' && !hasOt ? 'Sunday' : null,
                                      cell.kind === 'leave' ? 'Full-day leave' : null,
                                      cell.kind === 'leave_half' ? 'Half-day leave' : null,
                                    ].filter(Boolean).join(' · ') || cell.date;
                                    return (
                                      <button
                                        key={cell.date}
                                        type="button"
                                        title={dayTitle}
                                        className={[
                                          'hr-salary__day',
                                          hasWork ? 'has-work' : '',
                                          hasOt ? 'has-ot' : '',
                                          showAsWorkday ? 'is-regular' : '',
                                          sunday && hasOt ? 'is-sunday-ot' : '',
                                          cell.hasUnassignedRegular ? 'has-unassigned' : '',
                                          `is-${cell.kind}`,
                                          selectedDate === cell.date ? 'is-selected' : '',
                                          halfLeave && hasOt ? 'has-leave-half' : '',
                                          fullLeave && hasOt ? 'has-leave' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={e => {
                                          e.stopPropagation();
                                          selectDay(row.staffUid, cell.date);
                                        }}
                                      >
                                        <span className="hr-salary__day-num">{cell.day}</span>
                                        {hasOt ? (
                                          <span className="hr-salary__day-ot-badge">OT</span>
                                        ) : null}
                                        {cell.projectColors.length > 0 || cell.hasUnassignedRegular ? (
                                          <span className="hr-salary__day-dots" aria-hidden>
                                            {cell.projectColors.map(color => (
                                              <i
                                                key={color}
                                                className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                                                style={{ background: color }}
                                              />
                                            ))}
                                            {cell.hasUnassignedRegular ? (
                                              <i
                                                className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty"
                                                title="Unassigned"
                                              />
                                            ) : null}
                                          </span>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="hr-salary__legend" aria-label="Calendar colour legend">
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__legend-swatch is-workday" />
                                  Workday
                                </span>
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__legend-swatch is-leave" />
                                  Leave
                                </span>
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__legend-swatch is-leave-half" />
                                  Half leave
                                </span>
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__legend-swatch is-holiday" />
                                  Holiday
                                </span>
                                <span className="hr-salary__legend-item">
                                  <span className="hr-salary__legend-ot-badge">OT</span>
                                  Overtime
                                </span>
                                {draft.projects.map(project => (
                                  <span key={project.id} className="hr-salary__legend-item">
                                    <i
                                      className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                                      style={{ background: project.color }}
                                    />
                                    {project.name}
                                  </span>
                                ))}
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty" />
                                  Unassigned day
                                </span>
                              </div>
                              </div>

                              <div className="hr-salary__day-panel">
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
                                    projects={draft.projects}
                                    dayProjectId={workProjectIdForDate(
                                      draft.workDayEntries,
                                      selectedDate,
                                    )}
                                    workShifts={draft.workShiftEntries
                                      .filter(e => e.date === selectedDate)
                                      .sort((a, b) => a.startTime.localeCompare(b.startTime))}
                                    joinedAt={
                                      draft.dayJoinEntries.find(e => e.date === selectedDate)?.joinedAt
                                      ?? null
                                    }
                                    clockedOutAt={
                                      draft.dayJoinEntries.find(e => e.date === selectedDate)?.clockedOutAt
                                      ?? null
                                    }
                                    entries={draft.overtimeEntries
                                      .filter(e => e.date === selectedDate)
                                      .sort((a, b) => a.startTime.localeCompare(b.startTime))}
                                    onClose={() => setSelectedDate(null)}
                                    onSetLeave={kind => setLeaveForDay(row.staffUid, selectedDate, kind)}
                                    onSetDayProject={projectId => setDayProject(
                                      row.staffUid,
                                      selectedDate,
                                      projectId,
                                    )}
                                    onSetDayClock={patch => setDayClockForDay(
                                      row.staffUid,
                                      selectedDate,
                                      patch,
                                    )}
                                    onAddWorkShift={() => addWorkShiftEntry(row.staffUid, selectedDate)}
                                    onPatchWorkShift={(entryId, patch) => patchWorkShiftEntry(
                                      row.staffUid,
                                      entryId,
                                      patch,
                                    )}
                                    onRemoveWorkShift={entryId => removeWorkShiftEntry(
                                      row.staffUid,
                                      entryId,
                                    )}
                                    onAddOt={() => addOtEntry(row.staffUid, selectedDate)}
                                    onPatchOt={(entryId, patch) => patchOtEntry(row.staffUid, entryId, patch)}
                                    onRemoveOt={entryId => removeOtEntry(row.staffUid, entryId)}
                                    expenses={draft.expenseEntries.filter(e => e.date === selectedDate)}
                                    receipts={draft.receiptEntries.filter(e => e.date === selectedDate)}
                                    onAddExpense={() => addExpenseEntry(row.staffUid, selectedDate)}
                                    onPatchExpense={(entryId, patch) => patchExpenseEntry(
                                      row.staffUid,
                                      entryId,
                                      patch,
                                    )}
                                    onRemoveExpense={entryId => removeExpenseEntry(row.staffUid, entryId)}
                                    onAddReceipt={kind => addReceiptEntry(row.staffUid, selectedDate, kind)}
                                    onPatchReceipt={(entryId, patch) => patchReceiptEntry(
                                      row.staffUid,
                                      entryId,
                                      patch,
                                    )}
                                    onRemoveReceipt={entryId => removeReceiptEntry(row.staffUid, entryId)}
                                  />
                                ) : (
                                  <div className="hr-salary__day-panel-empty">
                                    <p>Select a day on the calendar</p>
                                    <p className="text-sm text-muted">
                                      Edit project, clock times, shifts, leave, expenses, and OT.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <ExpenseSettlementCard
                              settlement={settlement}
                              earnedSalary={calc.earnedSalary}
                              expenseEntries={draft.expenseEntries}
                              receiptEntries={draft.receiptEntries}
                              onLineClick={date => selectDay(row.staffUid, date)}
                              downloadFileName={`${row.displayName
                                .trim()
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '-')
                                .replace(/^-|-$/g, '') || 'staff'}-expenses-${salaryPeriodKey(period)}`}
                            />

                            <div className="hr-salary__card hr-salary__ot-detail">
                              <div className="hr-salary__ot-detail-head">
                                <h5>Overtime</h5>
                                <span>
                                  {formatOtHours(calc.overtimeHours)}
                                  {' · '}
                                  {formatInr(calc.overtimePay)}
                                </span>
                              </div>
                              <div className="hr-salary__legend hr-salary__legend--ot" aria-label="Overtime project legend">
                                {draft.projects.map(project => (
                                  <span key={project.id} className="hr-salary__legend-item">
                                    <i
                                      className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                                      style={{ background: project.color }}
                                    />
                                    {project.name}
                                  </span>
                                ))}
                                <span className="hr-salary__legend-item">
                                  <i className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty" />
                                  Unassigned
                                </span>
                              </div>
                              {otLines.length === 0 ? (
                                <p className="hr-salary__project-empty">No overtime yet</p>
                              ) : (
                                <ul className="hr-salary__ot-detail-list">
                                  {otLines.map(line => (
                                    <li key={line.id}>
                                      <button
                                        type="button"
                                        className="hr-salary__ot-detail-line"
                                        onClick={() => {
                                          if (line.project) setActiveProjectId(line.project.id);
                                          selectDay(row.staffUid, line.date);
                                        }}
                                      >
                                        <span className="hr-salary__ot-detail-date">
                                          {line.project ? (
                                            <i
                                              className="hr-salary__proj-dot hr-salary__proj-dot--mini"
                                              style={{ background: line.project.color }}
                                              title={line.project.name}
                                            />
                                          ) : (
                                            <i
                                              className="hr-salary__proj-dot hr-salary__proj-dot--mini is-empty"
                                              title="Unassigned"
                                            />
                                          )}
                                          {formatDayLabel(line.date)}
                                        </span>
                                        <span className="hr-salary__ot-detail-time">
                                          {formatTimeAmPm(line.startTime)} – {formatTimeAmPm(line.endTime)}
                                        </span>
                                        <span className="hr-salary__ot-detail-hrs">
                                          {line.makeupHours > 0 ? (
                                            <>
                                              {formatOtHours(line.billableOtHours)} OT
                                              {' + '}
                                              {formatOtHours(line.makeupHours)} reg
                                            </>
                                          ) : (
                                            formatOtHours(line.hours)
                                          )}
                                        </span>
                                        <span className="hr-salary__ot-detail-pay">
                                          {formatInr(line.pay)}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>

                          <div className="hr-salary__footer-summary">
                            <table className="hr-salary__summary-table">
                              <thead>
                                <tr>
                                  <th>Project</th>
                                  <th>%</th>
                                  <th>Days</th>
                                  <th>OT</th>
                                  <th>Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {projectTotals.map(total => (
                                  <tr key={total.projectId ?? '__unassigned'}>
                                    <td>
                                      <div className="hr-salary__project-cell">
                                        <i
                                          className={[
                                            'hr-salary__proj-dot',
                                            total.color ? '' : 'is-empty',
                                          ].filter(Boolean).join(' ')}
                                          style={total.color ? { background: total.color } : undefined}
                                        />
                                        {total.name}
                                      </div>
                                    </td>
                                    <td>
                                      {formatWorkPercent(
                                        projectSharePercents.get(total.projectId ?? '__unassigned') ?? 0,
                                      )}
                                    </td>
                                    <td>{total.regularDays}d</td>
                                    <td>{formatOtHours(total.otHours)}</td>
                                    <td>{formatInr(total.totalPay)}</td>
                                  </tr>
                                ))}
                                <tr className="hr-salary__summary-total-row">
                                  <td colSpan={4}>Total Earned</td>
                                  <td>{formatInr(settlement.netPayable)}</td>
                                </tr>
                              </tbody>
                            </table>
                            <div className="hr-salary__footer-stats">
                              <span>
                                <strong>Leave:</strong> {formatLeaveDays(calc.leaveDays)}
                              </span>
                              <span>
                                <strong>Payable:</strong> {calc.payableDays} / {calc.rateDays}
                              </span>
                              <span>
                                <strong>Regular pay:</strong> {formatInr(calc.regularPay)}
                              </span>
                              <span>
                                <strong>OT hours:</strong> {formatOtHours(calc.overtimeHours)}
                              </span>
                              <span>
                                <strong>OT pay:</strong> {formatInr(calc.overtimePay)}
                              </span>
                            </div>
                          </div>
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
