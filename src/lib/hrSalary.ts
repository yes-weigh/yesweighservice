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
  HrLeaveEntry,
  HrLeaveKind,
  HrOvertimeEntry,
  HrSalaryCalc,
  HrSalaryDayCell,
  HrSalaryMonthInput,
  HrSalaryMonthRecord,
  HrSalaryPeriod,
  HrSalaryProject,
  HrWorkDayEntry,
} from '../types/hr-salary';
import {
  HR_SALARY_HOURS_PER_DAY,
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
  overtimeEntries: HrOvertimeEntry[];
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

  const total = daysInMonth(period.year, period.month);
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    if (dow === 0 || weekdayHolidayDates.has(date)) continue;
    const leaveKind = leaveMap.get(date);
    if (leaveKind === 'full') continue;
    const payable = leaveKind === 'half' ? 0.5 : 1;
    const projectId = workMap.get(date) ?? null;
    const row = projectId && byId.has(projectId)
      ? byId.get(projectId)!
      : ensureUnassigned();
    row.regularDays = Math.round((row.regularDays + payable) * 100) / 100;
    row.regularPay = Math.round((row.regularPay + payable * perDaySalary) * 100) / 100;
  }

  for (const entry of overtimeEntries) {
    const hours = overtimeEntryHours(entry.startTime, entry.endTime);
    if (hours <= 0) continue;
    const otPay = hours * otHourlyRate;
    const projectId = entry.projectId && byId.has(entry.projectId) ? entry.projectId : null;
    const row = projectId ? byId.get(projectId)! : ensureUnassigned();
    row.otHours = Math.round((row.otHours + hours) * 100) / 100;
    row.otPay = Math.round((row.otPay + otPay) * 100) / 100;
  }

  const rows = [...byId.values(), ...(unassigned ? [unassigned] : [])];
  for (const row of rows) {
    row.totalPay = Math.round((row.regularPay + row.otPay) * 100) / 100;
  }
  return rows.filter(row => (
    row.regularDays > 0 || row.otHours > 0 || row.projectId != null
  ));
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
): HrSalaryDayCell[] {
  const leaveMap = new Map(
    normalizeLeaveEntries(leaveEntries, period).map(e => [e.date, e.kind]),
  );
  const otHours = overtimeHoursByDate(overtimeEntries);
  const holidayMap = new Map(
    holidaysInMonth(holidays, period.year, period.month).map(h => [h.date, h.name]),
  );
  const colorByProject = new Map(projects.map(p => [p.id, p.color]));
  const workMap = new Map(
    normalizeWorkDayEntries(
      workDayEntries,
      period,
      new Set(projects.map(p => p.id)),
    ).map(e => [e.date, e.projectId]),
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
  for (const entry of overtimeEntries) pushColor(entry.date, entry.projectId);

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

    if (hours > 0) {
      cells.push({
        date,
        day,
        kind: 'overtime',
        holidayName,
        overtimeHours: hours,
        leaveKind,
        projectColors,
      });
    } else if (isSunday) {
      cells.push({
        date,
        day,
        kind: 'sunday',
        overtimeHours: 0,
        leaveKind: null,
        projectColors,
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
      });
    } else if (leaveKind === 'half') {
      cells.push({
        date,
        day,
        kind: 'leave_half',
        overtimeHours: 0,
        leaveKind: 'half',
        projectColors,
      });
    } else if (leaveKind === 'full') {
      cells.push({
        date,
        day,
        kind: 'leave',
        overtimeHours: 0,
        leaveKind: 'full',
        projectColors,
      });
    } else {
      cells.push({
        date,
        day,
        kind: 'working',
        overtimeHours: 0,
        leaveKind: null,
        projectColors,
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
  let sundayHours = 0;
  let weekdayOvertimeHours = 0;
  let sundayWorkDays = 0;
  for (const [date, hrs] of hoursByDate.entries()) {
    if (hrs <= 0) continue;
    if (isSundayIsoDate(date)) {
      sundayHours += hrs;
      sundayWorkDays += 1;
    } else {
      weekdayOvertimeHours += hrs;
    }
  }
  sundayHours = Math.round(sundayHours * 100) / 100;
  weekdayOvertimeHours = Math.round(weekdayOvertimeHours * 100) / 100;
  const overtimeHours = Math.round((sundayHours + weekdayOvertimeHours) * 100) / 100;
  const overtimeDays = hoursByDate.size;

  const payableDays = Math.max(0, rateDays - leaveDays);
  const regularHours = Math.round(payableDays * HR_SALARY_HOURS_PER_DAY * 100) / 100;
  const totalWorkHours = Math.round((regularHours + overtimeHours) * 100) / 100;
  const monthlySalary = Number.isFinite(monthlySalaryInput) && monthlySalaryInput > 0
    ? monthlySalaryInput
    : 0;
  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  const otPerDaySalary = Number.isFinite(otPerDaySalaryInput) && otPerDaySalaryInput > 0
    ? otPerDaySalaryInput
    : 0;
  const hourlyRate = perDaySalary / HR_SALARY_HOURS_PER_DAY;
  const otHourlyRate = otPerDaySalary / HR_SALARY_HOURS_PER_DAY;
  const regularPay = perDaySalary * payableDays;
  const overtimePay = otHourlyRate * overtimeHours;
  const earnedSalary = regularPay + overtimePay;

  return {
    daysInMonth: days,
    sundays,
    weekdayHolidays,
    rateDays,
    leaveDays,
    fullLeaveDays,
    halfLeaveDays,
    overtimeDays,
    overtimeHours,
    payableDays,
    regularHours,
    totalWorkHours,
    monthlySalary,
    perDaySalary,
    sundayWorkDays,
    sundayHours,
    weekdayOvertimeHours,
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
    overtimeEntries: mapOvertimeEntries(data),
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
  const workDayEntries = normalizeWorkDayEntries(input.workDayEntries, period, projectIds);
  const overtimeEntries = normalizeOvertimeEntries(input.overtimeEntries, period).map(entry => ({
    ...entry,
    projectId: entry.projectId && projectIds.has(entry.projectId) ? entry.projectId : null,
  }));
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
      overtimeEntries,
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
      const overtimeEntries = saved?.overtimeEntries ?? [];
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
        overtimeEntries,
        publicShareToken: saved?.publicShareToken ?? null,
        calc: computeSalaryCalc(
          monthlySalary,
          otPerDaySalary,
          period,
          holidays,
          leaveEntries,
          overtimeEntries,
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
