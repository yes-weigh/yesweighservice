/**
 * Token-gated switch of a public salary share to another month for the same staff.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { dropRegularMarksWhenOtOnClosedDays } from './hr-salary-closed-day.js';

const SHARE_COLLECTION = 'hrSalaryShares';
const MONTH_COLLECTION = 'hrSalaryMonths';
const HOLIDAY_COLLECTION = 'hrHolidays';
const PAYROLL_PREFIX = 'ext_';

function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function countSundays(year, month) {
  let count = 0;
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day += 1) {
    if (new Date(year, month - 1, day).getDay() === 0) count += 1;
  }
  return count;
}

function countWeekdayHolidays(holidays, year, month) {
  const key = periodKey(year, month);
  let count = 0;
  for (const h of holidays) {
    const date = String(h?.date ?? '').trim();
    if (!date.startsWith(key)) continue;
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) continue;
    if (new Date(y, m - 1, d).getDay() === 0) continue;
    count += 1;
  }
  return count;
}

function salaryRateDays(year, month, holidays) {
  return Math.max(
    0,
    daysInMonth(year, month) - countSundays(year, month) - countWeekdayHolidays(holidays, year, month),
  );
}

function perDayFromMonthly(monthlySalary, rateDays) {
  const monthly = Math.max(0, Number(monthlySalary) || 0);
  if (!(monthly > 0) || !(rateDays > 0)) return 0;
  return Math.round((monthly / rateDays) * 100) / 100;
}

function normalizeHolidays(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(h => ({
      date: String(h?.date ?? '').trim(),
      name: String(h?.name ?? '').trim().slice(0, 120) || 'Holiday',
    }))
    .filter(h => h.date);
}

async function fetchMonthHolidays(db, year, month) {
  const key = periodKey(year, month);
  const lastDay = String(daysInMonth(year, month)).padStart(2, '0');
  const snap = await db.collection(HOLIDAY_COLLECTION)
    .where('date', '>=', `${key}-01`)
    .where('date', '<=', `${key}-${lastDay}`)
    .get();
  return snap.docs.map(d => {
    const data = d.data() || {};
    return {
      date: String(data.date ?? '').trim(),
      name: String(data.name ?? 'Holiday').trim().slice(0, 120) || 'Holiday',
    };
  }).filter(h => h.date);
}

async function fetchPayrollDefaults(db, uid) {
  if (!uid.startsWith(PAYROLL_PREFIX)) return null;
  const employeeId = uid.slice(PAYROLL_PREFIX.length);
  if (!employeeId) return null;
  const snap = await db.collection('hrPayrollEmployees').doc(employeeId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    monthlySalary: Math.max(0, Number(data.defaultMonthlySalary) || 0),
    perDaySalary: Math.max(0, Number(data.defaultPerDaySalary) || 0),
    otPerDaySalary: Math.max(0, Number(data.defaultOtPerDaySalary) || 0),
  };
}

function resolveRates(saved, shareFallback, payrollDefaults, year, month, holidays) {
  const rateDays = salaryRateDays(year, month, holidays);
  const defaultMonthly = payrollDefaults?.monthlySalary ?? shareFallback.monthlySalary ?? 0;
  const defaultOt = payrollDefaults?.otPerDaySalary ?? shareFallback.otPerDaySalary ?? 0;

  let monthlySalary = 0;
  let otPerDaySalary = 0;

  if (saved) {
    if (Number(saved.monthlySalary) > 0) {
      monthlySalary = Math.max(0, Number(saved.monthlySalary) || 0);
    } else if (Number(saved.perDaySalary) > 0) {
      monthlySalary = Math.round((Number(saved.perDaySalary) * Math.max(rateDays, 1)) * 100) / 100;
    }
    if (Number(saved.otPerDaySalary) > 0) {
      otPerDaySalary = Math.max(0, Number(saved.otPerDaySalary) || 0);
    }
  }

  if (!(monthlySalary > 0) && defaultMonthly > 0) {
    monthlySalary = defaultMonthly;
  }
  if (!(otPerDaySalary > 0) && defaultOt > 0) {
    otPerDaySalary = defaultOt;
  }
  const perDaySalary = perDayFromMonthly(monthlySalary, rateDays);
  if (!(otPerDaySalary > 0) && perDaySalary > 0) {
    otPerDaySalary = perDaySalary;
  }

  return { monthlySalary, perDaySalary, otPerDaySalary };
}

/**
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function switchPublicSalarySharePeriod(payload = {}) {
  const token = String(payload.token ?? '').trim();
  if (!token || token.length < 16 || token.length > 128) {
    throw new HttpsError('invalid-argument', 'Invalid share token.');
  }

  const year = Number(payload.year) || 0;
  const month = Number(payload.month) || 0;
  if (!year || month < 1 || month > 12) {
    throw new HttpsError('invalid-argument', 'Invalid month.');
  }

  const db = getFirestore();
  const shareRef = db.collection(SHARE_COLLECTION).doc(token);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    throw new HttpsError('not-found', 'This salary link is invalid or has been removed.');
  }

  const existing = shareSnap.data() || {};
  const uid = String(existing.uid ?? '').trim();
  if (!uid) {
    throw new HttpsError('failed-precondition', 'Share document is incomplete.');
  }

  const key = periodKey(year, month);
  const sourceDocId = `${uid}_${key}`;
  const holidays = await fetchMonthHolidays(db, year, month);

  const monthRef = db.collection(MONTH_COLLECTION).doc(sourceDocId);
  const monthSnap = await monthRef.get();
  const monthData = monthSnap.exists ? (monthSnap.data() || {}) : null;
  const payrollDefaults = monthData ? null : await fetchPayrollDefaults(db, uid);

  const shareFallback = {
    monthlySalary: Math.max(0, Number(existing.monthlySalary) || 0),
    otPerDaySalary: Math.max(0, Number(existing.otPerDaySalary) || 0),
  };
  const rates = resolveRates(monthData, shareFallback, payrollDefaults, year, month, holidays);

  const leaveEntries = Array.isArray(monthData?.leaveEntries) ? monthData.leaveEntries : [];
  const expenseEntries = Array.isArray(monthData?.expenseEntries) ? monthData.expenseEntries : [];
  const receiptEntries = Array.isArray(monthData?.receiptEntries) ? monthData.receiptEntries : [];
  const projects = Array.isArray(monthData?.projects) ? monthData.projects : [];
  const workDayEntries = Array.isArray(monthData?.workDayEntries) ? monthData.workDayEntries : [];
  const workShiftEntries = Array.isArray(monthData?.workShiftEntries) ? monthData.workShiftEntries : [];
  const dayJoinEntries = Array.isArray(monthData?.dayJoinEntries) ? monthData.dayJoinEntries : [];
  const overtimeEntries = Array.isArray(monthData?.overtimeEntries) ? monthData.overtimeEntries : [];
  const cleaned = dropRegularMarksWhenOtOnClosedDays(year, month, holidays, {
    overtimeEntries,
    workDayEntries,
    workShiftEntries,
    dayJoinEntries,
  });

  const now = new Date().toISOString();

  await shareRef.set({
    sourceDocId,
    uid,
    displayName: String(existing.displayName ?? 'Staff').trim() || 'Staff',
    year,
    month,
    period: key,
    monthlySalary: rates.monthlySalary,
    perDaySalary: rates.perDaySalary,
    otPerDaySalary: rates.otPerDaySalary,
    leaveEntries,
    projects,
    workDayEntries: cleaned.workDayEntries,
    workShiftEntries: cleaned.workShiftEntries,
    dayJoinEntries: cleaned.dayJoinEntries,
    expenseEntries,
    receiptEntries,
    overtimeEntries,
    holidays,
    updatedAt: now,
    createdAt: existing.createdAt || now,
    createdByUid: existing.createdByUid ?? null,
  }, { merge: true });

  return {
    token,
    year,
    month,
    period: key,
    updatedAt: now,
  };
}
