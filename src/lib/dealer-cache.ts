import { fetchDealers } from './dealers';
import type { ZohoDealer } from '../types/dealers';

const CACHE_VERSION = 'v1';
const SESSION_KEY = `yws.dealers.${CACHE_VERSION}`;
const TTL_MS = 30 * 60 * 1000;
const PAGE_SIZE = 150;

interface DealerCacheEnvelope {
  savedAt: number;
  dealers: ZohoDealer[];
  complete: boolean;
}

type DealerCacheListener = (dealers: ZohoDealer[], complete: boolean) => void;

let memory: DealerCacheEnvelope | null = null;
let inflight: Promise<ZohoDealer[]> | null = null;
const listeners = new Set<DealerCacheListener>();

function isFresh(entry: DealerCacheEnvelope | null): entry is DealerCacheEnvelope {
  return Boolean(entry && Date.now() - entry.savedAt < TTL_MS && entry.dealers.length > 0);
}

function readSession(): DealerCacheEnvelope | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DealerCacheEnvelope;
    if (
      !parsed
      || typeof parsed.savedAt !== 'number'
      || !Array.isArray(parsed.dealers)
      || typeof parsed.complete !== 'boolean'
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(entry: DealerCacheEnvelope): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entry));
  } catch {
    // Quota or private mode — memory cache still works.
  }
}

function notify(dealers: ZohoDealer[], complete: boolean): void {
  for (const listener of listeners) {
    try {
      listener(dealers, complete);
    } catch {
      // ignore listener errors
    }
  }
}

function commit(dealers: ZohoDealer[], complete: boolean): DealerCacheEnvelope {
  const entry: DealerCacheEnvelope = {
    savedAt: Date.now(),
    dealers,
    complete,
  };
  memory = entry;
  writeSession(entry);
  notify(dealers, complete);
  return entry;
}

/** Instant snapshot if already loaded (memory or session). */
export function peekCachedDealers(): ZohoDealer[] | null {
  if (isFresh(memory)) return memory.dealers;
  const session = readSession();
  if (isFresh(session)) {
    memory = session;
    return session.dealers;
  }
  return null;
}

export function clearDealerCache(): void {
  memory = null;
  inflight = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Subscribe to cache updates while pages are still loading. */
export function subscribeDealerCache(listener: DealerCacheListener): () => void {
  listeners.add(listener);
  if (memory) listener(memory.dealers, memory.complete);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads all dealers into memory (and sessionStorage), paging in the background.
 * Partial pages are published as they arrive so search can start early.
 */
export async function ensureDealersCached(options?: { force?: boolean }): Promise<ZohoDealer[]> {
  if (!options?.force) {
    if (isFresh(memory) && memory.complete) return memory.dealers;
    const session = readSession();
    if (isFresh(session) && session.complete) {
      memory = session;
      return session.dealers;
    }
    if (session?.dealers.length) {
      memory = session;
      notify(session.dealers, session.complete);
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    let page = 1;
    let all: ZohoDealer[] = [];
    let totalPages = 1;

    do {
      const res = await fetchDealers({
        page,
        limit: PAGE_SIZE,
        sortField: 'companyName',
        sortDir: 'asc',
      });
      if (page === 1) {
        all = res.data;
        totalPages = Math.max(1, res.pagination.totalPages || 1);
      } else {
        const seen = new Set(all.map(d => d.id));
        for (const dealer of res.data) {
          if (!seen.has(dealer.id)) all.push(dealer);
        }
      }
      commit(all, page >= totalPages);
      page += 1;
    } while (page <= totalPages);

    return all;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Fire-and-forget warm-up for staff / super admin sessions. */
export function prefetchDealersCache(): void {
  if (isFresh(memory) && memory.complete) return;
  void ensureDealersCached().catch(() => undefined);
}
