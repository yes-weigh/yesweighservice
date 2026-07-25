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
import { readHrProfileFromDoc } from './hrStaff';
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
} from '../types/hr-salary';
import {
  HR_SALARY_HOURS_PER_DAY,
  salaryPeriodKey,
} from '../types/hr-salary';
import type { FirestoreUserDoc, UserRecord } from '../types';
import { normalizeRole } from '../types';
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
  leaveEntries: HrLeaveEntry[];
  overtimeEntries: HrOvertimeEntry[];
  calc: HrSalaryCalc;
};

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

export function createOvertimeEntry(
  date: string,
  startTime = '18:00',
  endTime = '20:00',
): HrOvertimeEntry {
  return {
    id: newOvertimeEntryId(),
    date,
    startTime,
    endTime,
  };
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
): HrSalaryDayCell[] {
  const leaveMap = new Map(
    normalizeLeaveEntries(leaveEntries, period).map(e => [e.date, e.kind]),
  );
  const otHours = overtimeHoursByDate(overtimeEntries);
  const holidayMap = new Map(
    holidaysInMonth(holidays, period.year, period.month).map(h => [h.date, h.name]),
  );
  const total = daysInMonth(period.year, period.month);
  const cells: HrSalaryDayCell[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    const holidayName = holidayMap.get(date);
    const hours = otHours.get(date) ?? 0;
    const isSunday = dow === 0;
    const leaveKind = leaveMap.get(date) ?? null;

    if (hours > 0) {
      cells.push({
        date,
        day,
        kind: 'overtime',
        holidayName,
        overtimeHours: hours,
        leaveKind,
      });
    } else if (isSunday) {
      cells.push({ date, day, kind: 'sunday', overtimeHours: 0, leaveKind: null });
    } else if (holidayName) {
      cells.push({
        date,
        day,
        kind: 'holiday',
        holidayName,
        overtimeHours: 0,
        leaveKind: null,
      });
    } else if (leaveKind === 'half') {
      cells.push({ date, day, kind: 'leave_half', overtimeHours: 0, leaveKind: 'half' });
    } else if (leaveKind === 'full') {
      cells.push({ date, day, kind: 'leave', overtimeHours: 0, leaveKind: 'full' });
    } else {
      cells.push({ date, day, kind: 'working', overtimeHours: 0, leaveKind: null });
    }
  }
  return cells;
}

/**
 * Per-day = monthly ÷ (days − Sundays).
 * Holidays (weekdays) and leave (full=1, half=0.5) reduce payable days.
 * OT pay = OT hours × (per-day ÷ 8).
 */
export function computeSalaryCalc(
  monthlySalary: number,
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveEntries: HrLeaveEntry[],
  overtimeEntries: HrOvertimeEntry[] = [],
): HrSalaryCalc {
  const days = daysInMonth(period.year, period.month);
  const sundays = countSundaysInMonth(period.year, period.month);
  const rateDays = Math.max(0, days - sundays);

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
  let overtimeHours = 0;
  for (const hrs of hoursByDate.values()) overtimeHours += hrs;
  overtimeHours = Math.round(overtimeHours * 100) / 100;
  const overtimeDays = hoursByDate.size;

  const payableDays = Math.max(0, rateDays - weekdayHolidays - leaveDays);
  const regularHours = Math.round(payableDays * HR_SALARY_HOURS_PER_DAY * 100) / 100;
  const totalWorkHours = Math.round((regularHours + overtimeHours) * 100) / 100;
  const salary = Number.isFinite(monthlySalary) && monthlySalary > 0 ? monthlySalary : 0;
  const perDaySalary = rateDays > 0 ? salary / rateDays : 0;
  const hourlyRate = perDaySalary / HR_SALARY_HOURS_PER_DAY;
  const overtimePay = hourlyRate * overtimeHours;
  const earnedSalary = perDaySalary * payableDays + overtimePay;

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
    perDaySalary,
    hourlyRate,
    overtimePay,
    earnedSalary,
  };
}

function mapOvertimeEntries(data: Record<string, unknown>): HrOvertimeEntry[] {
  if (Array.isArray(data.overtimeEntries)) {
    return data.overtimeEntries.map((raw, index) => {
      const row = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
      return {
        id: String(row.id ?? `legacy_${index}`),
        date: String(row.date ?? ''),
        startTime: String(row.startTime ?? ''),
        endTime: String(row.endTime ?? ''),
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
    monthlySalary: Number(data.monthlySalary) || 0,
    leaveEntries: mapLeaveEntries(data),
    overtimeEntries: mapOvertimeEntries(data),
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
): Promise<void> {
  const period: HrSalaryPeriod = { year: input.year, month: input.month };
  const leaveEntries = normalizeLeaveEntries(input.leaveEntries, period);
  const overtimeEntries = normalizeOvertimeEntries(input.overtimeEntries, period);
  await setDoc(
    doc(db, COLLECTION, salaryMonthDocId(input.uid, period)),
    {
      uid: input.uid,
      year: input.year,
      month: input.month,
      period: salaryPeriodKey(period),
      monthlySalary: Math.max(0, Number(input.monthlySalary) || 0),
      leaveEntries,
      // Keep legacy array in sync for older readers (full-day dates only).
      leaveDates: leaveEntries.filter(e => e.kind === 'full').map(e => e.date),
      overtimeEntries,
      overtimeDates: [], // clear legacy whole-day flags
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}

async function fetchStaffRecords(): Promise<UserRecord[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs
    .map(d => {
      const data = d.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (role !== 'staff') return null;
      return { uid: d.id, ...data, role } as UserRecord;
    })
    .filter((u): u is UserRecord => u !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Load portal staff + payroll-only employees with salary/leave for the period. */
export async function buildSalaryCalculationRows(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
): Promise<HrSalaryStaffRow[]> {
  const [staff, payrollEmployees, salaryByUid] = await Promise.all([
    fetchStaffRecords(),
    fetchPayrollEmployees(),
    fetchSalaryMonthsForPeriod(period),
  ]);

  const userRows: HrSalaryStaffRow[] = staff.map(record => {
    const hr = readHrProfileFromDoc(record);
    const saved = salaryByUid.get(record.uid);
    const monthlySalary = saved?.monthlySalary ?? 0;
    const leaveEntries = saved?.leaveEntries ?? [];
    const overtimeEntries = saved?.overtimeEntries ?? [];
    return {
      staffUid: record.uid,
      displayName: record.displayName,
      department: (record.staffDepartment ?? 'admin') as StaffDepartment,
      designation: hr.hrDesignation ?? null,
      employeeId: hr.hrEmployeeId ?? null,
      active: record.active !== false,
      source: 'user',
      monthlySalary,
      leaveEntries,
      overtimeEntries,
      calc: computeSalaryCalc(monthlySalary, period, holidays, leaveEntries, overtimeEntries),
    };
  });

  const externalRows: HrSalaryStaffRow[] = payrollEmployees.map(emp => {
    const key = payrollEmployeeSalaryKey(emp.id);
    const saved = salaryByUid.get(key);
    const monthlySalary = saved?.monthlySalary ?? emp.defaultMonthlySalary ?? 0;
    const leaveEntries = saved?.leaveEntries ?? [];
    const overtimeEntries = saved?.overtimeEntries ?? [];
    return {
      staffUid: key,
      displayName: emp.displayName,
      department: emp.department,
      designation: emp.designation,
      employeeId: emp.employeeId,
      active: emp.active,
      source: 'external',
      monthlySalary,
      leaveEntries,
      overtimeEntries,
      calc: computeSalaryCalc(monthlySalary, period, holidays, leaveEntries, overtimeEntries),
    };
  });

  return [...userRows, ...externalRows].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
