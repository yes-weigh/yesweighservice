import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';

export type ZohoSalespersonOption = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  /** Portal-only: excluded from pickers and dealer linking when true. */
  hiddenFromPortal?: boolean;
};

const functions = getFunctions(app, 'asia-south1');
const COLLECTION = 'zohoSalespersons';

let memoryCache: { at: number; rows: ZohoSalespersonOption[] } | null = null;
const MEMORY_TTL_MS = 60 * 1000;

function sortRows(rows: ZohoSalespersonOption[]): ZohoSalespersonOption[] {
  return [...rows].sort((a, b) => {
    if (Boolean(a.hiddenFromPortal) !== Boolean(b.hiddenFromPortal)) {
      return a.hiddenFromPortal ? 1 : -1;
    }
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function mapDoc(id: string, data: Record<string, unknown>): ZohoSalespersonOption | null {
  const docId = String(data.id ?? id).trim();
  if (!docId) return null;
  return {
    id: docId,
    name: String(data.name ?? docId).trim() || docId,
    email: data.email != null && String(data.email).trim() ? String(data.email).trim() : null,
    active: data.active !== false,
    hiddenFromPortal: data.hiddenFromPortal === true,
  };
}

/** Fast path: read cached Zoho salespersons from Firestore. */
export async function listZohoSalespersonsFromFirestore(): Promise<ZohoSalespersonOption[]> {
  if (memoryCache && Date.now() - memoryCache.at < MEMORY_TTL_MS) {
    return memoryCache.rows;
  }
  const snap = await getDocs(collection(db, COLLECTION));
  const rows = sortRows(
    snap.docs
      .map(doc => mapDoc(doc.id, (doc.data() || {}) as Record<string, unknown>))
      .filter((row): row is ZohoSalespersonOption => Boolean(row)),
  );
  memoryCache = { at: Date.now(), rows };
  return rows;
}

/** Pull latest salespersons from Zoho into Firestore (slow; use sparingly). */
export async function syncZohoSalespersonsFromZoho(): Promise<ZohoSalespersonOption[]> {
  const callable = httpsCallable<unknown, {
    count?: number;
    salespersons?: ZohoSalespersonOption[];
  }>(functions, 'syncZohoSalespersons');
  const result = await callable({});
  const rows = sortRows(
    (Array.isArray(result.data?.salespersons) ? result.data.salespersons : [])
      .map(row => ({
        id: String(row.id ?? '').trim(),
        name: String(row.name ?? '').trim() || String(row.id ?? '').trim(),
        email: row.email != null && String(row.email).trim() ? String(row.email).trim() : null,
        active: row.active !== false,
        hiddenFromPortal: row.hiddenFromPortal === true,
      }))
      .filter(row => row.id),
  );
  memoryCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Load salespersons for pickers / management UI.
 * Reads Firestore first; if empty, syncs from Zoho once.
 */
export async function listZohoSalespersons(options?: {
  forceRefresh?: boolean;
  /** When true, include portal-hidden rows (management UI). Pickers leave this off. */
  includeHidden?: boolean;
}): Promise<ZohoSalespersonOption[]> {
  const includeHidden = options?.includeHidden === true;
  let rows: ZohoSalespersonOption[];
  if (options?.forceRefresh) {
    rows = await syncZohoSalespersonsFromZoho();
  } else {
    rows = await listZohoSalespersonsFromFirestore();
    if (!rows.length) {
      rows = await syncZohoSalespersonsFromZoho();
    }
  }
  if (includeHidden) return rows;
  return rows.filter(row => !row.hiddenFromPortal);
}

export function clearZohoSalespersonsCache(): void {
  memoryCache = null;
}

export type ZohoSalespersonHideImpact = {
  id: string;
  name: string;
  hiddenFromPortal: boolean;
  linkedStaff: { uid: string; displayName: string } | null;
  dealerCount: number;
  requiresReassign: boolean;
};

export type SetZohoSalespersonPortalHiddenResult = ZohoSalespersonOption & {
  reassigned?: { moved: number; targetUid: string; targetName: string } | null;
};

/** Preview dealer reassignment needs before hiding. */
export async function fetchZohoSalespersonHideImpact(
  salespersonId: string,
): Promise<ZohoSalespersonHideImpact> {
  const callable = httpsCallable<{ salespersonId: string }, ZohoSalespersonHideImpact>(
    functions,
    'getZohoSalespersonHideImpactFn',
  );
  const result = await callable({ salespersonId });
  return {
    id: String(result.data?.id ?? salespersonId).trim(),
    name: String(result.data?.name ?? salespersonId).trim(),
    hiddenFromPortal: result.data?.hiddenFromPortal === true,
    linkedStaff: result.data?.linkedStaff
      ? {
        uid: String(result.data.linkedStaff.uid),
        displayName: String(result.data.linkedStaff.displayName ?? 'Staff'),
      }
      : null,
    dealerCount: Number(result.data?.dealerCount ?? 0) || 0,
    requiresReassign: Boolean(result.data?.requiresReassign),
  };
}

/** Hide or unhide a Zoho salesperson from portal pickers + dealer linking. */
export async function setZohoSalespersonPortalHidden(
  salespersonId: string,
  hidden: boolean,
  options?: { reassignToStaffUid?: string | null },
): Promise<SetZohoSalespersonPortalHiddenResult> {
  const callable = httpsCallable<
    { salespersonId: string; hidden: boolean; reassignToStaffUid?: string | null },
    SetZohoSalespersonPortalHiddenResult
  >(functions, 'setZohoSalespersonPortalHidden');
  const result = await callable({
    salespersonId,
    hidden,
    reassignToStaffUid: options?.reassignToStaffUid ?? null,
  });
  clearZohoSalespersonsCache();
  return {
    id: String(result.data?.id ?? salespersonId).trim(),
    name: String(result.data?.name ?? salespersonId).trim(),
    email: result.data?.email != null && String(result.data.email).trim()
      ? String(result.data.email).trim()
      : null,
    active: result.data?.active !== false,
    hiddenFromPortal: result.data?.hiddenFromPortal === true,
    reassigned: result.data?.reassigned ?? null,
  };
}

export function dealersSalespersonsPath(basePath: string): string {
  const base = basePath.replace(/\/$/, '');
  return `${base}/dealers?tab=salespersons`;
}
