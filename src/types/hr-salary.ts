/** Monthly salary + leave marking for HR payroll. */

export type HrSalaryPeriod = {
  year: number;
  month: number; // 1–12
};

export type HrSalaryMonthRecord = {
  id: string;
  uid: string;
  year: number;
  month: number;
  /** `yyyy-MM` */
  period: string;
  monthlySalary: number;
  /** Leave dates in this month as `yyyy-MM-dd` (weekdays only; Sundays/holidays ignored). */
  leaveDates: string[];
  updatedAt: string;
  updatedByUid: string | null;
};

export type HrSalaryMonthInput = {
  uid: string;
  year: number;
  month: number;
  monthlySalary: number;
  leaveDates: string[];
};

export type HrSalaryDayKind = 'working' | 'sunday' | 'holiday' | 'leave';

export type HrSalaryDayCell = {
  date: string;
  day: number;
  kind: HrSalaryDayKind;
  holidayName?: string;
};

export type HrSalaryCalc = {
  daysInMonth: number;
  sundays: number;
  /** Holidays that fall on weekdays (Sundays already excluded). */
  weekdayHolidays: number;
  /** daysInMonth − Sundays (basis for per-day rate). */
  rateDays: number;
  leaveDays: number;
  /** rateDays − weekdayHolidays − leaveDays */
  payableDays: number;
  perDaySalary: number;
  earnedSalary: number;
};

export function salaryPeriodKey(period: HrSalaryPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function currentSalaryPeriod(date = new Date()): HrSalaryPeriod {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function salaryPeriodLabel(period: HrSalaryPeriod): string {
  const d = new Date(period.year, period.month - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
