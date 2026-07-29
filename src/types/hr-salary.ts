/** Monthly salary + leave / overtime marking for HR payroll. */

export type HrSalaryPeriod = {
  year: number;
  month: number; // 1–12
};

/** Named project used to group regular work + OT for the month. */
export type HrSalaryProject = {
  id: string;
  name: string;
  /** Hex color for calendar dots / list markers. */
  color: string;
};

/** Assigns a calendar day's regular work to a project. */
export type HrWorkDayEntry = {
  /** `yyyy-MM-dd` */
  date: string;
  projectId: string;
};

/** Timed regular (non-OT) work on a calendar day — optional split across projects. */
export type HrWorkShiftEntry = {
  id: string;
  /** `yyyy-MM-dd` */
  date: string;
  /** `HH:mm` 24h */
  startTime: string;
  /** `HH:mm` 24h — may be earlier than start when the shift crosses midnight */
  endTime: string;
  /** Owning project; null/empty = unassigned. */
  projectId: string | null;
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
  /** Owning project; null/empty = unassigned. */
  projectId: string | null;
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
  /** Monthly CTC / base salary for the period (primary input). */
  monthlySalary: number;
  /**
   * Derived regular day rate: monthlySalary ÷ (days − Sundays − weekday holidays).
   * Stored for older readers / shares; recompute from monthly when possible.
   */
  perDaySalary: number;
  /** Pay for one full OT day ({@link HR_SALARY_HOURS_PER_DAY} hours). Also used for Sunday hours. */
  otPerDaySalary: number;
  /** Leave entries (full or half day). Weekdays only in calc. */
  leaveEntries: HrLeaveEntry[];
  /** Projects for grouping regular work + OT in this month. */
  projects: HrSalaryProject[];
  /** Regular work day → project assignments (whole-day mode). */
  workDayEntries: HrWorkDayEntry[];
  /** Timed daytime shifts (optional split across projects). */
  workShiftEntries: HrWorkShiftEntry[];
  /** Timed OT shifts (one or more per day). */
  overtimeEntries: HrOvertimeEntry[];
  /** Unguessable token for `/s/salary/:token` public share page. */
  publicShareToken: string | null;
  updatedAt: string;
  updatedByUid: string | null;
};

export type HrSalaryMonthInput = {
  uid: string;
  year: number;
  month: number;
  monthlySalary: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  workShiftEntries: HrWorkShiftEntry[];
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
  /** Distinct project colors tagged on this date (work day + OT). */
  projectColors: string[];
};

export type HrSalaryCalc = {
  daysInMonth: number;
  sundays: number;
  /** Holidays that fall on weekdays (Sundays already excluded). */
  weekdayHolidays: number;
  /**
   * Working-day basis for per-day rate:
   * daysInMonth − Sundays − weekday public/company holidays.
   */
  rateDays: number;
  /** Full + half leave days (half = 0.5). */
  leaveDays: number;
  fullLeaveDays: number;
  halfLeaveDays: number;
  /** Distinct dates with at least one OT entry. */
  overtimeDays: number;
  /** Sum of OT shift hours in the month. */
  overtimeHours: number;
  /** rateDays − leaveDays */
  payableDays: number;
  /** payableDays × 8 (standard workday). */
  regularHours: number;
  /** regularHours + overtimeHours */
  totalWorkHours: number;
  /** Monthly base salary used to derive per-day. */
  monthlySalary: number;
  /** monthlySalary ÷ rateDays */
  perDaySalary: number;
  /** Sundays that have marked work hours. */
  sundayWorkDays: number;
  /** Hours worked on Sundays (OT marks on Sunday = total Sunday work). */
  sundayHours: number;
  /** Weekday OT hours only (excludes Sunday). */
  weekdayOvertimeHours: number;
  /** payableDays × perDaySalary */
  regularPay: number;
  /** Pay for one full OT day (8 hrs); applies to weekday OT and Sunday hours. */
  otPerDaySalary: number;
  /** perDaySalary ÷ 8 */
  hourlyRate: number;
  /** otPerDaySalary ÷ 8 */
  otHourlyRate: number;
  /** overtimeHours × otHourlyRate (Sunday + weekday OT). */
  overtimePay: number;
  /** regularPay + overtimePay */
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
