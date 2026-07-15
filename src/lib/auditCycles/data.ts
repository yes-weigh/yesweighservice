import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  AuditCycleDoc,
  AuditCycleSite,
  AuditCycleStatus,
} from '../../types/audit-cycle';

const COLLECTION = 'auditCycles';

const now = () => new Date().toISOString();

function mapCycle(id: string, data: Record<string, unknown>): AuditCycleDoc {
  const status = data.status as AuditCycleStatus;
  return {
    id,
    site: data.site === 'head_office' ? 'head_office' : 'cochin',
    name: String(data.name ?? '').trim() || 'Audit cycle',
    status: status === 'open' || status === 'closed' || status === 'scheduled'
      ? status
      : 'scheduled',
    startsAt: (data.startsAt as string | null) ?? null,
    endsAt: (data.endsAt as string | null) ?? null,
    createdAt: String(data.createdAt ?? ''),
    createdByUid: (data.createdByUid as string | null) ?? null,
    createdByName: (data.createdByName as string | null) ?? null,
    openedAt: (data.openedAt as string | null) ?? null,
    closedAt: (data.closedAt as string | null) ?? null,
  };
}

export async function listAuditCycles(site?: AuditCycleSite): Promise<AuditCycleDoc[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(100)),
  );
  const all = snap.docs.map(d => mapCycle(d.id, d.data() as Record<string, unknown>));
  return site ? all.filter(cycle => cycle.site === site) : all;
}

export async function getAuditCycle(cycleId: string): Promise<AuditCycleDoc | null> {
  const snap = await getDoc(doc(db, COLLECTION, cycleId));
  if (!snap.exists()) return null;
  return mapCycle(snap.id, snap.data() as Record<string, unknown>);
}

export async function getOpenAuditCycle(site: AuditCycleSite): Promise<AuditCycleDoc | null> {
  // status-only query avoids a composite index; at most a few open cycles exist.
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('status', '==', 'open'), limit(10)),
  );
  const match = snap.docs.find(d => d.data()?.site === site);
  if (!match) return null;
  return mapCycle(match.id, match.data() as Record<string, unknown>);
}

export async function listOpenAuditCycles(): Promise<AuditCycleDoc[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('status', '==', 'open'), limit(10)),
  );
  return snap.docs.map(d => mapCycle(d.id, d.data() as Record<string, unknown>));
}

export async function createAuditCycle(input: {
  site: AuditCycleSite;
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
  createdByUid?: string | null;
  createdByName?: string | null;
  openImmediately?: boolean;
}): Promise<AuditCycleDoc> {
  const name = input.name.trim();
  if (!name) throw new Error('Cycle name is required.');

  if (input.openImmediately) {
    const existingOpen = await getOpenAuditCycle(input.site);
    if (existingOpen) {
      throw new Error(
        `Close the open ${input.site === 'head_office' ? 'Head Office' : 'Cochin'} cycle before opening another.`,
      );
    }
  }

  const createdAt = now();
  const ref = doc(collection(db, COLLECTION));
  const status: AuditCycleStatus = input.openImmediately ? 'open' : 'scheduled';
  const docData: AuditCycleDoc = {
    id: ref.id,
    site: input.site,
    name,
    status,
    startsAt: input.startsAt?.trim() || null,
    endsAt: input.endsAt?.trim() || null,
    createdAt,
    createdByUid: input.createdByUid ?? null,
    createdByName: input.createdByName ?? null,
    openedAt: status === 'open' ? createdAt : null,
    closedAt: null,
  };
  await setDoc(ref, docData);
  return docData;
}

export async function openAuditCycle(cycleId: string): Promise<AuditCycleDoc> {
  const cycle = await getAuditCycle(cycleId);
  if (!cycle) throw new Error('Audit cycle not found.');
  if (cycle.status === 'open') return cycle;

  const existingOpen = await getOpenAuditCycle(cycle.site);
  if (existingOpen && existingOpen.id !== cycle.id) {
    throw new Error(
      `Close “${existingOpen.name}” before opening another ${cycle.site === 'head_office' ? 'Head Office' : 'Cochin'} cycle.`,
    );
  }

  const openedAt = now();
  const next: AuditCycleDoc = {
    ...cycle,
    status: 'open',
    openedAt,
    closedAt: null,
  };
  await setDoc(doc(db, COLLECTION, cycle.id), {
    status: 'open',
    openedAt,
    closedAt: null,
  }, { merge: true });
  return next;
}

export async function closeAuditCycle(cycleId: string): Promise<AuditCycleDoc> {
  const cycle = await getAuditCycle(cycleId);
  if (!cycle) throw new Error('Audit cycle not found.');
  if (cycle.status === 'closed') return cycle;

  const closedAt = now();
  const next: AuditCycleDoc = {
    ...cycle,
    status: 'closed',
    closedAt,
  };
  await setDoc(doc(db, COLLECTION, cycle.id), {
    status: 'closed',
    closedAt,
  }, { merge: true });
  return next;
}
