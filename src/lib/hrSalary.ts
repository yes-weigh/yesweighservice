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
import { readHrProfileFromDoc } from './hrStaff';
import type { HrHoliday } from '../types/hr-holiday';
import type {
  HrSalaryCalc,
  HrSalaryDayCell,
  HrSalaryMonthInput,
  HrSalaryMonthRecord,
  HrSalaryPeriod,
} from '../types/hr-salary';
import { salaryPeriodKey } from '../types/hr-salary';
import type { FirestoreUserDoc, UserRecord } from '../types';
import { normalizeRole } from '../types';
import type { StaffDepartment } from '../types/staff-access';

const COLLECTION = 'hrSalaryMonths';

export type HrSalaryStaffRow = {
  staffUid: string;
  displayName: string;
  department: StaffDepartment;
  designation: string | null;
  employeeId: string | null;
  active: boolean;
  monthlySalary: number;
  leaveDates: string[];
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

export function buildMonthDayCells(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveDates: string[],
): HrSalaryDayCell[] {
  const leaveSet = new Set(leaveDates);
  const holidayMap = new Map(
    holidaysInMonth(holidays, period.year, period.month).map(h => [h.date, h.name]),
  );
  const total = daysInMonth(period.year, period.month);
  const cells: HrSalaryDayCell[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = isoDate(period.year, period.month, day);
    const dow = new Date(period.year, period.month - 1, day).getDay();
    const holidayName = holidayMap.get(date);
    if (dow === 0) {
      cells.push({ date, day, kind: 'sunday' });
    } else if (holidayName) {
      cells.push({ date, day, kind: 'holiday', holidayName });
    } else if (leaveSet.has(date)) {
      cells.push({ date, day, kind: 'leave' });
    } else {
      cells.push({ date, day, kind: 'working' });
    }
  }
  return cells;
}

/**
 * Per-day = monthly ÷ (days − Sundays).
 * Holidays (weekdays) and leave reduce payable days for earned pay.
 */
export function computeSalaryCalc(
  monthlySalary: number,
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
  leaveDates: string[],
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

  const leaveSet = new Set(
    leaveDates.filter(date => {
      if (!date.startsWith(salaryPeriodKey(period))) return false;
      if (weekdayHolidayDates.has(date)) return false;
      const [y, m, d] = date.split('-').map(Number);
      if (!y || !m || !d) return false;
      return new Date(y, m - 1, d).getDay() !== 0;
    }),
  );
  const leaveDays = leaveSet.size;

  const payableDays = Math.max(0, rateDays - weekdayHolidays - leaveDays);
  const salary = Number.isFinite(monthlySalary) && monthlySalary > 0 ? monthlySalary : 0;
  const perDaySalary = rateDays > 0 ? salary / rateDays : 0;
  const earnedSalary = perDaySalary * payableDays;

  return {
    daysInMonth: days,
    sundays,
    weekdayHolidays,
    rateDays,
    leaveDays,
    payableDays,
    perDaySalary,
    earnedSalary,
  };
}

function mapSalaryDoc(id: string, data: Record<string, unknown>): HrSalaryMonthRecord {
  const leaveRaw = Array.isArray(data.leaveDates) ? data.leaveDates : [];
  return {
    id,
    uid: String(data.uid ?? ''),
    year: Number(data.year) || 0,
    month: Number(data.month) || 0,
    period: String(data.period ?? ''),
    monthlySalary: Number(data.monthlySalary) || 0,
    leaveDates: leaveRaw.map(v => String(v)).filter(Boolean),
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
  const id = salaryMonthDocId(input.uid, period);
  const leaveDates = [...new Set(input.leaveDates)]
    .filter(d => d.startsWith(salaryPeriodKey(period)))
    .sort();
  await setDoc(
    doc(db, COLLECTION, id),
    {
      uid: input.uid,
      year: input.year,
      month: input.month,
      period: salaryPeriodKey(period),
      monthlySalary: Math.max(0, Number(input.monthlySalary) || 0),
      leaveDates,
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

/** Load staff rows with salary/leave for the period and holiday-aware calcs. */
export async function buildSalaryCalculationRows(
  period: HrSalaryPeriod,
  holidays: HrHoliday[],
): Promise<HrSalaryStaffRow[]> {
  const [staff, salaryByUid] = await Promise.all([
    fetchStaffRecords(),
    fetchSalaryMonthsForPeriod(period),
  ]);

  return staff.map(record => {
    const hr = readHrProfileFromDoc(record);
    const saved = salaryByUid.get(record.uid);
    const monthlySalary = saved?.monthlySalary ?? 0;
    const leaveDates = saved?.leaveDates ?? [];
    return {
      staffUid: record.uid,
      displayName: record.displayName,
      department: (record.staffDepartment ?? 'admin') as StaffDepartment,
      designation: hr.hrDesignation ?? null,
      employeeId: hr.hrEmployeeId ?? null,
      active: record.active !== false,
      monthlySalary,
      leaveDates,
      calc: computeSalaryCalc(monthlySalary, period, holidays, leaveDates),
    };
  });
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
