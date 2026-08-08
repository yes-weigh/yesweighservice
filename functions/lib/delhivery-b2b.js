/**
 * Delhivery B2B (cargo / LTL) auth + HTTP helpers.
 *
 * Staging: https://btob-api-dev.delhivery.com
 * Production: https://btob.api.delhivery.com
 *
 * Credentials live in appSettings/delhiveryB2bSecrets (Admin SDK only).
 * Public connection metadata lives on appSettings/logisticsSettings.delhiveryB2b.
 */

import { FieldValue } from 'firebase-admin/firestore';

export const DELHIVERY_B2B_SECRETS_DOC = 'appSettings/delhiveryB2bSecrets';
export const DELHIVERY_B2B_AUTH_DOC = 'appSettings/delhiveryB2bAuth';
export const LOGISTICS_SETTINGS_DOC = 'appSettings/logisticsSettings';

export const DELHIVERY_B2B_BASE_URLS = Object.freeze({
  staging: 'https://btob-api-dev.delhivery.com',
  production: 'https://btob.api.delhivery.com',
});

const JWT_SKEW_MS = 60_000;

/**
 * @param {unknown} raw
 * @returns {'staging' | 'production'}
 */
export function normalizeDelhiveryB2bEnv(raw) {
  return String(raw ?? '').trim().toLowerCase() === 'production'
    ? 'production'
    : 'staging';
}

/**
 * @param {'staging' | 'production'} env
 */
export function delhiveryB2bBaseUrl(env) {
  return DELHIVERY_B2B_BASE_URLS[normalizeDelhiveryB2bEnv(env)];
}

/**
 * @param {string} jwt
 * @returns {{ expMs: number | null, username: string | null, clientName: string | null, clientEmail: string | null }}
 */
export function decodeDelhiveryJwtClaims(jwt) {
  try {
    const parts = String(jwt || '').split('.');
    if (parts.length < 2) {
      return { expMs: null, username: null, clientName: null, clientEmail: null };
    }
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const expSec = Number(payload?.exp);
    return {
      expMs: Number.isFinite(expSec) ? expSec * 1000 : null,
      username: payload?.username != null ? String(payload.username) : null,
      clientName: payload?.client_name != null ? String(payload.client_name) : null,
      clientEmail: payload?.client_email != null
        ? String(payload.client_email)
        : (payload?.email != null ? String(payload.email) : null),
    };
  } catch {
    return { expMs: null, username: null, clientName: null, clientEmail: null };
  }
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
export async function loadDelhiveryB2bPublicConfig(db) {
  const snap = await db.doc(LOGISTICS_SETTINGS_DOC).get();
  const raw = snap.exists && snap.data()?.delhiveryB2b && typeof snap.data().delhiveryB2b === 'object'
    ? snap.data().delhiveryB2b
    : {};
  const secretsSnap = await db.doc(DELHIVERY_B2B_SECRETS_DOC).get();
  const secrets = secretsSnap.exists ? (secretsSnap.data() || {}) : {};
  const username = String(raw.username || secrets.username || '').trim();
  return {
    env: normalizeDelhiveryB2bEnv(raw.env),
    username,
    passwordSet: Boolean(String(secrets.password || '').trim()),
    pickupLocationBySite: {
      cochin: String(raw.pickupLocationBySite?.cochin ?? '').trim(),
      head_office: String(raw.pickupLocationBySite?.head_office ?? '').trim(),
    },
    lastTestAt: typeof raw.lastTestAt === 'string' ? raw.lastTestAt : '',
    lastTestOk: Boolean(raw.lastTestOk),
    lastTestMessage: typeof raw.lastTestMessage === 'string' ? raw.lastTestMessage : '',
    clientName: typeof raw.clientName === 'string' ? raw.clientName : '',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   username?: string,
 *   password?: string | null,
 *   env?: string,
 *   pickupLocationBySite?: { cochin?: string, head_office?: string },
 *   updatedBy?: string | null,
 * }} input
 */
export async function saveDelhiveryB2bConfig(db, input = {}) {
  const now = new Date().toISOString();
  const publicConfig = await loadDelhiveryB2bPublicConfig(db);
  const nextUsername = input.username != null
    ? String(input.username).trim()
    : publicConfig.username;
  const nextEnv = input.env != null
    ? normalizeDelhiveryB2bEnv(input.env)
    : publicConfig.env;
  const nextPickup = {
    cochin: input.pickupLocationBySite?.cochin != null
      ? String(input.pickupLocationBySite.cochin).trim()
      : publicConfig.pickupLocationBySite.cochin,
    head_office: input.pickupLocationBySite?.head_office != null
      ? String(input.pickupLocationBySite.head_office).trim()
      : publicConfig.pickupLocationBySite.head_office,
  };

  const publicPatch = {
    delhiveryB2b: {
      env: nextEnv,
      username: nextUsername,
      passwordSet: publicConfig.passwordSet,
      pickupLocationBySite: nextPickup,
      lastTestAt: publicConfig.lastTestAt || '',
      lastTestOk: publicConfig.lastTestOk,
      lastTestMessage: publicConfig.lastTestMessage || '',
      clientName: publicConfig.clientName || '',
      updatedAt: now,
      ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
    },
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };

  const secretsPatch = {
    username: nextUsername,
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };
  if (input.password != null && String(input.password).length > 0) {
    secretsPatch.password = String(input.password);
    publicPatch.delhiveryB2b.passwordSet = true;
  }

  await db.doc(LOGISTICS_SETTINGS_DOC).set(publicPatch, { merge: true });
  await db.doc(DELHIVERY_B2B_SECRETS_DOC).set(secretsPatch, { merge: true });

  // Invalidate cached JWT when credentials / env change.
  await db.doc(DELHIVERY_B2B_AUTH_DOC).set({
    jwt: FieldValue.delete(),
    expMs: FieldValue.delete(),
    env: nextEnv,
    username: nextUsername,
    clearedAt: now,
  }, { merge: true });

  return loadDelhiveryB2bPublicConfig(db);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function loadSecrets(db) {
  const snap = await db.doc(DELHIVERY_B2B_SECRETS_DOC).get();
  if (!snap.exists) {
    throw new Error('Delhivery B2B credentials are not configured.');
  }
  const data = snap.data() || {};
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  if (!username || !password) {
    throw new Error('Delhivery B2B username/password missing. Save them in Logistics Settings.');
  }
  return { username, password };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ force?: boolean }} [options]
 */
export async function loginDelhiveryB2b(db, options = {}) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  const { username, password } = await loadSecrets(db);
  const baseUrl = delhiveryB2bBaseUrl(config.env);
  const res = await fetch(`${baseUrl}/ums/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = json?.error?.message
      || json?.error
      || json?.message
      || text
      || `Delhivery login failed (${res.status})`;
    throw new Error(String(message));
  }
  const jwt = String(json?.jwt || json?.data?.jwt || '').trim();
  if (!jwt) {
    throw new Error('Delhivery login succeeded but no JWT was returned.');
  }
  const claims = decodeDelhiveryJwtClaims(jwt);
  const now = new Date().toISOString();
  await db.doc(DELHIVERY_B2B_AUTH_DOC).set({
    jwt,
    expMs: claims.expMs,
    env: config.env,
    username: claims.username || username,
    clientName: claims.clientName || '',
    clientEmail: claims.clientEmail || '',
    loggedInAt: now,
  }, { merge: true });

  if (!options.skipPublicPatch) {
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      delhiveryB2b: {
        env: config.env,
        username: claims.username || username,
        passwordSet: true,
        pickupLocationBySite: config.pickupLocationBySite,
        lastTestAt: now,
        lastTestOk: true,
        lastTestMessage: `Connected as ${claims.clientName || claims.username || username}`,
        clientName: claims.clientName || '',
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
  }

  return {
    jwt,
    env: config.env,
    baseUrl,
    username: claims.username || username,
    clientName: claims.clientName || '',
    clientEmail: claims.clientEmail || '',
    expMs: claims.expMs,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ force?: boolean }} [options]
 */
export async function getValidDelhiveryJwt(db, options = {}) {
  if (!options.force) {
    const authSnap = await db.doc(DELHIVERY_B2B_AUTH_DOC).get();
    if (authSnap.exists) {
      const data = authSnap.data() || {};
      const jwt = String(data.jwt || '').trim();
      const expMs = Number(data.expMs);
      const config = await loadDelhiveryB2bPublicConfig(db);
      const envMatch = normalizeDelhiveryB2bEnv(data.env) === config.env;
      if (
        jwt
        && envMatch
        && Number.isFinite(expMs)
        && expMs > Date.now() + JWT_SKEW_MS
      ) {
        return {
          jwt,
          env: config.env,
          baseUrl: delhiveryB2bBaseUrl(config.env),
          username: String(data.username || config.username || ''),
          clientName: String(data.clientName || config.clientName || ''),
          expMs,
        };
      }
    }
  }
  return loginDelhiveryB2b(db, { skipPublicPatch: true });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string | number | undefined | null>, forceLogin?: boolean }} [options]
 */
export async function delhiveryB2bFetch(db, path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const auth = await getValidDelhiveryJwt(db, { force: Boolean(options.forceLogin) });
  const url = new URL(
    path.startsWith('http') ? path : `${auth.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
  );
  if (options.query && typeof options.query === 'object') {
    for (const [key, value] of Object.entries(options.query)) {
      if (value == null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    Authorization: `Bearer ${auth.jwt}`,
    Accept: 'application/json',
  };
  let body;
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let res = await fetch(url, { method, headers, body });
  // One retry on auth failure with a fresh JWT.
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidDelhiveryJwt(db, { force: true });
    headers.Authorization = `Bearer ${fresh.jwt}`;
    res = await fetch(url, { method, headers, body });
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    text,
    auth,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
export async function testDelhiveryB2bConnection(db) {
  try {
    const session = await loginDelhiveryB2b(db);
    const now = new Date().toISOString();
    const message = `Connected (${session.env}) as ${session.clientName || session.username}`;
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      delhiveryB2b: {
        lastTestAt: now,
        lastTestOk: true,
        lastTestMessage: message,
        clientName: session.clientName || '',
        username: session.username,
        passwordSet: true,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
    return {
      ok: true,
      env: session.env,
      username: session.username,
      clientName: session.clientName,
      clientEmail: session.clientEmail,
      expMs: session.expMs,
      message,
    };
  } catch (err) {
    const now = new Date().toISOString();
    const message = err?.message || String(err);
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      delhiveryB2b: {
        lastTestAt: now,
        lastTestOk: false,
        lastTestMessage: message,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
    return {
      ok: false,
      message,
    };
  }
}
