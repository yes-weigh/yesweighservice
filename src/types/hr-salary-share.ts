import type {
  HrDayJoinEntry,
  HrExpenseEntry,
  HrLeaveEntry,
  HrOvertimeEntry,
  HrSalaryPeriod,
  HrSalaryProject,
  HrSalaryReceiptEntry,
  HrWorkDayEntry,
  HrWorkShiftEntry,
} from './hr-salary';

/** Holiday fields embedded in a public salary share (no private holiday collection access). */
export type HrSalaryShareHoliday = {
  date: string;
  name: string;
};

/** Public, unguessable snapshot of one staff salary month. */
export type HrSalaryShareRecord = {
  token: string;
  sourceDocId: string;
  uid: string;
  displayName: string;
  year: number;
  month: number;
  period: string;
  /** Monthly base salary (primary). Older shares may only have perDaySalary. */
  monthlySalary: number;
  /** Derived / legacy day rate. */
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
  holidays: HrSalaryShareHoliday[];
  createdAt: string;
  updatedAt: string;
  createdByUid: string | null;
};

export type HrSalaryShareInput = {
  token: string;
  uid: string;
  displayName: string;
  period: HrSalaryPeriod;
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
  holidays: HrSalaryShareHoliday[];
};
