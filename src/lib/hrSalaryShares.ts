import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { PUBLIC_APP_ORIGIN } from '../constants/brand';
import { db } from '../firebase';
import type { HrSalaryShareInput, HrSalaryShareRecord } from '../types/hr-salary-share';
import type { HrSalaryPeriod } from '../types/hr-salary';
import { salaryPeriodKey } from '../types/hr-salary';
import type { HrHoliday } from '../types/hr-holiday';
import {
  perDayFromMonthly,
  salaryMonthDocId,
  salaryRateDays,
} from './hrSalary';

const SHARE_COLLECTION = 'hrSalaryShares';
const MONTH_COLLECTION = 'hrSalaryMonths';

export function createSalaryShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function salarySharePublicPath(token: string): string {
  return `/s/salary/${token}`;
}

/** Always use the public app origin so copied links work for anyone. */
export function salarySharePublicUrl(token: string): string {
  return `${PUBLIC_APP_ORIGIN.replace(/\/$/, '')}${salarySharePublicPath(token)}`;
}

function mapShareDoc(token: string, data: Record<string, unknown>): HrSalaryShareRecord | null {
  const uid = String(data.uid ?? '');
  const year = Number(data.year) || 0;
  const month = Number(data.month) || 0;
  if (!uid || !year || !month) return null;
  const leaveEntries = Array.isArray(data.leaveEntries)
    ? data.leaveEntries.map(raw => {
        const row = raw as Record<string, unknown>;
        return {
          date: String(row.date ?? ''),
          kind: row.kind === 'half' ? 'half' as const : 'full' as const,
        };
      }).filter(e => e.date)
    : [];
  const projects = Array.isArray(data.projects)
    ? data.projects.map(raw => {
        const row = raw as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          color: String(row.color ?? '#94a3b8'),
        };
      }).filter(p => p.id && p.name)
    : [];
  const workDayEntries = Array.isArray(data.workDayEntries)
    ? data.workDayEntries.map(raw => {
        const row = raw as Record<string, unknown>;
        return {
          date: String(row.date ?? ''),
          projectId: String(row.projectId ?? ''),
        };
      }).filter(e => e.date && e.projectId)
    : [];
  const overtimeEntries = Array.isArray(data.overtimeEntries)
    ? data.overtimeEntries.map(raw => {
        const row = raw as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          date: String(row.date ?? ''),
          startTime: String(row.startTime ?? ''),
          endTime: String(row.endTime ?? ''),
          projectId: row.projectId != null && row.projectId !== ''
            ? String(row.projectId)
            : null,
        };
      }).filter(e => e.id && e.date)
    : [];
  const holidays = Array.isArray(data.holidays)
    ? data.holidays.map(raw => {
        const row = raw as Record<string, unknown>;
        return {
          date: String(row.date ?? ''),
          name: String(row.name ?? 'Holiday'),
        };
      }).filter(h => h.date)
    : [];

  return {
    token,
    sourceDocId: String(data.sourceDocId ?? ''),
    uid,
    displayName: String(data.displayName ?? 'Staff'),
    year,
    month,
    period: String(data.period ?? salaryPeriodKey({ year, month })),
    monthlySalary: Math.max(0, Number(data.monthlySalary) || 0),
    perDaySalary: Math.max(0, Number(data.perDaySalary) || 0),
    otPerDaySalary: Math.max(0, Number(data.otPerDaySalary) || 0),
    leaveEntries,
    projects,
    workDayEntries,
    overtimeEntries,
    holidays,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
  };
}

export async function fetchSalaryShare(token: string): Promise<HrSalaryShareRecord | null> {
  const cleaned = token.trim();
  if (!cleaned) return null;
  const snap = await getDoc(doc(db, SHARE_COLLECTION, cleaned));
  if (!snap.exists()) return null;
  return mapShareDoc(snap.id, snap.data() as Record<string, unknown>);
}

/** Create or refresh a public share snapshot; returns the token. */
export async function upsertSalaryShare(
  input: HrSalaryShareInput,
  createdByUid: string,
): Promise<string> {
  const period = input.period;
  const sourceDocId = salaryMonthDocId(input.uid, period);
  const now = new Date().toISOString();
  const ref = doc(db, SHARE_COLLECTION, input.token);
  const existing = await getDoc(ref);
  const monthlySalary = Math.max(0, Number(input.monthlySalary) || 0);
  const holidayRows: HrHoliday[] = input.holidays.map((h, i) => ({
    id: `share-h-${i}-${h.date}`,
    date: h.date,
    name: h.name,
    type: 'company',
    note: null,
    createdAt: '',
    createdByUid: null,
  }));
  const rateDays = salaryRateDays(period.year, period.month, holidayRows);
  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  await setDoc(
    ref,
    {
      sourceDocId,
      uid: input.uid,
      displayName: input.displayName.trim() || 'Staff',
      year: period.year,
      month: period.month,
      period: salaryPeriodKey(period),
      monthlySalary,
      perDaySalary,
      otPerDaySalary: Math.max(0, input.otPerDaySalary),
      leaveEntries: input.leaveEntries,
      projects: input.projects,
      workDayEntries: input.workDayEntries,
      overtimeEntries: input.overtimeEntries,
      holidays: input.holidays,
      updatedAt: now,
      createdAt: existing.exists()
        ? String((existing.data() as Record<string, unknown>).createdAt ?? now)
        : now,
      createdByUid: existing.exists()
        ? ((existing.data() as Record<string, unknown>).createdByUid ?? createdByUid)
        : createdByUid,
    },
    { merge: true },
  );
  return input.token;
}

/** Persist share token on the private salary-month doc for reuse. */
export async function saveSalaryMonthShareToken(
  uid: string,
  period: HrSalaryPeriod,
  token: string,
): Promise<void> {
  await updateDoc(doc(db, MONTH_COLLECTION, salaryMonthDocId(uid, period)), {
    publicShareToken: token,
  }).catch(async () => {
    // Month doc may not exist yet — create a minimal merge.
    await setDoc(
      doc(db, MONTH_COLLECTION, salaryMonthDocId(uid, period)),
      {
        uid,
        year: period.year,
        month: period.month,
        period: salaryPeriodKey(period),
        publicShareToken: token,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}
