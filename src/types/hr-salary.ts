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

/** Clock-in / clock-out for a calendar day when not using timed daytime shifts. */
export type HrDayJoinEntry = {
  /** `yyyy-MM-dd` */
  date: string;
  /** `HH:mm` 24h — actual clock-in. */
  joinedAt: string;
  /** `HH:mm` 24h — actual clock-out (defaults to {@link HR_SALARY_STANDARD_END_TIME} in calc). */
  clockedOutAt?: string | null;
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

/** Out-of-pocket expense on a calendar day (reimbursable). */
export type HrExpenseEntry = {
  id: string;
  /** `yyyy-MM-dd` */
  date: string;
  amount: number;
  note: string;
};

/** Cash received — reimbursement (offsets expenses) or salary advance (offsets salary). */
export type HrSalaryReceiptKind = 'reimbursement' | 'salary_advance';

export type HrSalaryReceiptEntry = {
  id: string;
  /** `yyyy-MM-dd` */
  date: string;
  kind: HrSalaryReceiptKind;
  amount: number;
  note: string;
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
  /** Late join times for whole-day rows (daytime shifts override). */
  dayJoinEntries: HrDayJoinEntry[];
  /** Timed OT shifts (one or more per day). */
  overtimeEntries: HrOvertimeEntry[];
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
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
  dayJoinEntries: HrDayJoinEntry[];
  overtimeEntries: HrOvertimeEntry[];
  expenseEntries: HrExpenseEntry[];
  receiptEntries: HrSalaryReceiptEntry[];
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
  /**
   * Payable weekday with regular pay not fully attributed to a project
   * (no whole-day / daytime shifts, or under-filled shift remainder).
   * OT-only project tags do not clear this.
   */
  hasUnassignedRegular: boolean;
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
  /** Weekday OT hours only (excludes Sunday) — after morning makeup at regular rate. */
  weekdayOvertimeHours: number;
  /** Weekday OT hours reclassified to regular rate (late-join makeup). */
  makeupRegularHours: number;
  /** makeupRegularHours × hourlyRate */
  makeupRegularPay: number;
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

export type HrExpenseSettlement = {
  totalExpenses: number;
  totalReimbursements: number;
  totalSalaryAdvances: number;
  /** max(0, expenses − reimbursements) */
  unreimbursedExpenses: number;
  /** earnedSalary + unreimbursedExpenses − salaryAdvances */
  netPayable: number;
};

export type HrExpenseSettlementLineKind = 'expense' | 'reimbursement' | 'salary_advance';

export type HrExpenseSettlementLine = {
  id: string;
  date: string;
  kind: HrExpenseSettlementLineKind;
  note: string | null;
  amount: number;
  /** + adds to net payable; − reduces net payable */
  sign: '+' | '−';
  /** Running unreimbursed expenses after this line (expenses − reimbursements). */
  balance: number;
};

/** Assumed working hours in a payable day (for hourly OT rate). */
export const HR_SALARY_HOURS_PER_DAY = 8;

/** Standard weekday clock-in; morning gap before this is filled by OT at regular rate first. */
export const HR_SALARY_STANDARD_START_TIME = '09:30';

/** Standard weekday clock-out (8 hrs after {@link HR_SALARY_STANDARD_START_TIME}). */
export const HR_SALARY_STANDARD_END_TIME = '17:30';

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
