import type { StaffDepartment } from './staff-access';

export interface StaffWorkSummary {
  staffUid: string;
  displayName: string;
  department: StaffDepartment;
  designation: string | null;
  employeeId: string | null;
  active: boolean;
  dealersManaged: number;
  supportResponses: number;
  staffOnboarded: number;
  activityScore: number;
}

export interface WorkReportPeriod {
  year: number;
  month: number;
}

export function periodLabel({ year, month }: WorkReportPeriod): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

export function periodBounds({ year, month }: WorkReportPeriod): { start: string; end: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function currentWorkReportPeriod(): WorkReportPeriod {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
