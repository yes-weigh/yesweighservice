import type { StaffDepartment } from './staff-access';

/** Payroll-only employee (no portal login). */
export type HrPayrollEmployee = {
  id: string;
  displayName: string;
  designation: string | null;
  employeeId: string | null;
  department: StaffDepartment;
  /** Default regular (weekday) per-day salary when no month record exists yet. */
  defaultPerDaySalary: number;
  /** Default OT day rate (8 hrs) when no month record exists yet. */
  defaultOtPerDaySalary: number;
  active: boolean;
  createdAt: string;
  createdByUid: string | null;
};

export type HrPayrollEmployeeInput = {
  displayName: string;
  designation?: string | null;
  employeeId?: string | null;
  department: StaffDepartment;
  defaultPerDaySalary?: number;
  defaultOtPerDaySalary?: number;
};
