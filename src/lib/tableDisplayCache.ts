import { displayCacheGet, displayCacheRemovePrefix, displayCacheSet } from './displayCache';

const memory = new Map<string, unknown>();
const PREFIX = 'table:';

export function peekTableCache<T>(key: string): T | null {
  if (!memory.has(key)) return null;
  return memory.get(key) as T;
}

export function setTableCache<T>(key: string, data: T): void {
  memory.set(key, data);
  displayCacheSet(`${PREFIX}${key}`, data);
}

export async function hydrateTableCache<T>(key: string): Promise<T | null> {
  if (memory.has(key)) return memory.get(key) as T;
  const disk = await displayCacheGet<T>(`${PREFIX}${key}`);
  if (!disk) return null;
  memory.set(key, disk.data);
  return disk.data;
}

export function clearTableCaches(): void {
  memory.clear();
  displayCacheRemovePrefix(PREFIX);
}
