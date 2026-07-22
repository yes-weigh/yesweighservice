import type { StaffDepartment } from './staff-access';

/** Payroll-only employee (no portal login). */
export type HrPayrollEmployee = {
  id: string;
  displayName: string;
  designation: string | null;
  employeeId: string | null;
  department: StaffDepartment;
  /** Default monthly salary used when no month record exists yet. */
  defaultMonthlySalary: number;
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
};
