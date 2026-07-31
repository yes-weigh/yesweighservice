import type { CatalogCategory, CatalogProduct, CatalogStats } from '../types/catalog';

const CACHE_VERSION = 'v1';
const SESSION_KEY = `yws.catalog.${CACHE_VERSION}`;
/** Soft TTL — within this window we skip Firestore entirely. */
const TTL_MS = 10 * 60 * 1000;

export interface CatalogCachePayload {
  allItems: CatalogProduct[];
  categories: CatalogCategory[];
  syncedAt: string | null;
  /** Invalidation key from catalogMeta (lastContentChangeAt ?? lastSyncAt). */
  contentKey: string | null;
  stats: CatalogStats;
}

interface CatalogCacheEnvelope {
  savedAt: number;
  data: CatalogCachePayload;
}

let memory: CatalogCacheEnvelope | null = null;
let inflight: Promise<CatalogCachePayload> | null = null;

function isFresh(entry: CatalogCacheEnvelope | null): entry is CatalogCacheEnvelope {
  return Boolean(entry && Date.now() - entry.savedAt < TTL_MS && Array.isArray(entry.data?.allItems));
}

function readSession(): CatalogCacheEnvelope | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogCacheEnvelope;
    if (
      !parsed
      || typeof parsed.savedAt !== 'number'
      || !parsed.data
      || !Array.isArray(parsed.data.allItems)
      || !Array.isArray(parsed.data.categories)
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(entry: CatalogCacheEnvelope): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entry));
  } catch {
    // Quota or private mode — memory cache still works.
  }
}

export function peekCatalogCache(): CatalogCachePayload | null {
  if (isFresh(memory)) return memory.data;
  const session = readSession();
  if (isFresh(session)) {
    memory = session;
    return session.data;
  }
  return null;
}

/** Any cached payload (may be past soft TTL) — for meta contentKey compare. */
export function peekCatalogCacheStale(): CatalogCachePayload | null {
  if (memory?.data) return memory.data;
  const session = readSession();
  if (session?.data) {
    memory = session;
    return session.data;
  }
  return null;
}

export function setCatalogCache(data: CatalogCachePayload): void {
  const entry: CatalogCacheEnvelope = { savedAt: Date.now(), data };
  memory = entry;
  writeSession(entry);
}

/** Refresh soft TTL without changing payload (meta said content unchanged). */
export function touchCatalogCache(): void {
  const data = peekCatalogCacheStale();
  if (!data) return;
  setCatalogCache(data);
}

export function clearCatalogCache(): void {
  memory = null;
  inflight = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getCatalogInflight(): Promise<CatalogCachePayload> | null {
  return inflight;
}

export function setCatalogInflight(promise: Promise<CatalogCachePayload> | null): void {
  inflight = promise;
}
