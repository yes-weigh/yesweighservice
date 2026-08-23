import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type FastImageSize = 'thumb' | 'detail';

const DB_NAME = 'yesweigh-fast-images';
const DB_VERSION = 1;
const STORE = 'images';
const MAX_CONCURRENT = 4;
const MAX_ENTRIES = 700;
const MAX_BYTES = 90 * 1024 * 1024;
const THUMB_EDGE = 480;
const DETAIL_EDGE = 1080;

type CacheRecord = {
  blob: Blob;
  createdAt: number;
  bytes: number;
};

type MemoryEntry = {
  url: string;
  bytes: number;
  lastUsed: number;
};

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<string>>();
const highQueue: Array<() => void> = [];
const lowQueue: Array<() => void> = [];
let activeDownloads = 0;
let dbPromise: Promise<IDBDatabase> | null = null;

function isRemoteHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export function fastImageCacheKey(src: string, size: FastImageSize): string {
  return `${size}:${stableImageKey(src)}`;
}

/** Path + optional `v=` so a replaced Storage object is a new cache entry. */
export function stableImageKey(src: string): string {
  try {
    const url = new URL(src, typeof window !== 'undefined' ? window.location.href : 'https://local.invalid');
    const version = url.searchParams.get('v') ?? '';
    const alt = url.searchParams.get('alt') ?? '';
    return `${url.origin}${url.pathname}|${alt}|${version}`;
  } catch {
    return src;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open image cache.'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function rememberBlob(key: string, blob: Blob): string {
  const existing = memory.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.url;
  }
  const url = URL.createObjectURL(blob);
  memory.set(key, { url, bytes: blob.size, lastUsed: Date.now() });
  if (memory.size > 180) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest && oldest[0] !== key) {
      URL.revokeObjectURL(oldest[1].url);
      memory.delete(oldest[0]);
    }
  }
  return url;
}

async function idbGet(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const record = await requestToPromise(tx.objectStore(STORE).get(key)) as CacheRecord | undefined;
    if (!record?.blob) return null;
    return record.blob;
  } catch {
    return null;
  }
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(
      { blob, createdAt: Date.now(), bytes: blob.size } satisfies CacheRecord,
      key,
    );
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Image cache write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Image cache write aborted.'));
    });
    await evictIfNeeded();
  } catch {
    // Quota / private mode — memory cache still helps this session.
  }
}

async function evictIfNeeded(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const keysRequest = store.getAllKeys();
  const recordsRequest = store.getAll();
  const keys = await requestToPromise(keysRequest) as IDBValidKey[];
  const records = await requestToPromise(recordsRequest) as CacheRecord[];
  const total = records.reduce((sum, row) => sum + (row?.bytes ?? 0), 0);
  if (keys.length <= MAX_ENTRIES && total <= MAX_BYTES) return;

  const entries = keys.map((id, index) => ({
    id,
    createdAt: records[index]?.createdAt ?? 0,
    bytes: records[index]?.bytes ?? 0,
  }));
  entries.sort((a, b) => a.createdAt - b.createdAt);

  let bytes = total;
  let count = entries.length;
  for (const row of entries) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    store.delete(row.id);
    bytes -= row.bytes;
    count -= 1;
  }
}

function pumpQueue(): void {
  while (activeDownloads < MAX_CONCURRENT && (highQueue.length || lowQueue.length)) {
    const next = highQueue.shift() ?? lowQueue.shift();
    next?.();
  }
}

function enqueue<T>(fn: () => Promise<T>, priority: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeDownloads += 1;
      fn().then(resolve, reject).finally(() => {
        activeDownloads -= 1;
        pumpQueue();
      });
    };
    (priority ? highQueue : lowQueue).push(start);
    pumpQueue();
  });
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const match = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : undefined;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function downloadImageBlob(url: string): Promise<Blob> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
    });
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 0) return blob;
    }
  } catch {
    // CORS (common on Capacitor) or network — try native HTTP next.
  }

  if (Capacitor.isNativePlatform()) {
    const http = await CapacitorHttp.get({
      url,
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    if (http.status >= 200 && http.status < 300) {
      const mime = (headerValue(http.headers, 'content-type')?.split(';')[0]?.trim() || 'image/jpeg');
      const data = http.data;
      if (data instanceof Blob && data.size > 0) return data;
      if (typeof data === 'string' && data.trim()) {
        const raw = data.trim().replace(/^data:[^;]+;base64,/i, '');
        const blob = base64ToBlob(raw, mime);
        if (blob.size > 0) return blob;
      }
    }
  }

  throw new Error('Could not download image.');
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), type, quality);
  });
}

async function prepareDisplayBlob(blob: Blob, size: FastImageSize): Promise<Blob> {
  const maxEdge = size === 'detail' ? DETAIL_EDGE : THUMB_EDGE;
  if (blob.size <= 28_000) return blob;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxEdge / Math.max(1, longest));
  if (scale >= 1 && blob.size <= 80_000) {
    bitmap.close?.();
    return blob;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return blob;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const webp = await canvasToBlob(canvas, 'image/webp', 0.72);
  if (webp && webp.size > 0 && webp.size < blob.size) return webp;
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.78);
  if (jpeg && jpeg.size > 0 && jpeg.size < blob.size) return jpeg;
  return blob;
}

async function resolveDisplayUrl(src: string, size: FastImageSize): Promise<string> {
  const key = fastImageCacheKey(src, size);
  const hit = memory.get(key);
  if (hit) {
    hit.lastUsed = Date.now();
    return hit.url;
  }

  const cached = await idbGet(key);
  if (cached) return rememberBlob(key, cached);

  const original = await downloadImageBlob(src);
  const prepared = await prepareDisplayBlob(original, size);
  void idbPut(key, prepared);
  return rememberBlob(key, prepared);
}

export function peekFastImageUrl(src: string, size: FastImageSize = 'thumb'): string | null {
  if (!src || !isRemoteHttpUrl(src)) return src || null;
  const hit = memory.get(fastImageCacheKey(src, size));
  if (!hit) return null;
  hit.lastUsed = Date.now();
  return hit.url;
}

export function loadFastImage(
  src: string,
  size: FastImageSize = 'thumb',
  priority = false,
): Promise<string> {
  if (!src) return Promise.reject(new Error('Missing image URL.'));
  if (!isRemoteHttpUrl(src)) return Promise.resolve(src);

  const key = fastImageCacheKey(src, size);
  const hit = memory.get(key);
  if (hit) {
    hit.lastUsed = Date.now();
    return Promise.resolve(hit.url);
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const work = enqueue(() => resolveDisplayUrl(src, size), priority)
    .finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

export function prefetchFastImages(
  urls: Array<string | null | undefined>,
  size: FastImageSize = 'thumb',
): void {
  urls.slice(0, 16).forEach((url, index) => {
    if (!url || !isRemoteHttpUrl(url)) return;
    void loadFastImage(url, size, index < 8);
  });
}
