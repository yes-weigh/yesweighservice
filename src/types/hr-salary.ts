/** Monthly salary + leave / overtime marking for HR payroll. */

export type HrSalaryPeriod = {
  year: number;
  month: number; // 1–12
};

/** One overtime shift on a calendar day (morning / night / etc.). */
export type HrOvertimeEntry = {
  id: string;
  /** `yyyy-MM-dd` */
  date: string;
  /** `HH:mm` 24h */
  startTime: string;
  /** `HH:mm` 24h — may be earlier than start when the shift crosses midnight */
  endTime: string;
};

export type HrLeaveKind = 'full' | 'half';

export type HrLeaveEntry = {
  /** `yyyy-MM-dd` */
  date: string;
  kind: HrLeaveKind;
};

export type HrSalaryMonthRecord = {
  id: string;
  uid: string;
  year: number;
  month: number;
  /** `yyyy-MM` */
  period: string;
  monthlySalary: number;
  /** Leave entries (full or half day). Weekdays only in calc. */
  leaveEntries: HrLeaveEntry[];
  /** Timed OT shifts (one or more per day). */
  overtimeEntries: HrOvertimeEntry[];
  updatedAt: string;
  updatedByUid: string | null;
};

export type HrSalaryMonthInput = {
  uid: string;
  year: number;
  month: number;
  monthlySalary: number;
  leaveEntries: HrLeaveEntry[];
  overtimeEntries: HrOvertimeEntry[];
};

export type HrSalaryDayKind =
  | 'working'
  | 'sunday'
  | 'holiday'
  | 'leave'
  | 'leave_half'
  | 'overtime';

export type HrSalaryDayCell = {
  date: string;
  day: number;
  kind: HrSalaryDayKind;
  holidayName?: string;
  /** Total OT hours marked on this date (0 if none). */
  overtimeHours: number;
  /** Leave marked on this date (even when OT is also present). */
  leaveKind?: HrLeaveKind | null;
};

export type HrSalaryCalc = {
  daysInMonth: number;
  sundays: number;
  /** Holidays that fall on weekdays (Sundays already excluded). */
  weekdayHolidays: number;
  /** daysInMonth − Sundays (basis for per-day rate). */
  rateDays: number;
  /** Full + half leave days (half = 0.5). */
  leaveDays: number;
  fullLeaveDays: number;
  halfLeaveDays: number;
  /** Distinct dates with at least one OT entry. */
  overtimeDays: number;
  /** Sum of OT shift hours in the month. */
  overtimeHours: number;
  /** rateDays − weekdayHolidays − leaveDays */
  payableDays: number;
  /** payableDays × 8 (standard workday). */
  regularHours: number;
  /** regularHours + overtimeHours */
  totalWorkHours: number;
  perDaySalary: number;
  /** perDaySalary ÷ 8 */
  hourlyRate: number;
  overtimePay: number;
  /** payableDays × perDay + overtimePay */
  earnedSalary: number;
};

/** Assumed working hours in a payable day (for hourly OT rate). */
export const HR_SALARY_HOURS_PER_DAY = 8;

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
