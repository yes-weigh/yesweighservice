import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { HrHoliday, HrHolidayInput, HrHolidayType } from '../types/hr-holiday';

const COLLECTION = 'hrHolidays';

export const DEFAULT_HR_HOLIDAYS_2026: Array<Omit<HrHolidayInput, 'note'>> = [
  { date: '2026-01-26', name: 'Republic Day', type: 'public' },
  { date: '2026-03-03', name: 'Holi', type: 'public' },
  { date: '2026-04-03', name: 'Good Friday', type: 'public' },
  { date: '2026-04-14', name: 'Vishu', type: 'company' },
  { date: '2026-05-01', name: 'Labour Day', type: 'public' },
  { date: '2026-08-15', name: 'Independence Day', type: 'public' },
  { date: '2026-08-26', name: 'Onam', type: 'company' },
  { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'public' },
  { date: '2026-10-20', name: 'Diwali', type: 'public' },
  { date: '2026-11-08', name: 'Deepavali (regional)', type: 'optional' },
  { date: '2026-12-25', name: 'Christmas', type: 'public' },
];

function mapHoliday(id: string, data: Record<string, unknown>): HrHoliday {
  return {
    id,
    date: String(data.date ?? ''),
    name: String(data.name ?? ''),
    type: (data.type ?? 'public') as HrHolidayType,
    note: data.note != null ? String(data.note) : null,
    createdAt: String(data.createdAt ?? ''),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
  };
}

export async function fetchHrHolidays(): Promise<HrHoliday[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('date', 'asc')));
  return snap.docs.map(d => mapHoliday(d.id, d.data() as Record<string, unknown>));
}

export async function createHrHoliday(
  input: HrHolidayInput,
  createdByUid: string,
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTION), {
    date: input.date,
    name: input.name.trim(),
    type: input.type,
    note: input.note?.trim() || null,
    createdAt: new Date().toISOString(),
    createdByUid,
  });
  return ref.id;
}

export async function deleteHrHoliday(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

export async function seedDefaultHrHolidays(createdByUid: string): Promise<number> {
  const existing = await fetchHrHolidays();
  const existingDates = new Set(existing.map(h => h.date));
  const toAdd = DEFAULT_HR_HOLIDAYS_2026.filter(h => !existingDates.has(h.date));
  if (toAdd.length === 0) return 0;

  const batch = writeBatch(db);
  const now = new Date().toISOString();
  for (const holiday of toAdd) {
    const ref = doc(collection(db, COLLECTION));
    batch.set(ref, {
      ...holiday,
      note: null,
      createdAt: now,
      createdByUid,
    });
  }
  await batch.commit();
  return toAdd.length;
}

export function holidaysInMonth(holidays: HrHoliday[], year: number, month: number): HrHoliday[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return holidays.filter(h => h.date.startsWith(prefix));
}

export function holidayDatesSet(holidays: HrHoliday[]): Set<string> {
  return new Set(holidays.map(h => h.date));
}
