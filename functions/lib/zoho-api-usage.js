import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, authHeaders, ZOHO_API_BASE } from './zoho.js';

export const ZOHO_DAILY_API_LIMIT = 10_000;
const USAGE_REF = () => getFirestore().collection('zohoMeta').doc('apiUsage');
/** Avoid hitting Zoho on every admin poll (page refreshes every 5–10s). */
const LIVE_CACHE_MS = 25_000;

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
  const dailyLimit = Number(data.dailyLimit ?? ZOHO_DAILY_API_LIMIT);
  const callsToday = Number(data.callsToday ?? 0);
  const remaining = Number(data.remaining ?? Math.max(0, dailyLimit - callsToday));
  const usagePct = dailyLimit > 0 ? Math.min(100, Math.round((callsToday / dailyLimit) * 100)) : 0;
  const resetSec = data.resetSec ?? null;
  const resetAt = resetSec != null ? new Date(Date.now() + resetSec * 1000).toISOString() : null;

  return {
    source: data.source ?? 'zoho',
    dayKey: data.dayKey ?? null,
    callsToday,
    dailyLimit,
    remaining,
    usagePct,
    status: data.status ?? deriveStatus(remaining, dailyLimit),
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
  };
}

export async function getZohoApiUsageStatus(secrets, orgId, options = {}) {
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
    await USAGE_REF().set({
      ...live,
      lastError: null,
      fetchedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return live;
  } catch (err) {
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
  return err;
}

/** Optional: stash last rate-limit for debugging (does not drive the admin counter). */
export async function recordZohoApiFailure(err, options = {}) {
  if (err?.code !== 'RATE_LIMITED' && !isDailyQuotaMessage(err?.message)) return;
  await USAGE_REF().set({
    lastOperation: options.operation ?? null,
    lastSource: options.source ?? null,
    lastError: String(err?.message ?? err).slice(0, 500),
    lastRateLimitAt: FieldValue.serverTimestamp(),
    status: isDailyQuotaMessage(err?.message) ? 'daily_limit' : 'throttled',
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
