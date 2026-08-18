import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');
const TTL_MS = 60_000;

let cache: { at: number; qtyByProductId: Record<string, number> } | null = null;
let inflight: Promise<Record<string, number>> | null = null;

function normalizeMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(id ?? '').trim();
    const n = Number(qty);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    out[key] = n;
  }
  return out;
}

/** Draft goods-receipt qty by catalog product id. Empty map if the call fails. */
export async function getScheduledInboundQtyByProductId(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.qtyByProductId;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { qtyByProductId?: Record<string, number> }
      >(functions, 'getScheduledGoodsReceiptInboundFn', { timeout: 30_000 });
      const result = await fn({});
      const qtyByProductId = normalizeMap(result.data?.qtyByProductId);
      cache = { at: Date.now(), qtyByProductId };
      return qtyByProductId;
    } catch {
      const empty = {};
      cache = { at: Date.now(), qtyByProductId: empty };
      return empty;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
