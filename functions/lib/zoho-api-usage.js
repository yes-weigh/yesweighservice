import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';

export const ZOHO_DAILY_API_LIMIT = 10_000;
const USAGE_REF = () => getFirestore().collection('zohoMeta').doc('apiUsage');
/** Avoid hitting Zoho on every admin poll (page refreshes every 5–10s). */
const LIVE_CACHE_MS = 25_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LATCH_MEMO_MS = 10_000;

/** @type {{ blockedUntilMs: number, dayKey: string | null, readAt: number }} */
let latchMemo = { blockedUntilMs: 0, dayKey: null, readAt: 0 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function zohoIstDayKey(ms = Date.now()) {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function nextIstMidnightMs(ms = Date.now()) {
  const d = new Date(ms + IST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0) - IST_OFFSET_MS;
}

function blockedUntilMsFromData(data) {
  const raw = data?.blockedUntil;
  if (raw?.toDate) {
    const t = raw.toDate().getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export function zohoDailyQuotaError(blockedUntilIso = null) {
  const until = blockedUntilIso
    ? ` until ${blockedUntilIso}`
    : ' until midnight IST';
  const err = new Error(
    `Zoho daily API limit (10,000 calls) has been reached. No further Inventory API calls${until}.`,
  );
  err.code = 'RATE_LIMITED';
  err.dailyQuota = true;
  return err;
}

function latchActiveFromFields(blockedUntilMs, _dayKey, now = Date.now()) {
  return Number(blockedUntilMs) > now;
}

function rememberLatch(blockedUntilMs, dayKey) {
  latchMemo = { blockedUntilMs: blockedUntilMs || 0, dayKey: dayKey || null, readAt: Date.now() };
}

/** First daily-cap hit: freeze Inventory API until next midnight IST. */
export async function markZohoDailyQuotaBlocked(options = {}) {
  const now = Date.now();
  const dayKey = zohoIstDayKey(now);
  const blockedUntilMs = nextIstMidnightMs(now);
  const blockedUntil = new Date(blockedUntilMs).toISOString();
  rememberLatch(blockedUntilMs, dayKey);
  await USAGE_REF().set({
    status: 'daily_limit',
    remaining: 0,
    usagePct: 100,
    dayKey,
    blockedUntil,
    lastOperation: options.operation ?? null,
    lastSource: options.source ?? null,
    lastError: String(options.lastError ?? 'Zoho daily API limit (10,000)').slice(0, 500),
    lastRateLimitAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
  console.warn(`Zoho daily quota latch set until ${blockedUntil} (IST day ${dayKey}).`);
  return { dayKey, blockedUntil, blockedUntilMs };
}

export async function isZohoDailyQuotaBlocked() {
  const now = Date.now();
  if (now - latchMemo.readAt < LATCH_MEMO_MS) {
    return latchActiveFromFields(latchMemo.blockedUntilMs, latchMemo.dayKey, now);
  }
  const snap = await USAGE_REF().get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const blockedUntilMs = blockedUntilMsFromData(data);
  const dayKey = typeof data.dayKey === 'string' ? data.dayKey : null;
  rememberLatch(blockedUntilMs, dayKey);
  const active = latchActiveFromFields(blockedUntilMs, dayKey, now);
  if (active) return true;
  if (data.status === 'daily_limit' && dayKey === zohoIstDayKey(now)) {
    // Same IST day, cap already hit, blockedUntil missing (older docs).
    return true;
  }
  return false;
}

/** Throws RATE_LIMITED+dailyQuota when today's latch is on. No Zoho call. */
export async function assertZohoInventoryAllowed() {
  if (await isZohoDailyQuotaBlocked()) {
    const until = latchMemo.blockedUntilMs
      ? new Date(latchMemo.blockedUntilMs).toISOString()
      : null;
    throw zohoDailyQuotaError(until);
  }
}

function parseRateLimitHeaders(response) {
  if (!response?.headers) return {};
  const get = name => response.headers.get(name) ?? response.headers.get(name.toLowerCase());
  const rawLimit = get('x-rate-limit-limit') ?? get('X-Rate-Limit-Limit');
  const rawRemaining = get('x-rate-limit-remaining') ?? get('X-RateLimit-Remaining');
  const rawReset = get('x-rate-limit-reset') ?? get('X-Rate-Limit-Reset');
  const rawRetry = get('retry-after') ?? get('Retry-After');

  const windowLimit = rawLimit != null && rawLimit !== '' ? Number(rawLimit) : NaN;
  const windowRemaining = rawRemaining != null && rawRemaining !== '' ? Number(rawRemaining) : NaN;
  const resetSec = rawReset != null && rawReset !== '' ? Number(rawReset) : NaN;
  const retryAfterSec = rawRetry != null && rawRetry !== '' ? Number(rawRetry) : NaN;

  return {
    windowLimit: Number.isFinite(windowLimit) && windowLimit > 0 ? windowLimit : null,
    windowRemaining: Number.isFinite(windowRemaining) && windowRemaining >= 0 ? windowRemaining : null,
    resetSec: Number.isFinite(resetSec) && resetSec > 0 ? resetSec : null,
    retryAfterSec: Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : null,
  };
}

function isDailyQuotaMessage(message) {
  const text = String(message ?? '').toLowerCase();
  return text.includes('maximum call rate limit')
    || text.includes('10,000')
    || text.includes('10000');
}

function deriveStatus(remaining, dailyLimit) {
  if (remaining <= 0) return 'daily_limit';
  if (dailyLimit > 0 && remaining <= dailyLimit * 0.05) return 'low';
  return 'ok';
}

function normalizeUserDetails(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(user => ({
    name: user.name ? String(user.name) : null,
    email: user.email ? String(user.email) : null,
    total: Number(user.user_total ?? 0),
    hosts: Array.isArray(user.host)
      ? user.host.map(h => ({
        ip: h.ip_address ? String(h.ip_address) : null,
        count: Number(h.ip_count ?? 0),
      }))
      : [],
  }));
}

function formatUsageDoc(data) {
  const now = Date.now();
  const dailyLimit = Number(data.dailyLimit ?? ZOHO_DAILY_API_LIMIT);
  const blockedUntilMs = blockedUntilMsFromData(data);
  const dayKey = typeof data.dayKey === 'string' ? data.dayKey : (data.dayKey ?? null);
  const latchOn = latchActiveFromFields(blockedUntilMs, dayKey, now)
    || (data.status === 'daily_limit' && dayKey === zohoIstDayKey(now));
  const callsToday = latchOn
    ? Number(data.callsToday ?? dailyLimit)
    : Number(data.callsToday ?? 0);
  const remaining = latchOn
    ? 0
    : Number(data.remaining ?? Math.max(0, dailyLimit - callsToday));
  const usagePct = dailyLimit > 0 ? Math.min(100, Math.round((callsToday / dailyLimit) * 100)) : 0;
  const resetSec = data.resetSec ?? null;
  const resetAt = blockedUntilMs > now
    ? new Date(blockedUntilMs).toISOString()
    : (resetSec != null ? new Date(now + resetSec * 1000).toISOString() : null);

  let status = data.status ?? deriveStatus(remaining, dailyLimit);
  if (latchOn) status = 'daily_limit';
  else if (status === 'daily_limit' && dayKey && dayKey !== zohoIstDayKey(now)) {
    status = deriveStatus(remaining > 0 ? remaining : dailyLimit, dailyLimit);
  }

  return {
    source: data.source ?? 'zoho',
    dayKey: dayKey ?? null,
    callsToday: latchOn ? callsToday : (status === 'ok' && dayKey && dayKey !== zohoIstDayKey(now) ? 0 : callsToday),
    dailyLimit,
    remaining: latchOn ? 0 : (dayKey && dayKey !== zohoIstDayKey(now) ? dailyLimit : remaining),
    usagePct: latchOn ? 100 : usagePct,
    status,
    blockedUntil: blockedUntilMs > now ? new Date(blockedUntilMs).toISOString() : null,
    windowLimit: data.windowLimit ?? null,
    windowRemaining: data.windowRemaining ?? null,
    resetSec,
    resetAt,
    retryAfterSec: data.retryAfterSec ?? null,
    userDetails: data.userDetails ?? [],
    lastError: data.lastError ?? null,
    lastRateLimitAt: data.lastRateLimitAt?.toDate?.()?.toISOString?.()
      ?? (typeof data.lastRateLimitAt === 'string' ? data.lastRateLimitAt : null),
    fetchedAt: data.fetchedAt?.toDate?.()?.toISOString?.()
      ?? (typeof data.fetchedAt === 'string' ? data.fetchedAt : null),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.()
      ?? (typeof data.updatedAt === 'string' ? data.updatedAt : null),
  };
}

/** Live org API usage from Zoho Inventory GET /apiusage. */
export async function fetchZohoOrgApiUsage(accessToken, orgId) {
  const url = new URL(`${ZOHO_API_BASE}/apiusage`);
  url.searchParams.set('organization_id', orgId);

  const res = await fetch(url.toString(), { headers: authHeaders(accessToken, orgId) });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  const headers = parseRateLimitHeaders(res);

  if (!res.ok || payload?.code !== 0) {
    const message = payload?.message || `Zoho apiusage error (${res.status}).`;
    const err = new Error(message);
    err.code = res.status === 429 || isDailyQuotaMessage(message) ? 'RATE_LIMITED' : 'ZOHO_APIUSAGE';
    throw err;
  }

  const data = payload?.data ?? {};
  const dailyLimit = Number(data.maximum_api_count ?? headers.windowLimit ?? ZOHO_DAILY_API_LIMIT);
  const callsToday = Number(data.total_api_count ?? 0);
  const remaining = Number(
    data.remaining_api_count ?? headers.windowRemaining ?? Math.max(0, dailyLimit - callsToday),
  );

  return {
    source: 'zoho',
    callsToday,
    dailyLimit,
    remaining,
    usagePct: dailyLimit > 0 ? Math.min(100, Math.round((callsToday / dailyLimit) * 100)) : 0,
    status: deriveStatus(remaining, dailyLimit),
    windowLimit: headers.windowLimit,
    windowRemaining: headers.windowRemaining,
    resetSec: headers.resetSec,
    resetAt: headers.resetSec != null ? new Date(Date.now() + headers.resetSec * 1000).toISOString() : null,
    retryAfterSec: headers.retryAfterSec,
    userDetails: normalizeUserDetails(data.user_details),
    fetchedAt: new Date().toISOString(),
    dayKey: zohoIstDayKey(),
  };
}

/** Firestore snapshot only — no Zoho call. Use before expensive daytime work. */
export async function peekZohoApiUsageCached() {
  const snap = await USAGE_REF().get();
  if (!snap.exists) {
    return formatUsageDoc({
      source: 'none',
      callsToday: 0,
      remaining: ZOHO_DAILY_API_LIMIT,
      dailyLimit: ZOHO_DAILY_API_LIMIT,
      status: 'ok',
    });
  }
  return formatUsageDoc(snap.data() || {});
}

export function zohoUsageBlocksWork(usage, minRemaining = 80) {
  if (!usage) return false;
  if (usage.status === 'daily_limit') return true;
  if (usage.blockedUntil && Date.parse(usage.blockedUntil) > Date.now()) return true;
  return Number(usage.remaining ?? 0) <= Number(minRemaining);
}

/** Throws RATE_LIMITED when the org is at/near the daily cap. */
export async function assertZohoDaytimeBudget(secrets, orgId, options = {}) {
  await assertZohoInventoryAllowed();
  const minRemaining = Number(options.minRemaining ?? 80);
  let usage = await peekZohoApiUsageCached();
  const staleMs = Date.now() - (usage.fetchedAt ? Date.parse(usage.fetchedAt) : 0);
  const cacheStale = !usage.fetchedAt || Number.isNaN(staleMs) || staleMs > 120_000;
  if (cacheStale && secrets && orgId && usage.status !== 'daily_limit' && !usage.blockedUntil) {
    try {
      usage = await getZohoApiUsageStatus(secrets, orgId);
    } catch {
      // keep cached
    }
  }
  if (zohoUsageBlocksWork(usage, minRemaining)) {
    throw zohoDailyQuotaError(usage.blockedUntil);
  }
  return usage;
}

export async function getZohoApiUsageStatus(secrets, orgId, options = {}) {
  if (await isZohoDailyQuotaBlocked()) {
    return peekZohoApiUsageCached();
  }

  const snap = await USAGE_REF().get();
  const cached = snap.exists ? snap.data() : null;
  const fetchedAtMs = cached?.fetchedAt?.toDate?.()?.getTime?.() ?? 0;
  const cacheFresh = !options.forceRefresh
    && cached?.source === 'zoho'
    && Date.now() - fetchedAtMs < LIVE_CACHE_MS;

  if (cacheFresh) {
    return formatUsageDoc(cached);
  }

  try {
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, orgId);
    const live = await fetchZohoOrgApiUsage(accessToken, organizationId);
    if (live.remaining <= 0 || live.status === 'daily_limit') {
      await markZohoDailyQuotaBlocked({
        operation: 'apiusage',
        source: 'zoho-api-usage',
        lastError: 'Zoho apiusage remaining is 0.',
      });
      return peekZohoApiUsageCached();
    }
    await USAGE_REF().set({
      ...live,
      blockedUntil: null,
      lastError: null,
      fetchedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    rememberLatch(0, live.dayKey ?? zohoIstDayKey());
    return live;
  } catch (err) {
    if (err?.dailyQuota || isDailyQuotaMessage(err?.message)) {
      await markZohoDailyQuotaBlocked({
        operation: 'apiusage',
        source: 'zoho-api-usage',
        lastError: err?.message,
      });
      return peekZohoApiUsageCached();
    }
    if (cached?.source === 'zoho') {
      return formatUsageDoc({
        ...cached,
        status: err?.code === 'RATE_LIMITED' ? 'throttled' : cached.status,
        lastError: err?.message ?? String(err),
        lastRateLimitAt: err?.code === 'RATE_LIMITED'
          ? new Date().toISOString()
          : cached.lastRateLimitAt,
      });
    }
    throw err;
  }
}

export function classifyZohoHttpError(status, payload) {
  const message = payload?.message ?? '';
  if (status === 429 || isDailyQuotaMessage(message)) {
    const err = new Error(message || 'Zoho rate limit exceeded.');
    err.code = 'RATE_LIMITED';
    if (isDailyQuotaMessage(message)) err.dailyQuota = true;
    return err;
  }
  const err = new Error(message || `Zoho API error (${status}).`);
  if (payload?.code != null) err.zohoCode = payload.code;
  err.status = status;
  return err;
}

/** Optional: stash last rate-limit for debugging (does not drive the admin counter). */
export async function recordZohoApiFailure(err, options = {}) {
  if (err?.code !== 'RATE_LIMITED' && !isDailyQuotaMessage(err?.message)) return;
  if (err?.dailyQuota || isDailyQuotaMessage(err?.message)) {
    await markZohoDailyQuotaBlocked({
      operation: options.operation ?? null,
      source: options.source ?? null,
      lastError: err?.message ?? err,
    });
    return;
  }
  await USAGE_REF().set({
    lastOperation: options.operation ?? null,
    lastSource: options.source ?? null,
    lastError: String(err?.message ?? err).slice(0, 500),
    lastRateLimitAt: FieldValue.serverTimestamp(),
    status: 'throttled',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
}

export async function recordZohoApiResponse(response, options = {}) {
  if (response?.status !== 429) return;
  await USAGE_REF().set({
    lastOperation: options.operation ?? null,
    lastSource: options.source ?? null,
    lastRateLimitAt: FieldValue.serverTimestamp(),
    status: 'throttled',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
}
