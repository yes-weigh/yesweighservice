import type {
  HrLeaveEntry,
  HrOvertimeEntry,
  HrSalaryPeriod,
  HrSalaryProject,
  HrWorkDayEntry,
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
  perDaySalary: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  overtimeEntries: HrOvertimeEntry[];
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
  perDaySalary: number;
  otPerDaySalary: number;
  leaveEntries: HrLeaveEntry[];
  projects: HrSalaryProject[];
  workDayEntries: HrWorkDayEntry[];
  overtimeEntries: HrOvertimeEntry[];
  holidays: HrSalaryShareHoliday[];
};
