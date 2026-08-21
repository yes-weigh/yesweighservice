/** Sundays / weekday holidays with OT: keep OT only (drop regular marks). */

function isSundayIsoDate(date) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getDay() === 0;
}

function weekdayHolidayDates(holidays, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const dates = new Set();
  for (const holiday of holidays || []) {
    const date = String(holiday?.date ?? '').trim();
    if (!date.startsWith(prefix) || isSundayIsoDate(date)) continue;
    dates.add(date);
  }
  return dates;
}

export function dropRegularMarksWhenOtOnClosedDays(
  year,
  month,
  holidays,
  {
    overtimeEntries = [],
    workDayEntries = [],
    workShiftEntries = [],
    dayJoinEntries = [],
  },
) {
  const closed = weekdayHolidayDates(holidays, year, month);
  const otOnClosed = new Set();
  for (const entry of overtimeEntries) {
    const date = String(entry?.date ?? '').trim();
    if (!date) continue;
    if (isSundayIsoDate(date) || closed.has(date)) otOnClosed.add(date);
  }
  if (otOnClosed.size === 0) {
    return { workDayEntries, workShiftEntries, dayJoinEntries };
  }
  return {
    workDayEntries: workDayEntries.filter(e => !otOnClosed.has(e.date)),
    workShiftEntries: workShiftEntries.filter(e => !otOnClosed.has(e.date)),
    dayJoinEntries: dayJoinEntries.filter(e => !otOnClosed.has(e.date)),
  };
}
