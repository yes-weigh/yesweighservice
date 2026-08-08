import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { holidaysInMonth } from './hrHolidays';
import { fetchPayrollEmployees, payrollEmployeeSalaryKey } from './hrPayrollEmployees';
import type { HrHoliday } from '../types/hr-holiday';
import type {
  HrDayJoinEntry,
  HrExpenseEntry,
  HrExpenseSettlement,
  HrExpenseSettlementLine,
  HrLeaveEntry,
  HrLeaveKind,
  HrOvertimeEntry,
  HrSalaryCalc,
  HrSalaryDayCell,
  HrSalaryMonthInput,
  HrSalaryMonthRecord,
  HrSalaryPeriod,
  HrSalaryProject,
  HrSalaryReceiptEntry,
  HrWorkDayEntry,
  HrWorkShiftEntry,
} from '../types/hr-salary';
import {
  HR_SALARY_HOURS_PER_DAY,
  HR_SALARY_STANDARD_END_TIME,
  HR_SALARY_STANDARD_START_TIME,
  salaryPeriodKey,
} from '../types/hr-salary';
import type { StaffDepartment } from '../types/staff-access';

const COLLECTION = 'hrSalaryMonths';

export type HrSalaryStaffRow = {
  /** Portal user uid, or `ext_{payrollEmployeeId}` for non-user employees. */
  staffUid: string;
  displayName: string;
  department: StaffDepartment;
  designation: string | null;
  employeeId: string | null;
  active: boolean;
  /** Portal staff vs payroll-only employee (no login). */
  source: 'user' | 'external';
  monthlySalary: number;
  perDaySalary: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  workShiftEntries: HrWorkShiftEntry[];
  dayJoinEntries: HrDayJoinEntry[];
  overtimeEntries: HrOvertimeEntry[];
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
  /** Reused when copying a public share link for this staff+period. */
  publicShareToken: string | null;
  calc: HrSalaryCalc;
};

/** Distinct palette for project color dots. */
export const HR_PROJECT_COLORS = [
  '#22d3ee',
  '#f97316',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#fb7185',
  '#2dd4bf',
  '#c084fc',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Count Sundays in calendar month (local date math). */
export function countSundaysInMonth(year: number, month: number): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let day = 1; day <= total; day += 1) {
    if (new Date(year, month - 1, day).getDay() === 0) count += 1;
  }
  return count;
}

/** Weekday holidays in month (Sunday holidays excluded to avoid double-counting). */
export function countWeekdayHolidaysInMonth(
  holidays: HrHoliday[],
  year: number,
  month: number,
): number {
  const monthHolidays = holidaysInMonth(holidays, year, month);
  let count = 0;
  for (const holiday of monthHolidays) {
    const [y, m, d] = holiday.date.split('-').map(Number);
    if (!y || !m || !d) continue;
    if (new Date(y, m - 1, d).getDay() === 0) continue;
    count += 1;
  }
  return count;
}

/**
 * Working-day basis for monthly → per-day:
 * total days − Sundays − weekday public/company holidays.
 */
export function salaryRateDays(
  year: number,
  month: number,
  holidays: HrHoliday[],
): number {
  return Math.max(
    0,
    daysInMonth(year, month)
      - countSundaysInMonth(year, month)
      - countWeekdayHolidaysInMonth(holidays, year, month),
  );
}

export function perDayFromMonthly(monthlySalary: number, rateDays: number): number {
  const monthly = Math.max(0, Number(monthlySalary) || 0);
  if (!(monthly > 0) || !(rateDays > 0)) return 0;
  return Math.round((monthly / rateDays) * 100) / 100;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeToMinutes(value: string): number | null {
  const match = TIME_RE.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Duration in hours. If end ≤ start, treat as crossing midnight. */
export function overtimeEntryHours(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return 0;
  let mins = end - start;
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

export function newOvertimeEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextProjectColor(existing: HrSalaryProject[]): string {
  const used = new Set(existing.map(p => p.color.toLowerCase()));
  const free = HR_PROJECT_COLORS.find(color => !used.has(color.toLowerCase()));
  if (free) return free;
  return HR_PROJECT_COLORS[existing.length % HR_PROJECT_COLORS.length];
}

export function createSalaryProject(
  name = 'Project',
  existing: HrSalaryProject[] = [],
): HrSalaryProject {
  return {
    id: newProjectId(),
    name: name.trim() || 'Project',
    color: nextProjectColor(existing),
  };
}

export function createOvertimeEntry(
  date: string,
  startTime = '18:00',
  endTime = '20:00',
  projectId: string | null = null,
): HrOvertimeEntry {
  return {
    id: newOvertimeEntryId(),
    date,
    startTime,
    endTime,
    projectId,
  };
}

export function createWorkShiftEntry(
  date: string,
  startTime = HR_SALARY_STANDARD_START_TIME,
  endTime = '17:30',
  projectId: string | null = null,
): HrWorkShiftEntry {
  return {
    id: newOvertimeEntryId(),
    date,
    startTime,
    endTime,
    projectId,
  };
}

export function createExpenseEntry(
  date: string,
  amount = 0,
  note = '',
): HrExpenseEntry {
  return {
    id: newOvertimeEntryId(),
    date,
    amount: Math.max(0, Number(amount) || 0),
    note: note.trim().slice(0, 120),
  };
}

export function createSalaryReceiptEntry(
  date: string,
  kind: HrSalaryReceiptEntry['kind'] = 'reimbursement',
  amount = 0,
  note = '',
): HrSalaryReceiptEntry {
  return {
    id: newOvertimeEntryId(),
    date,
    kind,
    amount: Math.max(0, Number(amount) || 0),
    note: note.trim().slice(0, 120),
  };
}

export function normalizeExpenseEntries(
  entries: HrExpenseEntry[],
  period: HrSalaryPeriod,
): HrExpenseEntry[] {
  const key = salaryPeriodKey(period);
  return entries
    .map(entry => ({
      id: String(entry.id || newOvertimeEntryId()),
      date: String(entry.date || '').trim(),
      amount: Math.max(0, Number(entry.amount) || 0),
      note: String(entry.note ?? '').trim().slice(0, 120),
    }))
    .filter(entry => entry.date.startsWith(key) && entry.amount > 0)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });
}

export function normalizeSalaryReceiptEntries(
  entries: HrSalaryReceiptEntry[],
  period: HrSalaryPeriod,
): HrSalaryReceiptEntry[] {
  const key = salaryPeriodKey(period);
  return entries
    .map(entry => ({
      id: String(entry.id || newOvertimeEntryId()),
      date: String(entry.date || '').trim(),
      kind: entry.kind === 'salary_advance' ? 'salary_advance' as const : 'reimbursement' as const,
      amount: Math.max(0, Number(entry.amount) || 0),
      note: String(entry.note ?? '').trim().slice(0, 120),
    }))
    .filter(entry => entry.date.startsWith(key) && entry.amount > 0)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });
}

export function computeExpenseSettlement(
  expenseEntries: HrExpenseEntry[],
  receiptEntries: HrSalaryReceiptEntry[],
  earnedSalary: number,
  period?: HrSalaryPeriod,
): HrExpenseSettlement {
  const expenses = period
    ? normalizeExpenseEntries(expenseEntries, period)
    : expenseEntries;
  const receipts = period
    ? normalizeSalaryReceiptEntries(receiptEntries, period)
    : receiptEntries;
  const totalExpenses = Math.round(
    expenses.reduce((sum, entry) => sum + entry.amount, 0) * 100,
  ) / 100;
  const totalReimbursements = Math.round(
    receipts
      .filter(entry => entry.kind === 'reimbursement')
      .reduce((sum, entry) => sum + entry.amount, 0) * 100,
  ) / 100;
  const totalSalaryAdvances = Math.round(
    receipts
      .filter(entry => entry.kind === 'salary_advance')
      .reduce((sum, entry) => sum + entry.amount, 0) * 100,
  ) / 100;
  const unreimbursedExpenses = Math.round(
    Math.max(0, totalExpenses - totalReimbursements) * 100,
  ) / 100;
  const netPayable = Math.round(
    (Math.max(0, Number(earnedSalary) || 0) + unreimbursedExpenses - totalSalaryAdvances) * 100,
  ) / 100;
  return {
    totalExpenses,
    totalReimbursements,
    totalSalaryAdvances,
    unreimbursedExpenses,
    netPayable,
  };
}

/** Flat, date-sorted lines for expense / payment detail lists. */
export function buildExpenseSettlementLines(
  expenseEntries: HrExpenseEntry[],
  receiptEntries: HrSalaryReceiptEntry[],
): HrExpenseSettlementLine[] {
  const lines = [
    ...expenseEntries.map(entry => ({
      id: entry.id,
      date: entry.date,
      kind: 'expense' as const,
      note: entry.note?.trim() || null,
      amount: entry.amount,
      sign: '+' as const,
    })),
    ...receiptEntries.map(entry => ({
      id: entry.id,
      date: entry.date,
      kind: entry.kind,
      note: entry.note?.trim() || null,
      amount: entry.amount,
      sign: '−' as const,
    })),
  ]
    .filter(line => line.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  // Balance is unreimbursed expenses only — salary advances do not affect it.
  let cumExpenses = 0;
  let cumReimbursements = 0;
  return lines.map(line => {
    if (line.kind === 'expense') cumExpenses += line.amount;
    else if (line.kind === 'reimbursement') cumReimbursements += line.amount;
    const balance = Math.round((cumExpenses - cumReimbursements) * 100) / 100;
    return { ...line, balance };
  });
}

export function normalizeProjects(projects: HrSalaryProject[]): HrSalaryProject[] {
  const seen = new Set<string>();
  const normalized: HrSalaryProject[] = [];
  for (const project of projects) {
    const id = String(project.id || newProjectId());
    if (seen.has(id)) continue;
    seen.add(id);
    const color = String(project.color || '').trim() || nextProjectColor(normalized);
    normalized.push({
      id,
      name: String(project.name || '').trim() || 'Project',
      color,
    });
  }
  return normalized;
}

export function normalizeWorkDayEntries(
  entries: HrWorkDayEntry[],
  period: HrSalaryPeriod,
  projectIds: Set<string>,
): HrWorkDayEntry[] {
  const key = salaryPeriodKey(period);
  const byDate = new Map<string, string>();
  for (const entry of entries) {
    const date = String(entry.date || '').trim();
    const projectId = String(entry.projectId || '').trim();
    if (!date.startsWith(key) || !projectIds.has(projectId)) continue;
    byDate.set(date, projectId);
  }
  return [...byDate.entries()]
    .map(([date, projectId]) => ({ date, projectId }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function workProjectIdForDate(
  workDayEntries: HrWorkDayEntry[],
  date: string,
): string | null {
  return workDayEntries.find(e => e.date === date)?.projectId ?? null;
}

export function normalizeOvertimeEntries(
  entries: HrOvertimeEntry[],
  period: HrSalaryPeriod,
): HrOvertimeEntry[] {
  const key = salaryPeriodKey(period);
  return entries
    .map(entry => ({
      id: String(entry.id || newOvertimeEntryId()),
      date: String(entry.date || '').trim(),
      startTime: String(entry.startTime || '').trim(),
      endTime: String(entry.endTime || '').trim(),
      projectId: entry.projectId != null && String(entry.projectId).trim()
        ? String(entry.projectId).trim()
        : null,
    }))
    .filter(entry => (
      entry.date.startsWith(key)
      && TIME_RE.test(entry.startTime)
      && TIME_RE.test(entry.endTime)
      && overtimeEntryHours(entry.startTime, entry.endTime) > 0
    ))
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.startTime.localeCompare(b.startTime);
    });
}

export function normalizeWorkShiftEntries(
  entries: HrWorkShiftEntry[],
  period: HrSalaryPeriod,
): HrWorkShiftEntry[] {
  return normalizeOvertimeEntries(entries, period);
}

export function normalizeDayJoinEntries(
  entries: HrDayJoinEntry[],
  period: HrSalaryPeriod,
): HrDayJoinEntry[] {
  const key = salaryPeriodKey(period);
  const byDate = new Map<string, HrDayJoinEntry>();
  for (const entry of entries) {
    const date = String(entry.date || '').trim();
    const joinedAt = String(entry.joinedAt || '').trim();
    if (!date.startsWith(key) || !TIME_RE.test(joinedAt)) continue;
    const clockedOutAtRaw = entry.clockedOutAt != null ? String(entry.clockedOutAt).trim() : '';
    const clockedOutAt = TIME_RE.test(clockedOutAtRaw) ? clockedOutAtRaw : null;
    byDate.set(date, {
      date,
      joinedAt,
      ...(clockedOutAt ? { clockedOutAt } : {}),
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Regular hours from explicit clock-in / clock-out (defaults to standard day window). */
export function dayJoinRegularHours(
  joinEntry: HrDayJoinEntry | null | undefined,
  standardStart = HR_SALARY_STANDARD_START_TIME,
  standardEnd = HR_SALARY_STANDARD_END_TIME,
): number {
  if (!joinEntry) return 0;
  const start = joinEntry.joinedAt || standardStart;
  const end = joinEntry.clockedOutAt || standardEnd;
  return overtimeEntryHours(start, end);
}

/** True when clock times differ from the standard 9:30–17:30 window. */
export function dayJoinHasCustomClock(
  joinEntry: HrDayJoinEntry | null | undefined,
  standardStart = HR_SALARY_STANDARD_START_TIME,
  standardEnd = HR_SALARY_STANDARD_END_TIME,
): boolean {
  if (!joinEntry) return false;
  if (joinEntry.joinedAt !== standardStart) return true;
  if (joinEntry.clockedOutAt && joinEntry.clockedOutAt !== standardEnd) return true;
  return false;
}

/** Merge clock patch into day join list; drops row when times match standard day. */
export function applyDayClockPatch(
  date: string,
  entries: HrDayJoinEntry[],
  patch: { joinedAt?: string | null; clockedOutAt?: string | null },
): HrDayJoinEntry[] {
  const existing = entries.find(entry => entry.date === date);
  const joinedAt = patch.joinedAt !== undefined
    ? (patch.joinedAt || HR_SALARY_STANDARD_START_TIME)
    : (existing?.joinedAt ?? HR_SALARY_STANDARD_START_TIME);
  const clockedOutAt = patch.clockedOutAt !== undefined
    ? patch.clockedOutAt
    : (existing?.clockedOutAt ?? null);
  const candidate: HrDayJoinEntry = {
    date,
    joinedAt,
    ...(clockedOutAt ? { clockedOutAt } : {}),
  };
  const next = entries.filter(entry => entry.date !== date);
  if (dayJoinHasCustomClock(candidate)) next.push(candidate);
  return next.sort((a, b) => a.date.localeCompare(b.date));
}

/** Hours between standard start and actual join (from shift start or explicit join time). */
export function morningDeficitHoursForDate(
  date: string,
  workShiftEntries: HrWorkShiftEntry[],
  dayJoinEntries: HrDayJoinEntry[],
  standardStart = HR_SALARY_STANDARD_START_TIME,
): number {
  const shifts = workShiftEntries.filter(entry => entry.date === date);
  const joinEntry = dayJoinEntries.find(entry => entry.date === date);
  let actualStart: string | null = joinEntry?.joinedAt ?? null;
  if (shifts.length > 0) {
    const earliestShift = shifts.reduce(
      (earliest, entry) => (entry.startTime < earliest ? entry.startTime : earliest),
      shifts[0].startTime,
    );
    actualStart = !actualStart || earliestShift < actualStart ? earliestShift : actualStart;
  }
  if (!actualStart) return 0;
  const stdMins = parseTimeToMinutes(standardStart);
  const actualMins = parseTimeToMinutes(actualStart);
  if (stdMins == null || actualMins == null || actualMins <= stdMins) return 0;
  return Math.round(((actualMins - stdMins) / 60) * 100) / 100;
}

export function splitOtHoursWithMorningMakeup(
  otHours: number,
  deficitHours: number,
): { makeupHours: number; billableOtHours: number } {
  const ot = Math.max(0, Number(otHours) || 0);
  const deficit = Math.max(0, Number(deficitHours) || 0);
  const makeupHours = Math.round(Math.min(ot, deficit) * 100) / 100;
  return {
    makeupHours,
    billableOtHours: Math.round((ot - makeupHours) * 100) / 100,
  };
}

export type HrOvertimePaySplit = {
  overtimePay: number;
  overtimeHours: number;
  weekdayOvertimeHours: number;
  sundayHours: number;
  makeupRegularHours: number;
  makeupRegularPay: number;
  /** Per OT entry: hours paid at OT rate vs regular makeup rate. */
  entryPay: Map<string, { makeupHours: number; billableOtHours: number; pay: number }>;
};

export function computeOvertimePayWithMakeup(
  overtimeEntries: HrOvertimeEntry[],
  workShiftEntries: HrWorkShiftEntry[],
  dayJoinEntries: HrDayJoinEntry[],
  period: HrSalaryPeriod,
  hourlyRate: number,
  otHourlyRate: number,
): HrOvertimePaySplit {
  const normalizedOt = normalizeOvertimeEntries(overtimeEntries, period);
  const normalizedShifts = normalizeWorkShiftEntries(workShiftEntries, period);
  const normalizedJoins = normalizeDayJoinEntries(dayJoinEntries, period);
  const otByDate = new Map<string, HrOvertimeEntry[]>();
  for (const entry of normalizedOt) {
    const list = otByDate.get(entry.date) ?? [];
    list.push(entry);
    otByDate.set(entry.date, list);
  }

  let sundayHours = 0;
  let weekdayBillableOtHours = 0;
  let makeupRegularHours = 0;
  let overtimePay = 0;
  let makeupRegularPay = 0;
  const entryPay = new Map<string, { makeupHours: number; billableOtHours: number; pay: number }>();

  for (const [date, entries] of otByDate.entries()) {
    const rawHours = entries.reduce(
      (sum, entry) => sum + overtimeEntryHours(entry.startTime, entry.endTime),
      0,
    );
    if (rawHours <= 0) continue;

    const isSunday = isSundayIsoDate(date);
    if (isSunday) {
      sundayHours = Math.round((sundayHours + rawHours) * 100) / 100;
      for (const entry of entries) {
        const hours = overtimeEntryHours(entry.startTime, entry.endTime);
        if (hours <= 0) continue;
        const pay = Math.round(hours * otHourlyRate * 100) / 100;
        overtimePay += pay;
        entryPay.set(entry.id, { makeupHours: 0, billableOtHours: hours, pay });
      }
      continue;
    }

    const deficit = morningDeficitHoursForDate(date, normalizedShifts, normalizedJoins);
    const { makeupHours, billableOtHours } = splitOtHoursWithMorningMakeup(rawHours, deficit);
    weekdayBillableOtHours = Math.round((weekdayBillableOtHours + billableOtHours) * 100) / 100;
    makeupRegularHours = Math.round((makeupRegularHours + makeupHours) * 100) / 100;
    makeupRegularPay = Math.round((makeupRegularPay + makeupHours * hourlyRate) * 100) / 100;
    overtimePay = Math.round((overtimePay + billableOtHours * otHourlyRate) * 100) / 100;

    let makeupLeft = makeupHours;
    let billableLeft = billableOtHours;
    for (const entry of entries) {
      const hours = overtimeEntryHours(entry.startTime, entry.endTime);
      if (hours <= 0) continue;
      const entryMakeup = Math.min(hours, makeupLeft);
      makeupLeft = Math.round((makeupLeft - entryMakeup) * 100) / 100;
      const entryBillable = Math.round((hours - entryMakeup) * 100) / 100;
      billableLeft = Math.round((billableLeft - entryBillable) * 100) / 100;
      const pay = Math.round((entryMakeup * hourlyRate + entryBillable * otHourlyRate) * 100) / 100;
      entryPay.set(entry.id, {
        makeupHours: entryMakeup,
        billableOtHours: entryBillable,
        pay,
      });
    }
  }

  const overtimeHours = Math.round((sundayHours + weekdayBillableOtHours + makeupRegularHours) * 100) / 100;
  return {
    overtimePay: Math.round(overtimePay * 100) / 100,
    overtimeHours,
    weekdayOvertimeHours: weekdayBillableOtHours,
    sundayHours: Math.round(sundayHours * 100) / 100,
    makeupRegularHours,
    makeupRegularPay: Math.round(makeupRegularPay * 100) / 100,
    entryPay,
  };
}

function computeRegularPayFromAttendance(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveEntries: HrLeaveEntry[],
  workDayEntries: HrWorkDayEntry[],
  workShiftEntries: HrWorkShiftEntry[],
  dayJoinEntries: HrDayJoinEntry[],
  overtimeEntries: HrOvertimeEntry[],
  projects: HrSalaryProject[],
  perDaySalary: number,
): { regularPay: number; payableDays: number; regularHours: number } {
  const monthHolidays = holidaysInMonth(holidays, period.year, period.month);
  const weekdayHolidayDates = new Set(
    monthHolidays
      .filter(h => {
        const [y, m, d] = h.date.split('-').map(Number);
        if (!y || !m || !d) return false;
        return new Date(y, m - 1, d).getDay() !== 0;
      })
      .map(h => h.date),
  );
  const leaveMap = new Map(
    normalizeLeaveEntries(leaveEntries, period).map(e => [e.date, e.kind]),
  );
  const projectIds = new Set(projects.map(p => p.id));
  const workMap = new Map(
    normalizeWorkDayEntries(workDayEntries, period, projectIds).map(e => [e.date, e.projectId]),
  );
  const shiftsByDate = new Map<string, HrWorkShiftEntry[]>();
  for (const entry of normalizeWorkShiftEntries(workShiftEntries, period)) {
    const list = shiftsByDate.get(entry.date) ?? [];
    list.push(entry);
    shiftsByDate.set(entry.date, list);
  }
  const normalizedJoins = normalizeDayJoinEntries(dayJoinEntries, period);
  const otHoursByDate = new Map<string, number>();
  for (const entry of normalizeOvertimeEntries(overtimeEntries, period)) {
    const hours = overtimeEntryHours(entry.startTime, entry.endTime);
    if (hours <= 0) continue;
    otHoursByDate.set(
      entry.date,
      Math.round(((otHoursByDate.get(entry.date) ?? 0) + hours) * 100) / 100,
    );
  }

  let regularPay = 0;
  let payableDays = 0;
  let regularHours = 0;
  const total = daysInMonth(period.year, period.month);
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    if (dow === 0 || weekdayHolidayDates.has(date)) continue;
    const leaveKind = leaveMap.get(date);
    if (leaveKind === 'full') continue;
    const basePayable = leaveKind === 'half' ? 0.5 : 1;
    const shifts = shiftsByDate.get(date) ?? [];
    const joinEntry = normalizedJoins.find(entry => entry.date === date) ?? null;
    const usesTimedRegular = shifts.length > 0 || dayJoinHasCustomClock(joinEntry);

    if (usesTimedRegular) {
      const shiftHours = shifts.reduce(
        (sum, entry) => sum + overtimeEntryHours(entry.startTime, entry.endTime),
        0,
      );
      const clockHours = shifts.length > 0 ? 0 : dayJoinRegularHours(joinEntry);
      const workedHours = shifts.length > 0 ? shiftHours : clockHours;
      const deficit = morningDeficitHoursForDate(date, shifts, normalizedJoins);
      const { makeupHours } = splitOtHoursWithMorningMakeup(otHoursByDate.get(date) ?? 0, deficit);
      const effectiveRegularHours = Math.min(
        basePayable * HR_SALARY_HOURS_PER_DAY,
        Math.round((workedHours + makeupHours) * 100) / 100,
      );
      const dayDays = Math.round((effectiveRegularHours / HR_SALARY_HOURS_PER_DAY) * 100) / 100;
      payableDays = Math.round((payableDays + dayDays) * 100) / 100;
      regularHours = Math.round((regularHours + effectiveRegularHours) * 100) / 100;
      regularPay = Math.round((regularPay + dayDays * perDaySalary) * 100) / 100;
      continue;
    }

    if (workMap.has(date)) {
      payableDays = Math.round((payableDays + basePayable) * 100) / 100;
      regularHours = Math.round((regularHours + basePayable * HR_SALARY_HOURS_PER_DAY) * 100) / 100;
      regularPay = Math.round((regularPay + basePayable * perDaySalary) * 100) / 100;
      continue;
    }

    payableDays = Math.round((payableDays + basePayable) * 100) / 100;
    regularHours = Math.round((regularHours + basePayable * HR_SALARY_HOURS_PER_DAY) * 100) / 100;
    regularPay = Math.round((regularPay + basePayable * perDaySalary) * 100) / 100;
  }

  return { regularPay, payableDays, regularHours };
}

export type HrProjectWorkTotal = {
  projectId: string | null;
  name: string;
  color: string | null;
  /** Payable regular days attributed to this project. */
  regularDays: number;
  regularPay: number;
  otHours: number;
  otPay: number;
  totalPay: number;
};

function emptyProjectTotal(
  projectId: string | null,
  name: string,
  color: string | null,
): HrProjectWorkTotal {
  return {
    projectId,
    name,
    color,
    regularDays: 0,
    regularPay: 0,
    otHours: 0,
    otPay: 0,
    totalPay: 0,
  };
}

/** Regular + OT totals per project (and Unassigned). */
export function projectWorkTotals(
  projects: HrSalaryProject[],
  workDayEntries: HrWorkDayEntry[],
  leaveEntries: HrLeaveEntry[],
  overtimeEntries: HrOvertimeEntry[],
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  perDaySalary: number,
  otHourlyRate: number,
  workShiftEntries: HrWorkShiftEntry[] = [],
  dayJoinEntries: HrDayJoinEntry[] = [],
  hourlyRate = perDaySalary / HR_SALARY_HOURS_PER_DAY,
): HrProjectWorkTotal[] {
  const byId = new Map<string, HrProjectWorkTotal>();
  for (const project of projects) {
    byId.set(project.id, emptyProjectTotal(project.id, project.name, project.color));
  }
  let unassigned: HrProjectWorkTotal | null = null;
  const ensureUnassigned = () => {
    if (!unassigned) unassigned = emptyProjectTotal(null, 'Unassigned', null);
    return unassigned;
  };
  const addRegular = (projectId: string | null, days: number) => {
    if (!(days > 0)) return;
    const row = projectId && byId.has(projectId)
      ? byId.get(projectId)!
      : ensureUnassigned();
    row.regularDays = Math.round((row.regularDays + days) * 100) / 100;
    row.regularPay = Math.round((row.regularPay + days * perDaySalary) * 100) / 100;
  };

  const monthHolidays = holidaysInMonth(holidays, period.year, period.month);
  const weekdayHolidayDates = new Set(
    monthHolidays
      .filter(h => {
        const [y, m, d] = h.date.split('-').map(Number);
        if (!y || !m || !d) return false;
        return new Date(y, m - 1, d).getDay() !== 0;
      })
      .map(h => h.date),
  );
  const leaveMap = new Map(
    normalizeLeaveEntries(leaveEntries, period).map(e => [e.date, e.kind]),
  );
  const workMap = new Map(
    normalizeWorkDayEntries(
      workDayEntries,
      period,
      new Set(projects.map(p => p.id)),
    ).map(e => [e.date, e.projectId]),
  );
  const shiftsByDate = new Map<string, HrWorkShiftEntry[]>();
  for (const entry of normalizeWorkShiftEntries(workShiftEntries, period)) {
    const list = shiftsByDate.get(entry.date) ?? [];
    list.push(entry);
    shiftsByDate.set(entry.date, list);
  }

  const total = daysInMonth(period.year, period.month);
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    if (dow === 0 || weekdayHolidayDates.has(date)) continue;
    const leaveKind = leaveMap.get(date);
    if (leaveKind === 'full') continue;
    const payable = leaveKind === 'half' ? 0.5 : 1;
    const shifts = shiftsByDate.get(date) ?? [];
    if (shifts.length > 0) {
      const shiftHours = shifts.reduce(
        (sum, entry) => sum + overtimeEntryHours(entry.startTime, entry.endTime),
        0,
      );
      const shiftOnlyDays = Math.round((Math.min(shiftHours, payable * HR_SALARY_HOURS_PER_DAY) / HR_SALARY_HOURS_PER_DAY) * 100) / 100;
      const portions = shifts.map(entry => {
        const hours = overtimeEntryHours(entry.startTime, entry.endTime);
        return {
          projectId: entry.projectId && byId.has(entry.projectId) ? entry.projectId : null,
          days: shiftHours > 0 ? (hours / shiftHours) * shiftOnlyDays : 0,
        };
      }).filter(p => p.days > 0);
      let attributed = 0;
      for (const portion of portions) {
        const days = Math.round(portion.days * 100) / 100;
        attributed += days;
        addRegular(portion.projectId, days);
      }
      const shiftRemainder = Math.round((shiftOnlyDays - attributed) * 100) / 100;
      if (shiftRemainder > 0.001) addRegular(null, shiftRemainder);
    } else {
      addRegular(workMap.get(date) ?? null, payable);
    }
  }

  const otPaySplit = computeOvertimePayWithMakeup(
    overtimeEntries,
    workShiftEntries,
    dayJoinEntries,
    period,
    hourlyRate,
    otHourlyRate,
  );

  for (const entry of normalizeOvertimeEntries(overtimeEntries, period)) {
    const split = otPaySplit.entryPay.get(entry.id);
    if (!split || split.makeupHours + split.billableOtHours <= 0) continue;
    const projectId = entry.projectId && byId.has(entry.projectId) ? entry.projectId : null;
    const row = projectId ? byId.get(projectId)! : ensureUnassigned();
    row.otHours = Math.round((row.otHours + split.billableOtHours) * 100) / 100;
    row.regularDays = Math.round((row.regularDays + split.makeupHours / HR_SALARY_HOURS_PER_DAY) * 100) / 100;
    row.regularPay = Math.round((row.regularPay + split.makeupHours * hourlyRate) * 100) / 100;
    row.otPay = Math.round((row.otPay + split.billableOtHours * otHourlyRate) * 100) / 100;
  }

  const rows = [...byId.values(), ...(unassigned ? [unassigned] : [])];
  for (const row of rows) {
    row.totalPay = Math.round((row.regularPay + row.otPay) * 100) / 100;
  }
  return rows.filter(row => (
    row.regularDays > 0 || row.otHours > 0 || row.projectId != null
  ));
}

/** Regular hours + OT hours attributed to a project (for share %). */
export function projectWorkHours(row: Pick<HrProjectWorkTotal, 'regularDays' | 'otHours'>): number {
  return Math.round(
    (Number(row.regularDays || 0) * HR_SALARY_HOURS_PER_DAY + Number(row.otHours || 0)) * 100,
  ) / 100;
}

/**
 * Share of each project's work (regular + OT hours) as 0–100.
 * Keys are `projectId` or `__unassigned`.
 */
export function projectWorkSharePercents(rows: HrProjectWorkTotal[]): Map<string, number> {
  const total = rows.reduce((sum, row) => sum + projectWorkHours(row), 0);
  const out = new Map<string, number>();
  if (!(total > 0)) {
    for (const row of rows) out.set(row.projectId ?? '__unassigned', 0);
    return out;
  }
  let allocated = 0;
  rows.forEach((row, index) => {
    const key = row.projectId ?? '__unassigned';
    if (index === rows.length - 1) {
      out.set(key, Math.round((100 - allocated) * 10) / 10);
      return;
    }
    const pct = Math.round((projectWorkHours(row) / total) * 1000) / 10;
    allocated += pct;
    out.set(key, pct);
  });
  return out;
}

export function formatWorkPercent(percent: number): string {
  const n = Number(percent) || 0;
  if (n === 0) return '0%';
  if (Number.isInteger(n)) return `${n}%`;
  return `${n.toFixed(1)}%`;
}

export function overtimeHoursByDate(entries: HrOvertimeEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const hours = overtimeEntryHours(entry.startTime, entry.endTime);
    if (hours <= 0) continue;
    map.set(entry.date, Math.round(((map.get(entry.date) ?? 0) + hours) * 100) / 100);
  }
  return map;
}

export function formatOtHours(hours: number): string {
  const n = Number(hours) || 0;
  if (n === 0) return '0 hrs';
  if (Number.isInteger(n)) return `${n} hr${n === 1 ? '' : 's'}`;
  return `${n.toFixed(2).replace(/\.?0+$/, '')} hrs`;
}

/** Format `HH:mm` (24h) as `h:mm AM/PM`. */
export function formatTimeAmPm(value: string): string {
  const mins = parseTimeToMinutes(value);
  if (mins == null) return value;
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatLeaveDays(days: number): string {
  const n = Math.round((Number(days) || 0) * 100) / 100;
  if (n === 0) return '0 days';
  if (n === 0.5) return '0.5 day';
  if (n === 1) return '1 day';
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)} days`;
}

export function leaveKindForDate(
  leaveEntries: HrLeaveEntry[],
  date: string,
): HrLeaveKind | null {
  const found = leaveEntries.find(e => e.date === date);
  return found?.kind ?? null;
}

export function normalizeLeaveEntries(
  entries: HrLeaveEntry[],
  period: HrSalaryPeriod,
): HrLeaveEntry[] {
  const key = salaryPeriodKey(period);
  const byDate = new Map<string, HrLeaveKind>();
  for (const entry of entries) {
    const date = String(entry.date || '').trim();
    if (!date.startsWith(key)) continue;
    const kind = entry.kind === 'half' ? 'half' : 'full';
    byDate.set(date, kind);
  }
  return [...byDate.entries()]
    .map(([date, kind]) => ({ date, kind }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildMonthDayCells(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveEntries: HrLeaveEntry[],
  overtimeEntries: HrOvertimeEntry[] = [],
  projects: HrSalaryProject[] = [],
  workDayEntries: HrWorkDayEntry[] = [],
  workShiftEntries: HrWorkShiftEntry[] = [],
): HrSalaryDayCell[] {
  const leaveMap = new Map(
    normalizeLeaveEntries(leaveEntries, period).map(e => [e.date, e.kind]),
  );
  const otHours = overtimeHoursByDate(overtimeEntries);
  const holidayMap = new Map(
    holidaysInMonth(holidays, period.year, period.month).map(h => [h.date, h.name]),
  );
  const projectIds = new Set(projects.map(p => p.id));
  const colorByProject = new Map(projects.map(p => [p.id, p.color]));
  const workMap = new Map(
    normalizeWorkDayEntries(
      workDayEntries,
      period,
      projectIds,
    ).map(e => [e.date, e.projectId]),
  );
  const shiftsByDate = new Map<string, HrWorkShiftEntry[]>();
  for (const entry of normalizeWorkShiftEntries(workShiftEntries, period)) {
    const list = shiftsByDate.get(entry.date) ?? [];
    list.push(entry);
    shiftsByDate.set(entry.date, list);
  }
  const weekdayHolidayDates = new Set(
    holidaysInMonth(holidays, period.year, period.month)
      .filter(h => {
        const [y, m, d] = h.date.split('-').map(Number);
        if (!y || !m || !d) return false;
        return new Date(y, m - 1, d).getDay() !== 0;
      })
      .map(h => h.date),
  );
  const colorsByDate = new Map<string, string[]>();
  const pushColor = (date: string, projectId: string | null | undefined) => {
    if (!projectId) return;
    const color = colorByProject.get(projectId);
    if (!color) return;
    const list = colorsByDate.get(date) ?? [];
    if (!list.includes(color)) list.push(color);
    colorsByDate.set(date, list);
  };
  for (const [date, projectId] of workMap) pushColor(date, projectId);
  for (const entry of normalizeWorkShiftEntries(workShiftEntries, period)) {
    pushColor(entry.date, entry.projectId);
  }
  for (const entry of overtimeEntries) pushColor(entry.date, entry.projectId);

  const hasUnassignedRegular = (date: string, isSunday: boolean, leaveKind: HrLeaveKind | null) => {
    if (isSunday || weekdayHolidayDates.has(date)) return false;
    if (leaveKind === 'full') return false;
    const payable = leaveKind === 'half' ? 0.5 : 1;
    const shifts = shiftsByDate.get(date) ?? [];
    if (shifts.length > 0) {
      const portions = shifts.map(entry => {
        const hours = overtimeEntryHours(entry.startTime, entry.endTime);
        return {
          projectId: entry.projectId && projectIds.has(entry.projectId) ? entry.projectId : null,
          days: hours / HR_SALARY_HOURS_PER_DAY,
        };
      }).filter(p => p.days > 0);
      if (portions.some(p => p.projectId == null)) return true;
      const sumDays = portions.reduce((s, p) => s + p.days, 0);
      const scale = sumDays > payable && sumDays > 0 ? payable / sumDays : 1;
      let attributed = 0;
      for (const portion of portions) {
        attributed += Math.round(portion.days * scale * 100) / 100;
      }
      return Math.round((payable - attributed) * 100) / 100 > 0.001;
    }
    return !workMap.has(date);
  };

  const total = daysInMonth(period.year, period.month);
  const cells: HrSalaryDayCell[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    const holidayName = holidayMap.get(date);
    const hours = otHours.get(date) ?? 0;
    const isSunday = dow === 0;
    const leaveKind = leaveMap.get(date) ?? null;
    const projectColors = colorsByDate.get(date) ?? [];
    const unassignedRegular = hasUnassignedRegular(date, isSunday, leaveKind);

    if (hours > 0) {
      cells.push({
        date,
        day,
        kind: 'overtime',
        holidayName,
        overtimeHours: hours,
        leaveKind,
        projectColors,
        hasUnassignedRegular: unassignedRegular,
      });
    } else if (isSunday) {
      cells.push({
        date,
        day,
        kind: 'sunday',
        overtimeHours: 0,
        leaveKind: null,
        projectColors,
        hasUnassignedRegular: false,
      });
    } else if (holidayName) {
      cells.push({
        date,
        day,
        kind: 'holiday',
        holidayName,
        overtimeHours: 0,
        leaveKind: null,
        projectColors,
        hasUnassignedRegular: unassignedRegular,
      });
    } else if (leaveKind === 'half') {
      cells.push({
        date,
        day,
        kind: 'leave_half',
        overtimeHours: 0,
        leaveKind: 'half',
        projectColors,
        hasUnassignedRegular: unassignedRegular,
      });
    } else if (leaveKind === 'full') {
      cells.push({
        date,
        day,
        kind: 'leave',
        overtimeHours: 0,
        leaveKind: 'full',
        projectColors,
        hasUnassignedRegular: false,
      });
    } else {
      cells.push({
        date,
        day,
        kind: 'working',
        overtimeHours: 0,
        leaveKind: null,
        projectColors,
        hasUnassignedRegular: unassignedRegular,
      });
    }
  }
  return cells;
}

function isSundayIsoDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

/**
 * Earned = payableDays × (monthly ÷ rateDays)
 *         + (Sunday hours + weekday OT hours) × (OT-per-day ÷ 8).
 * rateDays = days − Sundays − weekday holidays.
 * Leave (full=1, half=0.5) reduces payable days.
 */
export function computeSalaryCalc(
  monthlySalaryInput: number,
  otPerDaySalaryInput: number,
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveEntries: HrLeaveEntry[],
  overtimeEntries: HrOvertimeEntry[] = [],
  workShiftEntries: HrWorkShiftEntry[] = [],
  workDayEntries: HrWorkDayEntry[] = [],
  dayJoinEntries: HrDayJoinEntry[] = [],
  projects: HrSalaryProject[] = [],
): HrSalaryCalc {
  const days = daysInMonth(period.year, period.month);
  const sundays = countSundaysInMonth(period.year, period.month);
  const monthHolidays = holidaysInMonth(holidays, period.year, period.month);
  const weekdayHolidayDates = new Set(
    monthHolidays
      .filter(h => {
        const [y, m, d] = h.date.split('-').map(Number);
        if (!y || !m || !d) return false;
        return new Date(y, m - 1, d).getDay() !== 0;
      })
      .map(h => h.date),
  );
  const weekdayHolidays = weekdayHolidayDates.size;
  const rateDays = Math.max(0, days - sundays - weekdayHolidays);

  let fullLeaveDays = 0;
  let halfLeaveDays = 0;
  for (const entry of normalizeLeaveEntries(leaveEntries, period)) {
    if (weekdayHolidayDates.has(entry.date)) continue;
    const [y, m, d] = entry.date.split('-').map(Number);
    if (!y || !m || !d) continue;
    if (new Date(y, m - 1, d).getDay() === 0) continue;
    if (entry.kind === 'half') halfLeaveDays += 1;
    else fullLeaveDays += 1;
  }
  const leaveDays = fullLeaveDays + halfLeaveDays * 0.5;

  const normalizedOt = normalizeOvertimeEntries(overtimeEntries, period);
  const hoursByDate = overtimeHoursByDate(normalizedOt);
  let sundayWorkDays = 0;
  for (const [date, hrs] of hoursByDate.entries()) {
    if (hrs <= 0) continue;
    if (isSundayIsoDate(date)) sundayWorkDays += 1;
  }

  const monthlySalary = Number.isFinite(monthlySalaryInput) && monthlySalaryInput > 0
    ? monthlySalaryInput
    : 0;
  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  const otPerDaySalary = Number.isFinite(otPerDaySalaryInput) && otPerDaySalaryInput > 0
    ? otPerDaySalaryInput
    : 0;
  const hourlyRate = perDaySalary / HR_SALARY_HOURS_PER_DAY;
  const otHourlyRate = otPerDaySalary / HR_SALARY_HOURS_PER_DAY;

  const attendanceRegular = computeRegularPayFromAttendance(
    period,
    holidays,
    leaveEntries,
    workDayEntries,
    workShiftEntries,
    dayJoinEntries,
    overtimeEntries,
    projects,
    perDaySalary,
  );
  const otSplit = computeOvertimePayWithMakeup(
    overtimeEntries,
    workShiftEntries,
    dayJoinEntries,
    period,
    hourlyRate,
    otHourlyRate,
  );

  const payableDays = attendanceRegular.payableDays;
  const regularHours = attendanceRegular.regularHours;
  const regularPay = attendanceRegular.regularPay;
  const overtimeHours = otSplit.overtimeHours;
  const overtimePay = otSplit.overtimePay;
  const earnedSalary = Math.round((regularPay + overtimePay) * 100) / 100;
  const totalWorkHours = Math.round((regularHours + otSplit.weekdayOvertimeHours + otSplit.sundayHours) * 100) / 100;

  return {
    daysInMonth: days,
    sundays,
    weekdayHolidays,
    rateDays,
    leaveDays,
    fullLeaveDays,
    halfLeaveDays,
    overtimeDays: hoursByDate.size,
    overtimeHours,
    payableDays,
    regularHours,
    totalWorkHours,
    monthlySalary,
    perDaySalary,
    sundayWorkDays,
    sundayHours: otSplit.sundayHours,
    weekdayOvertimeHours: otSplit.weekdayOvertimeHours,
    makeupRegularHours: otSplit.makeupRegularHours,
    makeupRegularPay: otSplit.makeupRegularPay,
    regularPay,
    otPerDaySalary,
    hourlyRate,
    otHourlyRate,
    overtimePay,
    earnedSalary,
  };
}

/** Resolve monthly / OT rates (and derived per-day), migrating legacy per-day docs. */
export function resolveSalaryRates(
  saved: Pick<
    HrSalaryMonthRecord,
    'perDaySalary' | 'otPerDaySalary' | 'monthlySalary'
  > | null | undefined,
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  defaults?: {
    monthlySalary?: number;
    perDaySalary?: number;
    otPerDaySalary?: number;
  },
): { monthlySalary: number; perDaySalary: number; otPerDaySalary: number } {
  const rateDays = salaryRateDays(period.year, period.month, holidays);
  const defaultMonthly = Math.max(0, Number(defaults?.monthlySalary) || 0);
  const defaultPerDay = Math.max(0, Number(defaults?.perDaySalary) || 0);
  const defaultOt = Math.max(
    0,
    Number(defaults?.otPerDaySalary)
      || (defaultMonthly > 0 ? perDayFromMonthly(defaultMonthly, rateDays) : defaultPerDay),
  );

  let monthlySalary = 0;
  let otPerDaySalary = defaultOt;

  if (saved) {
    if (Number(saved.monthlySalary) > 0) {
      monthlySalary = Math.max(0, Number(saved.monthlySalary) || 0);
    } else if (Number(saved.perDaySalary) > 0) {
      // Legacy fixed per-day → reconstruct monthly for this period's rate days.
      monthlySalary = Math.round((Number(saved.perDaySalary) * Math.max(rateDays, 1)) * 100) / 100;
    }
    if (Number(saved.otPerDaySalary) > 0) {
      otPerDaySalary = Math.max(0, Number(saved.otPerDaySalary) || 0);
    } else if (monthlySalary > 0) {
      otPerDaySalary = perDayFromMonthly(monthlySalary, rateDays);
    }
  }

  if (!(monthlySalary > 0)) {
    if (defaultMonthly > 0) monthlySalary = defaultMonthly;
    else if (defaultPerDay > 0) {
      monthlySalary = Math.round((defaultPerDay * Math.max(rateDays, 1)) * 100) / 100;
    }
  }

  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  if (!(otPerDaySalary > 0) && perDaySalary > 0) otPerDaySalary = perDaySalary;

  return { monthlySalary, perDaySalary, otPerDaySalary };
}

function mapProjects(data: Record<string, unknown>): HrSalaryProject[] {
  if (!Array.isArray(data.projects)) return [];
  return normalizeProjects(
    data.projects.map(raw => {
      const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
      return {
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        color: String(row.color ?? ''),
      };
    }),
  );
}

function mapWorkDayEntries(data: Record<string, unknown>): HrWorkDayEntry[] {
  if (!Array.isArray(data.workDayEntries)) return [];
  return data.workDayEntries.map(raw => {
    const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    return {
      date: String(row.date ?? ''),
      projectId: String(row.projectId ?? ''),
    };
  }).filter(e => e.date && e.projectId);
}

function mapOvertimeEntries(data: Record<string, unknown>): HrOvertimeEntry[] {
  if (Array.isArray(data.overtimeEntries)) {
    return data.overtimeEntries.map((raw, index) => {
      const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
      const projectId = row.projectId != null && String(row.projectId).trim()
        ? String(row.projectId).trim()
        : null;
      return {
        id: String(row.id ?? `legacy_${index}`),
        date: String(row.date ?? ''),
        startTime: String(row.startTime ?? ''),
        endTime: String(row.endTime ?? ''),
        projectId,
      };
    }).filter(e => e.date);
  }

  // Migrate older whole-day OT flags → one 8-hour block.
  const legacyDates = Array.isArray(data.overtimeDates) ? data.overtimeDates : [];
  return legacyDates.map((value, index) => ({
    id: `migrated_${index}_${String(value)}`,
    date: String(value),
    startTime: '09:00',
    endTime: '17:00',
    projectId: null,
  })).filter(e => e.date);
}

function mapLeaveEntries(data: Record<string, unknown>): HrLeaveEntry[] {
  if (Array.isArray(data.leaveEntries)) {
    return data.leaveEntries.map(raw => {
      const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
      return {
        date: String(row.date ?? ''),
        kind: row.kind === 'half' ? 'half' as const : 'full' as const,
      };
    }).filter(e => e.date);
  }
  // Legacy: leaveDates were always full-day leave.
  const legacy = Array.isArray(data.leaveDates) ? data.leaveDates : [];
  return legacy.map(value => ({ date: String(value), kind: 'full' as const })).filter(e => e.date);
}

function mapWorkShiftEntries(data: Record<string, unknown>): HrWorkShiftEntry[] {
  if (!Array.isArray(data.workShiftEntries)) return [];
  return data.workShiftEntries.map((raw, index) => {
    const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const projectId = row.projectId != null && String(row.projectId).trim()
      ? String(row.projectId).trim()
      : null;
    return {
      id: String(row.id ?? `workshift_${index}`),
      date: String(row.date ?? ''),
      startTime: String(row.startTime ?? ''),
      endTime: String(row.endTime ?? ''),
      projectId,
    };
  }).filter(e => e.date);
}

function mapDayJoinEntries(data: Record<string, unknown>): HrDayJoinEntry[] {
  if (!Array.isArray(data.dayJoinEntries)) return [];
  return data.dayJoinEntries.map(raw => {
    const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const joinedAt = String(row.joinedAt ?? '');
    const clockedOutAtRaw = row.clockedOutAt != null ? String(row.clockedOutAt).trim() : '';
    return {
      date: String(row.date ?? ''),
      joinedAt,
      clockedOutAt: TIME_RE.test(clockedOutAtRaw) ? clockedOutAtRaw : null,
    };
  }).filter(e => e.date && TIME_RE.test(e.joinedAt));
}

function mapExpenseEntries(data: Record<string, unknown>): HrExpenseEntry[] {
  if (!Array.isArray(data.expenseEntries)) return [];
  return data.expenseEntries.map((raw, index) => {
    const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    return {
      id: String(row.id ?? `expense_${index}`),
      date: String(row.date ?? ''),
      amount: Math.max(0, Number(row.amount) || 0),
      note: String(row.note ?? '').trim().slice(0, 120),
    };
  }).filter(e => e.date && e.amount > 0);
}

function mapSalaryReceiptEntries(data: Record<string, unknown>): HrSalaryReceiptEntry[] {
  if (!Array.isArray(data.receiptEntries)) return [];
  return data.receiptEntries.map((raw, index) => {
    const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    return {
      id: String(row.id ?? `receipt_${index}`),
      date: String(row.date ?? ''),
      kind: row.kind === 'salary_advance' ? 'salary_advance' as const : 'reimbursement' as const,
      amount: Math.max(0, Number(row.amount) || 0),
      note: String(row.note ?? '').trim().slice(0, 120),
    };
  }).filter(e => e.date && e.amount > 0);
}

function mapSalaryDoc(id: string, data: Record<string, unknown>): HrSalaryMonthRecord {
  return {
    id,
    uid: String(data.uid ?? ''),
    year: Number(data.year) || 0,
    month: Number(data.month) || 0,
    period: String(data.period ?? ''),
    perDaySalary: Number(data.perDaySalary) || 0,
    otPerDaySalary: Number(data.otPerDaySalary) || 0,
    monthlySalary: Number(data.monthlySalary) || 0,
    leaveEntries: mapLeaveEntries(data),
    projects: mapProjects(data),
    workDayEntries: mapWorkDayEntries(data),
    workShiftEntries: mapWorkShiftEntries(data),
    dayJoinEntries: mapDayJoinEntries(data),
    overtimeEntries: mapOvertimeEntries(data),
    expenseEntries: mapExpenseEntries(data),
    receiptEntries: mapSalaryReceiptEntries(data),
    publicShareToken: data.publicShareToken != null && String(data.publicShareToken).trim()
      ? String(data.publicShareToken).trim()
      : null,
    updatedAt: String(data.updatedAt ?? ''),
    updatedByUid: data.updatedByUid != null ? String(data.updatedByUid) : null,
  };
}

export function salaryMonthDocId(uid: string, period: HrSalaryPeriod): string {
  return `${uid}_${salaryPeriodKey(period)}`;
}

export async function fetchSalaryMonthsForPeriod(
  period: HrSalaryPeriod,
): Promise<Map<string, HrSalaryMonthRecord>> {
  const key = salaryPeriodKey(period);
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('period', '==', key)),
  );
  const map = new Map<string, HrSalaryMonthRecord>();
  for (const d of snap.docs) {
    const rec = mapSalaryDoc(d.id, d.data() as Record<string, unknown>);
    if (rec.uid) map.set(rec.uid, rec);
  }
  return map;
}

export async function saveSalaryMonth(
  input: HrSalaryMonthInput,
  updatedByUid: string,
  holidays: HrHoliday[] = [],
): Promise<void> {
  const period: HrSalaryPeriod = { year: input.year, month: input.month };
  const leaveEntries = normalizeLeaveEntries(input.leaveEntries, period);
  const projects = normalizeProjects(input.projects);
  const projectIds = new Set(projects.map(p => p.id));
  const workShiftEntries = normalizeWorkShiftEntries(input.workShiftEntries ?? [], period).map(entry => ({
    ...entry,
    projectId: entry.projectId && projectIds.has(entry.projectId) ? entry.projectId : null,
  }));
  const shiftDates = new Set(workShiftEntries.map(e => e.date));
  // Whole-day XOR daytime shifts: drop whole-day rows for dates that have shifts.
  const workDayEntries = normalizeWorkDayEntries(input.workDayEntries, period, projectIds)
    .filter(e => !shiftDates.has(e.date));
  const overtimeEntries = normalizeOvertimeEntries(input.overtimeEntries, period).map(entry => ({
    ...entry,
    projectId: entry.projectId && projectIds.has(entry.projectId) ? entry.projectId : null,
  }));
  const dayJoinEntries = normalizeDayJoinEntries(input.dayJoinEntries ?? [], period);
  const expenseEntries = normalizeExpenseEntries(input.expenseEntries ?? [], period);
  const receiptEntries = normalizeSalaryReceiptEntries(input.receiptEntries ?? [], period);
  const monthlySalary = Math.max(0, Number(input.monthlySalary) || 0);
  const rateDays = salaryRateDays(period.year, period.month, holidays);
  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  const otPerDaySalary = Math.max(0, Number(input.otPerDaySalary) || 0);
  await setDoc(
    doc(db, COLLECTION, salaryMonthDocId(input.uid, period)),
    {
      uid: input.uid,
      year: input.year,
      month: input.month,
      period: salaryPeriodKey(period),
      monthlySalary,
      perDaySalary,
      otPerDaySalary,
      sundayPerDaySalary: 0,
      leaveEntries,
      leaveDates: leaveEntries.filter(e => e.kind === 'full').map(e => e.date),
      projects,
      workDayEntries,
      workShiftEntries,
      dayJoinEntries,
      overtimeEntries,
      expenseEntries,
      receiptEntries,
      overtimeDates: [],
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}

/** Load non-portal (payroll-only) employees with salary/leave for the period. */
export async function buildSalaryCalculationRows(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
): Promise<HrSalaryStaffRow[]> {
  const [payrollEmployees, salaryByUid] = await Promise.all([
    fetchPayrollEmployees(),
    fetchSalaryMonthsForPeriod(period),
  ]);

  return payrollEmployees
    .map(emp => {
      const key = payrollEmployeeSalaryKey(emp.id);
      const saved = salaryByUid.get(key);
      const { monthlySalary, perDaySalary, otPerDaySalary } = resolveSalaryRates(
        saved,
        period,
        holidays,
        {
          monthlySalary: emp.defaultMonthlySalary,
          perDaySalary: emp.defaultPerDaySalary,
          otPerDaySalary: emp.defaultOtPerDaySalary,
        },
      );
      const leaveEntries = saved?.leaveEntries ?? [];
      const projects = saved?.projects ?? [];
      const workDayEntries = saved?.workDayEntries ?? [];
      const workShiftEntries = saved?.workShiftEntries ?? [];
      const dayJoinEntries = saved?.dayJoinEntries ?? [];
      const overtimeEntries = saved?.overtimeEntries ?? [];
      const expenseEntries = saved?.expenseEntries ?? [];
      const receiptEntries = saved?.receiptEntries ?? [];
      return {
        staffUid: key,
        displayName: emp.displayName,
        department: emp.department,
        designation: emp.designation,
        employeeId: emp.employeeId,
        active: emp.active,
        source: 'external' as const,
        monthlySalary,
        perDaySalary,
        otPerDaySalary,
        leaveEntries,
        projects,
        workDayEntries,
        workShiftEntries,
        dayJoinEntries,
        overtimeEntries,
        expenseEntries,
        receiptEntries,
        publicShareToken: saved?.publicShareToken ?? null,
        calc: computeSalaryCalc(
          monthlySalary,
          otPerDaySalary,
          period,
          holidays,
          leaveEntries,
          overtimeEntries,
          workShiftEntries,
          workDayEntries,
          dayJoinEntries,
          projects,
        ),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
