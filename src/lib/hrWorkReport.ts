import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchDealers } from './dealers';
import { fetchOpsSupportRequests } from './dealerSupport';
import { readHrProfileFromDoc } from './hrStaff';
import type { FirestoreUserDoc, UserRecord } from '../types';
import { normalizeRole } from '../types';
import type { StaffDepartment } from '../types/staff-access';
import {
  periodBounds,
  type StaffWorkSummary,
  type WorkReportPeriod,
} from '../types/hr-work-report';

const STAFF_ROLES = new Set(['staff', 'super_admin']);

function inPeriod(iso: string | undefined, start: string, end: string): boolean {
  if (!iso) return false;
  return iso >= start && iso <= end;
}

function activityScore(summary: Pick<
  StaffWorkSummary,
  'dealersManaged' | 'supportResponses' | 'staffOnboarded'
>): number {
  return summary.dealersManaged * 3 + summary.supportResponses * 2 + summary.staffOnboarded * 5;
}

async function countSupportResponsesByStaff(
  staffUids: Set<string>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const uid of staffUids) counts.set(uid, 0);

  const requests = await fetchOpsSupportRequests();
  const inRange = requests.filter(req => inPeriod(req.updatedAt, start, end)).slice(0, 60);

  await Promise.all(
    inRange.map(async req => {
      const snap = await getDocs(
        collection(db, 'dealerSupportRequests', req.id, 'messages'),
      );
      for (const msgDoc of snap.docs) {
        const data = msgDoc.data();
        const authorUid = String(data.authorUid ?? '');
        const authorRole = String(data.authorRole ?? '');
        const createdAt = String(data.createdAt ?? '');
        if (!STAFF_ROLES.has(authorRole) || !staffUids.has(authorUid)) continue;
        if (!inPeriod(createdAt, start, end)) continue;
        if (data.isInitial === true && authorRole === 'dealer') continue;
        counts.set(authorUid, (counts.get(authorUid) ?? 0) + 1);
      }
    }),
  );

  return counts;
}

async function countDealersByKam(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const res = await fetchDealers({ page: 1, limit: 500 });
    for (const dealer of res.data) {
      if (!dealer.kamId) continue;
      counts.set(dealer.kamId, (counts.get(dealer.kamId) ?? 0) + 1);
    }
  } catch {
    // Dealer API may be unavailable; report still shows other metrics.
  }
  return counts;
}

async function fetchStaffRecords(): Promise<UserRecord[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs
    .map(d => {
      const data = d.data() as FirestoreUserDoc;
      const role = normalizeRole(String(data.role ?? ''));
      if (role !== 'staff') return null;
      return { uid: d.id, ...data, role } as UserRecord;
    })
    .filter((u): u is UserRecord => u !== null);
}

async function countStaffOnboardedByCreator(
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const snap = await getDocs(
    query(collection(db, 'users'), where('role', '==', 'staff')),
  );
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as FirestoreUserDoc;
    const createdBy = data.createdByUid;
    const createdAt = data.createdAt;
    if (!createdBy || !inPeriod(createdAt, start, end)) continue;
    counts.set(createdBy, (counts.get(createdBy) ?? 0) + 1);
  }
  return counts;
}

export async function buildStaffWorkReport(period: WorkReportPeriod): Promise<StaffWorkSummary[]> {
  const { start, end } = periodBounds(period);
  const staff = await fetchStaffRecords();
  const staffUids = new Set(staff.map(r => r.uid));

  const [dealersByKam, supportByStaff, onboardedByStaff] = await Promise.all([
    countDealersByKam(),
    countSupportResponsesByStaff(staffUids, start, end),
    countStaffOnboardedByCreator(start, end),
  ]);

  return staff
    .map(record => {
      const hr = readHrProfileFromDoc(record);
      const department = (record.staffDepartment ?? 'admin') as StaffDepartment;
      const dealersManaged = record.staffKamId
        ? dealersByKam.get(record.staffKamId) ?? 0
        : 0;
      const supportResponses = supportByStaff.get(record.uid) ?? 0;
      const staffOnboarded = onboardedByStaff.get(record.uid) ?? 0;
      const partial = { dealersManaged, supportResponses, staffOnboarded };

      return {
        staffUid: record.uid,
        displayName: record.displayName,
        department,
        designation: hr.hrDesignation ?? null,
        employeeId: hr.hrEmployeeId ?? null,
        active: record.active !== false,
        ...partial,
        activityScore: activityScore(partial),
      };
    })
    .sort((a, b) => b.activityScore - a.activityScore || a.displayName.localeCompare(b.displayName));
}
