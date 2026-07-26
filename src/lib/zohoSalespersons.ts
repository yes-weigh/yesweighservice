import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';

export type ZohoSalespersonOption = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
};

const functions = getFunctions(app, 'asia-south1');
const COLLECTION = 'zohoSalespersons';

let memoryCache: { at: number; rows: ZohoSalespersonOption[] } | null = null;
const MEMORY_TTL_MS = 60 * 1000;

function sortRows(rows: ZohoSalespersonOption[]): ZohoSalespersonOption[] {
  return [...rows].sort((a, b) => {
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
      }))
      .filter(row => row.id),
  );
  memoryCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Load salespersons for the HR dropdown.
 * Reads Firestore first; if empty, syncs from Zoho once.
 */
export async function listZohoSalespersons(options?: {
  forceRefresh?: boolean;
}): Promise<ZohoSalespersonOption[]> {
  if (options?.forceRefresh) {
    return syncZohoSalespersonsFromZoho();
  }
  const cached = await listZohoSalespersonsFromFirestore();
  if (cached.length) return cached;
  return syncZohoSalespersonsFromZoho();
}

export function clearZohoSalespersonsCache() {
  memoryCache = null;
}
