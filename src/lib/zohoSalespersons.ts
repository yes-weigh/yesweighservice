import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

export type ZohoSalespersonOption = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
};

type ListResult = {
  salespersons: ZohoSalespersonOption[];
};

const functions = getFunctions(app, 'asia-south1');

let cache: { at: number; promise: Promise<ZohoSalespersonOption[]> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function listZohoSalespersons(options?: {
  forceRefresh?: boolean;
}): Promise<ZohoSalespersonOption[]> {
  const force = options?.forceRefresh === true;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.promise;
  }

  const promise = (async () => {
    const callable = httpsCallable<unknown, ListResult>(functions, 'listZohoSalespersons');
    const result = await callable({});
    const rows = Array.isArray(result.data?.salespersons) ? result.data.salespersons : [];
    return rows
      .map(row => ({
        id: String(row.id ?? '').trim(),
        name: String(row.name ?? '').trim() || String(row.id ?? '').trim(),
        email: row.email != null && String(row.email).trim() ? String(row.email).trim() : null,
        active: row.active !== false,
      }))
      .filter(row => row.id);
  })();

  cache = { at: Date.now(), promise };
  try {
    return await promise;
  } catch (err) {
    cache = null;
    throw err;
  }
}

export function clearZohoSalespersonsCache() {
  cache = null;
}
