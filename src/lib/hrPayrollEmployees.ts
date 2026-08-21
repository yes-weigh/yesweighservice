import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  HrPayrollEmployee,
  HrPayrollEmployeeInput,
} from '../types/hr-payroll-employee';
import type { StaffDepartment } from '../types/staff-access';

const COLLECTION = 'hrPayrollEmployees';

/** Prefix so salary-month keys never collide with Firebase Auth uids. */
export const PAYROLL_EMPLOYEE_KEY_PREFIX = 'ext_';

export function payrollEmployeeSalaryKey(employeeId: string): string {
  return employeeId.startsWith(PAYROLL_EMPLOYEE_KEY_PREFIX)
    ? employeeId
    : `${PAYROLL_EMPLOYEE_KEY_PREFIX}${employeeId}`;
}

export function isPayrollEmployeeKey(key: string): boolean {
  return key.startsWith(PAYROLL_EMPLOYEE_KEY_PREFIX);
}

function mapEmployee(id: string, data: Record<string, unknown>): HrPayrollEmployee {
  const defaultMonthlySalary = Number(data.defaultMonthlySalary) || 0;
  const defaultPerDaySalary = Number(data.defaultPerDaySalary) || 0;
  const defaultOtPerDaySalary = Number(data.defaultOtPerDaySalary)
    || defaultPerDaySalary
    || 0;
  return {
    id,
    displayName: String(data.displayName ?? '').trim() || '—',
    designation: data.designation != null ? String(data.designation) : null,
    employeeId: data.employeeId != null ? String(data.employeeId) : null,
    department: (data.department as StaffDepartment) || 'admin',
    defaultMonthlySalary,
    defaultPerDaySalary,
    defaultOtPerDaySalary,
    active: data.active !== false,
    createdAt: String(data.createdAt ?? ''),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
  };
}

export async function fetchPayrollEmployees(options?: {
  includeInactive?: boolean;
}): Promise<HrPayrollEmployee[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('displayName', 'asc')));
  return snap.docs
    .map(d => mapEmployee(d.id, d.data() as Record<string, unknown>))
    .filter(emp => options?.includeInactive || emp.active);
}

export async function createPayrollEmployee(
  input: HrPayrollEmployeeInput,
  createdByUid: string,
): Promise<HrPayrollEmployee> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('Employee name is required.');
  const defaultMonthlySalary = Math.max(0, Number(input.defaultMonthlySalary) || 0);
  const defaultPerDaySalary = Math.max(0, Number(input.defaultPerDaySalary) || 0);
  const defaultOtPerDaySalary = Math.max(
    0,
    Number(input.defaultOtPerDaySalary) || defaultPerDaySalary,
  );
  const ref = await addDoc(collection(db, COLLECTION), {
    displayName,
    designation: input.designation?.trim() || null,
    employeeId: input.employeeId?.trim() || null,
    department: input.department,
    defaultMonthlySalary,
    defaultPerDaySalary,
    defaultOtPerDaySalary,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid,
  });
  return {
    id: ref.id,
    displayName,
    designation: input.designation?.trim() || null,
    employeeId: input.employeeId?.trim() || null,
    department: input.department,
    defaultMonthlySalary,
    defaultPerDaySalary,
    defaultOtPerDaySalary,
    active: true,
    createdAt: new Date().toISOString(),
    createdByUid,
  };
}

export async function savePayrollEmployeeSalaryDefaults(
  employeeId: string,
  defaults: {
    defaultMonthlySalary?: number;
    defaultOtPerDaySalary?: number;
  },
): Promise<void> {
  const patch: Record<string, number> = {};
  const monthly = Math.max(0, Number(defaults.defaultMonthlySalary) || 0);
  const otPerDay = Math.max(0, Number(defaults.defaultOtPerDaySalary) || 0);
  if (monthly > 0) patch.defaultMonthlySalary = monthly;
  if (otPerDay > 0) patch.defaultOtPerDaySalary = otPerDay;
  if (Object.keys(patch).length === 0) return;
  await updateDoc(doc(db, COLLECTION, employeeId), patch);
}

export async function deletePayrollEmployee(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
