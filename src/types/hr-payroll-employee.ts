import type { StaffDepartment } from './staff-access';

/** Payroll-only employee (no portal login). */
export type HrPayrollEmployee = {
  id: string;
  displayName: string;
  designation: string | null;
  employeeId: string | null;
  department: StaffDepartment;
  /** Default monthly salary when no month record exists yet. */
  defaultMonthlySalary: number;
  /**
   * Legacy default per-day rate. Used only when defaultMonthlySalary is unset.
   * @deprecated Prefer defaultMonthlySalary.
   */
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
  defaultMonthlySalary?: number;
  defaultPerDaySalary?: number;
  defaultOtPerDaySalary?: number;
};
