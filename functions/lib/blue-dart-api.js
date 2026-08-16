/**
 * Blue Dart APIGEE auth + waybill + tracking.
 *
 * Sandbox:  https://apigateway-sandbox.bluedart.com/in/transportation
 * Production: https://apigateway.bluedart.com/in/transportation
 *
 * Credentials live in appSettings/blueDartSecrets (Admin SDK only).
 * Public connection metadata lives on appSettings/logisticsSettings.blueDart.
 * Cached JWT lives in appSettings/blueDartAuth.
 * Profile.Api_type is S (Shipping) or T (Tracking) — not sandbox vs production.
 */

import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';

export const BLUE_DART_SECRETS_DOC = 'appSettings/blueDartSecrets';
export const BLUE_DART_AUTH_DOC = 'appSettings/blueDartAuth';
export const LOGISTICS_SETTINGS_DOC = 'appSettings/logisticsSettings';

export const BLUE_DART_BASE_URLS = Object.freeze({
  sandbox: 'https://apigateway-sandbox.bluedart.com/in/transportation',
  production: 'https://apigateway.bluedart.com/in/transportation',
});

/** GenerateWayBill ProductCode: A Apex (air), E Economy (surface), D Dart Plus (DP). */
export const BLUE_DART_PRODUCT_CODES = Object.freeze({
  bluedart_air: 'A',
  bluedart_surface: 'E',
  bluedart_domestic: 'D',
});

/**
 * PrinterLableSize is a numeric enum (string names 500 the API).
 * 0 A4S single, 1 A4T multi-copy, 2 55×30, 3 89×60.
 */
export const BLUE_DART_PRINTER_LABEL_A4S = 0;

/** Logistics thermal stock — official A4S is shrink-to-fit, no crop. */
export const BLUE_DART_LABEL_WIDTH_MM = 100;
export const BLUE_DART_LABEL_HEIGHT_MM = 150;

const JWT_SKEW_MS = 60_000;
const JWT_FALLBACK_TTL_MS = 25 * 60 * 1000;

/**
 * @param {unknown} raw
 * @returns {'sandbox' | 'production'}
 */
export function normalizeBlueDartEnv(raw) {
  return String(raw ?? '').trim().toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'production';
}

/**
 * @param {'sandbox' | 'production'} env
 */
export function blueDartBaseUrl(env) {
  return BLUE_DART_BASE_URLS[normalizeBlueDartEnv(env)];
}

/**
 * @param {unknown} partnerId
 */
export function blueDartProductCode(partnerId) {
  const id = String(partnerId ?? '').trim();
  return BLUE_DART_PRODUCT_CODES[id] || BLUE_DART_PRODUCT_CODES.bluedart_surface;
}

/**
 * @param {string} jwt
 * @returns {{ expMs: number | null }}
 */
export function decodeBlueDartJwtExp(jwt) {
  try {
    const parts = String(jwt || '').split('.');
    if (parts.length < 2) return { expMs: null };
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const expSec = Number(payload?.exp);
    return { expMs: Number.isFinite(expSec) ? expSec * 1000 : null };
  } catch {
    return { expMs: null };
  }
}

function emptyPublic() {
  return {
    env: 'production',
    loginId: '',
    customerCode: '',
    originArea: '',
    customerPincode: '',
    customerName: '',
    clientSecretSet: false,
    shippingLicenseSet: false,
    trackingLicenseSet: false,
    sandboxLicenseSet: false,
    lastTestAt: '',
    lastTestOk: false,
    lastTestMessage: '',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
export async function loadBlueDartPublicConfig(db) {
  const snap = await db.doc(LOGISTICS_SETTINGS_DOC).get();
  const raw = snap.exists && snap.data()?.blueDart && typeof snap.data().blueDart === 'object'
    ? snap.data().blueDart
    : {};
  const secretsSnap = await db.doc(BLUE_DART_SECRETS_DOC).get();
  const secrets = secretsSnap.exists ? (secretsSnap.data() || {}) : {};
  const loginId = String(raw.loginId || secrets.loginId || '').trim();
  return {
    env: normalizeBlueDartEnv(raw.env),
    loginId,
    customerCode: String(raw.customerCode || secrets.customerCode || '').trim(),
    originArea: String(raw.originArea || secrets.originArea || '').trim(),
    customerPincode: String(raw.customerPincode || secrets.customerPincode || '').trim(),
    customerName: String(raw.customerName || secrets.customerName || '').trim(),
    clientSecretSet: Boolean(String(secrets.clientSecret || '').trim()),
    shippingLicenseSet: Boolean(String(secrets.shippingLicenseKey || '').trim()),
    trackingLicenseSet: Boolean(String(secrets.trackingLicenseKey || '').trim()),
    sandboxLicenseSet: Boolean(String(secrets.sandboxLicenseKey || '').trim()),
    lastTestAt: typeof raw.lastTestAt === 'string' ? raw.lastTestAt : '',
    lastTestOk: Boolean(raw.lastTestOk),
    lastTestMessage: typeof raw.lastTestMessage === 'string' ? raw.lastTestMessage : '',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, unknown>} input
 */
export async function saveBlueDartConfig(db, input = {}) {
  const now = new Date().toISOString();
  const publicConfig = await loadBlueDartPublicConfig(db);
  const next = {
    env: input.env != null ? normalizeBlueDartEnv(input.env) : publicConfig.env,
    loginId: input.loginId != null ? String(input.loginId).trim() : publicConfig.loginId,
    customerCode: input.customerCode != null
      ? String(input.customerCode).trim()
      : publicConfig.customerCode,
    originArea: input.originArea != null
      ? String(input.originArea).trim().toUpperCase()
      : publicConfig.originArea,
    customerPincode: input.customerPincode != null
      ? String(input.customerPincode).replace(/\D/g, '').slice(0, 6)
      : publicConfig.customerPincode,
    customerName: input.customerName != null
      ? String(input.customerName).trim()
      : publicConfig.customerName,
  };

  const publicPatch = {
    blueDart: {
      ...next,
      clientSecretSet: publicConfig.clientSecretSet,
      shippingLicenseSet: publicConfig.shippingLicenseSet,
      trackingLicenseSet: publicConfig.trackingLicenseSet,
      sandboxLicenseSet: publicConfig.sandboxLicenseSet,
      lastTestAt: publicConfig.lastTestAt || '',
      lastTestOk: publicConfig.lastTestOk,
      lastTestMessage: publicConfig.lastTestMessage || '',
      updatedAt: now,
      ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
    },
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };

  const secretsPatch = {
    loginId: next.loginId,
    customerCode: next.customerCode,
    originArea: next.originArea,
    customerPincode: next.customerPincode,
    customerName: next.customerName,
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };

  const assignSecret = (field, publicFlag) => {
    if (input[field] == null || String(input[field]).length === 0) return;
    secretsPatch[field] = String(input[field]).trim();
    publicPatch.blueDart[publicFlag] = true;
  };
  if (input.clientId != null && String(input.clientId).trim()) {
    secretsPatch.clientId = String(input.clientId).trim();
  }
  assignSecret('clientSecret', 'clientSecretSet');
  assignSecret('shippingLicenseKey', 'shippingLicenseSet');
  assignSecret('trackingLicenseKey', 'trackingLicenseSet');
  assignSecret('sandboxLicenseKey', 'sandboxLicenseSet');

  await db.doc(LOGISTICS_SETTINGS_DOC).set(publicPatch, { merge: true });
  await db.doc(BLUE_DART_SECRETS_DOC).set(secretsPatch, { merge: true });
  await db.doc(BLUE_DART_AUTH_DOC).set({
    jwt: FieldValue.delete(),
    expMs: FieldValue.delete(),
    env: next.env,
    clearedAt: now,
  }, { merge: true });

  return loadBlueDartPublicConfig(db);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function loadSecrets(db) {
  const snap = await db.doc(BLUE_DART_SECRETS_DOC).get();
  if (!snap.exists) {
    throw new Error('Blue Dart credentials are not configured.');
  }
  const data = snap.data() || {};
  const clientId = String(data.clientId || '').trim();
  const clientSecret = String(data.clientSecret || '').trim();
  const loginId = String(data.loginId || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Blue Dart ClientID / ClientSecret missing. Save them in Logistics Settings.');
  }
  if (!loginId) {
    throw new Error('Blue Dart LoginID missing. Save it in Logistics Settings.');
  }
  return {
    clientId,
    clientSecret,
    loginId,
    customerCode: String(data.customerCode || '').trim(),
    originArea: String(data.originArea || '').trim(),
    customerPincode: String(data.customerPincode || '').replace(/\D/g, '').slice(0, 6),
    customerName: String(data.customerName || 'INTERWEIGHING PRIVATE LIMITED').trim(),
    shippingLicenseKey: String(data.shippingLicenseKey || '').trim(),
    trackingLicenseKey: String(data.trackingLicenseKey || '').trim(),
    sandboxLicenseKey: String(data.sandboxLicenseKey || '').trim(),
  };
}

/**
 * @param {'sandbox' | 'production'} env
 * @param {'shipping' | 'tracking'} kind
 * @param {Awaited<ReturnType<typeof loadSecrets>>} secrets
 */
function licenseFor(env, kind, secrets) {
  if (env === 'sandbox') {
    const key = secrets.sandboxLicenseKey || secrets.shippingLicenseKey;
    if (!key) throw new Error('Blue Dart sandbox license key is not configured.');
    return key;
  }
  if (kind === 'tracking') {
    const key = secrets.trackingLicenseKey || secrets.shippingLicenseKey;
    if (!key) throw new Error('Blue Dart tracking license key is not configured.');
    return key;
  }
  if (!secrets.shippingLicenseKey) {
    throw new Error('Blue Dart shipping license key is not configured.');
  }
  return secrets.shippingLicenseKey;
}

/** Profile.Api_type is Shipping (S) vs Tracking (T), not sandbox vs production. */
function apiTypeFor(kind = 'shipping') {
  return kind === 'tracking' ? 'T' : 'S';
}

function profilePayload(env, secrets, kind = 'shipping') {
  return {
    Api_type: apiTypeFor(kind),
    LicenceKey: licenseFor(env, kind, secrets),
    LoginID: secrets.loginId,
    Version: '1.3',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ skipPublicPatch?: boolean, force?: boolean }} [options]
 */
export async function loginBlueDart(db, options = {}) {
  const config = await loadBlueDartPublicConfig(db);
  const secrets = await loadSecrets(db);
  const baseUrl = blueDartBaseUrl(config.env);
  const res = await fetch(`${baseUrl}/token/v1/login`, {
    method: 'GET',
    headers: {
      ClientID: secrets.clientId,
      clientSecret: secrets.clientSecret,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const errList = json?.['error-response'];
    const message = json?.title
      || (Array.isArray(errList) ? errList[0]?.msg : null)
      || json?.message
      || text
      || `Blue Dart token failed (${res.status})`;
    throw new Error(String(message));
  }
  const jwt = String(json?.JWTToken || json?.jwtToken || json?.token || '').trim();
  if (!jwt) {
    throw new Error('Blue Dart login succeeded but no JWTToken was returned.');
  }
  const claims = decodeBlueDartJwtExp(jwt);
  const expMs = claims.expMs || (Date.now() + JWT_FALLBACK_TTL_MS);
  const now = new Date().toISOString();
  await db.doc(BLUE_DART_AUTH_DOC).set({
    jwt,
    expMs,
    env: config.env,
    loginId: secrets.loginId,
    loggedInAt: now,
  }, { merge: true });

  if (!options.skipPublicPatch) {
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      blueDart: {
        env: config.env,
        loginId: secrets.loginId,
        customerCode: secrets.customerCode,
        originArea: secrets.originArea,
        customerPincode: secrets.customerPincode,
        customerName: secrets.customerName,
        clientSecretSet: true,
        lastTestAt: now,
        lastTestOk: true,
        lastTestMessage: `JWT OK (${config.env}) as ${secrets.loginId}`,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
  }

  return {
    jwt,
    env: config.env,
    baseUrl,
    loginId: secrets.loginId,
    expMs,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ force?: boolean }} [options]
 */
export async function getValidBlueDartJwt(db, options = {}) {
  if (!options.force) {
    const authSnap = await db.doc(BLUE_DART_AUTH_DOC).get();
    if (authSnap.exists) {
      const data = authSnap.data() || {};
      const jwt = String(data.jwt || '').trim();
      const expMs = Number(data.expMs);
      const config = await loadBlueDartPublicConfig(db);
      const envMatch = normalizeBlueDartEnv(data.env) === config.env;
      if (
        jwt
        && envMatch
        && Number.isFinite(expMs)
        && expMs > Date.now() + JWT_SKEW_MS
      ) {
        return {
          jwt,
          env: config.env,
          baseUrl: blueDartBaseUrl(config.env),
          loginId: String(data.loginId || config.loginId || ''),
          expMs,
        };
      }
    }
  }
  return loginBlueDart(db, { skipPublicPatch: true });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} path
 * @param {{ method?: string, body?: unknown, forceLogin?: boolean }} [options]
 */
export async function blueDartFetch(db, path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const auth = await getValidBlueDartJwt(db, { force: Boolean(options.forceLogin) });
  const url = path.startsWith('http')
    ? path
    : `${auth.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    JWTToken: auth.jwt,
    Accept: 'application/json',
  };
  let body;
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let res = await fetch(url, { method, headers, body });
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidBlueDartJwt(db, { force: true });
    headers.JWTToken = fresh.jwt;
    res = await fetch(url, { method, headers, body });
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text, auth };
}

function firstStatusInfo(statusRows) {
  if (!Array.isArray(statusRows) || !statusRows[0]) return '';
  const row = statusRows[0];
  return String(row.StatusInformation || row.StatusCode || '').trim();
}

function blueDartErrorMessage(json, text, status, fallback) {
  const errList = json?.['error-response'];
  if (Array.isArray(errList) && errList[0]) {
    const first = errList[0];
    const msg = first.ErrorMessage
      || first.msg
      || first.StatusInformation
      || first.message
      || firstStatusInfo(first.Status);
    if (msg && String(msg).toLowerCase() !== 'bad request') return String(msg);
  }
  const result = json?.GenerateWayBillResult || json?.WayBillGenerationStatus;
  const fromResult = firstStatusInfo(result?.Status);
  if (fromResult) return fromResult;
  const title = String(json?.title || json?.message || '').trim();
  if (title && title.toLowerCase() !== 'bad request') return title;
  return String(text || `${fallback} (${status})`);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
export async function testBlueDartConnection(db) {
  try {
    const session = await loginBlueDart(db);
    const secrets = await loadSecrets(db);
    const pin = secrets.customerPincode || '682001';
    const finder = await blueDartFetch(db, '/finder/v1/GetServicesforPincode', {
      method: 'POST',
      body: {
        pinCode: pin,
        profile: profilePayload(session.env, secrets, 'shipping'),
      },
    });
    const now = new Date().toISOString();
    if (!finder.ok) {
      const message = blueDartErrorMessage(
        finder.json,
        finder.text,
        finder.status,
        'Blue Dart finder failed',
      );
      await db.doc(LOGISTICS_SETTINGS_DOC).set({
        blueDart: {
          lastTestAt: now,
          lastTestOk: false,
          lastTestMessage: message,
          updatedAt: now,
        },
        updatedAt: now,
      }, { merge: true });
      return { ok: false, env: session.env, loginId: session.loginId, message };
    }
    const message = `Connected (${session.env}) as ${session.loginId} · finder ${pin} OK`;
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      blueDart: {
        lastTestAt: now,
        lastTestOk: true,
        lastTestMessage: message,
        loginId: session.loginId,
        clientSecretSet: true,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
    return {
      ok: true,
      env: session.env,
      loginId: session.loginId,
      message,
    };
  } catch (err) {
    const now = new Date().toISOString();
    const message = err?.message || String(err);
    await db.doc(LOGISTICS_SETTINGS_DOC).set({
      blueDart: {
        lastTestAt: now,
        lastTestOk: false,
        lastTestMessage: message,
        updatedAt: now,
      },
      updatedAt: now,
    }, { merge: true });
    return { ok: false, message };
  }
}

function ynFlag(value) {
  return String(value || '').trim().toUpperCase() === 'Y';
}

function firstFinderRow(json) {
  const root = json?.GetServicesforPincodeResult
    || json?.ServiceCenterDetails
    || json?.ServiceCenterDetailsReference
    || json?.finder
    || json;
  if (Array.isArray(root)) return root[0] || null;
  if (root && typeof root === 'object') return root;
  return null;
}

/**
 * Location Finder for one or more pins (network area/hub — not account warehouses).
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} pins
 */
export async function lookupBlueDartPincodes(db, pins = []) {
  const unique = [...new Set(
    (Array.isArray(pins) ? pins : [])
      .map(pin => String(pin || '').replace(/\D/g, '').slice(0, 6))
      .filter(pin => pin.length === 6),
  )].slice(0, 8);
  if (!unique.length) {
    throw new Error('Provide at least one 6-digit pincode.');
  }
  const secrets = await loadSecrets(db);
  const config = await loadBlueDartPublicConfig(db);
  const results = [];
  for (const pin of unique) {
    const finder = await blueDartFetch(db, '/finder/v1/GetServicesforPincode', {
      method: 'POST',
      body: {
        pinCode: pin,
        profile: profilePayload(config.env, secrets, 'shipping'),
      },
    });
    const row = firstFinderRow(finder.json);
    const error = finder.ok
      ? String(row?.ErrorMessage || '').trim()
      : blueDartErrorMessage(finder.json, finder.text, finder.status, 'Finder failed');
    const isError = Boolean(row?.IsError) || !finder.ok;
    results.push({
      pin,
      ok: !isError,
      error: isError ? (error || 'Finder failed') : null,
      description: String(row?.PincodeDescription || row?.PinDescription || '').trim(),
      areaCode: String(row?.AreaCode || '').trim().toUpperCase(),
      serviceCenterCode: String(row?.ServiceCenterCode || '').trim().toUpperCase(),
      airOutbound: ynFlag(row?.ApexOutbound),
      surfaceOutbound: ynFlag(row?.GroundOutbound),
      dpOutbound: ynFlag(row?.DomesticPriorityOutbound),
    });
  }
  return {
    ok: true,
    account: {
      originArea: String(secrets.originArea || config.originArea || '').trim().toUpperCase(),
      customerPincode: String(secrets.customerPincode || config.customerPincode || '').replace(/\D/g, '').slice(0, 6),
      customerCode: String(secrets.customerCode || config.customerCode || '').trim(),
    },
    results,
  };
}

function splitAddressLines(address, maxLen = 30) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  const lines = ['', '', ''];
  if (!text) {
    lines[0] = 'Address';
    return lines;
  }
  const words = text.split(' ');
  let idx = 0;
  for (const word of words) {
    const next = lines[idx] ? `${lines[idx]} ${word}` : word;
    if (next.length <= maxLen) {
      lines[idx] = next;
    } else if (idx < 2) {
      idx += 1;
      lines[idx] = word.slice(0, maxLen);
    } else {
      lines[2] = `${lines[2]} ${word}`.trim().slice(0, maxLen);
    }
  }
  if (!lines[0]) lines[0] = text.slice(0, maxLen);
  return lines;
}

function mobile10(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function pin6(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

function nextPickupIst() {
  const ist = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
  const d = new Date(Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
    10,
    30,
    0,
    0,
  ));
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function pdfFromPrintContent(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.from(raw);
  if (typeof raw === 'string') {
    const compact = raw.replace(/\s/g, '');
    if (!compact) return null;
    return Buffer.from(compact, 'base64');
  }
  return null;
}

/**
 * Shrink official A4S onto 100×150 mm (uniform scale, centered). No crop or redraw.
 * @param {Buffer} pdfBuffer
 */
export async function fitBlueDartWaybillToLabel(pdfBuffer) {
  const src = await PDFDocument.load(pdfBuffer);
  const srcPage = src.getPage(0);
  const { width, height } = srcPage.getSize();
  const labelW = BLUE_DART_LABEL_WIDTH_MM / 25.4 * 72;
  const labelH = BLUE_DART_LABEL_HEIGHT_MM / 25.4 * 72;
  if (Math.abs(width - labelW) < 2 && Math.abs(height - labelH) < 2) {
    return Buffer.from(pdfBuffer);
  }
  const scale = Math.min(labelW / width, labelH / height);
  const dw = width * scale;
  const dh = height * scale;
  const out = await PDFDocument.create();
  const embedded = await out.embedPage(srcPage);
  const page = out.addPage([labelW, labelH]);
  page.drawPage(embedded, {
    x: (labelW - dw) / 2,
    y: (labelH - dh) / 2,
    width: dw,
    height: dh,
  });
  return Buffer.from(await out.save());
}

async function saveWaybillPdf(awb, buffer) {
  const fileName = `${awb}-100x150.pdf`;
  const storagePath = `logistics/bluedart-awb/${awb}/${fileName}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const token = randomUUID();
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: 'application/pdf',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return { storagePath, fileName, contentType: 'application/pdf' };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} storagePath
 */
export async function readBlueDartWaybillPdf(db, storagePath) {
  void db;
  const path = String(storagePath || '').trim();
  if (!path) throw new Error('Waybill storage path is missing.');
  const bucket = getStorage().bucket();
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new Error('Blue Dart waybill PDF is not in storage.');
  const [buffer] = await file.download();
  return {
    contentBase64: buffer.toString('base64'),
    contentType: 'application/pdf',
    fileName: path.split('/').pop() || 'waybill.pdf',
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{
 *   partnerId?: string,
 *   shipFromSite?: string,
 *   orderId?: string,
 *   consignee?: Record<string, unknown>,
 *   returnAddress?: Record<string, unknown> | null,
 *   boxes?: Array<Record<string, unknown>>,
 *   invoiceNumber?: string | null,
 *   invoiceValueInr?: number | null,
 *   sellerGstin?: string | null,
 *   freightBillingMode?: string | null,
 *   registerPickup?: boolean,
 * }} input
 */
export async function bookBlueDartShipment(db, input = {}) {
  const config = await loadBlueDartPublicConfig(db);
  const secrets = await loadSecrets(db);
  const partnerId = String(input.partnerId || 'bluedart_surface').trim();
  const productCode = blueDartProductCode(partnerId);
  const consignee = input.consignee && typeof input.consignee === 'object' ? input.consignee : {};
  const boxes = Array.isArray(input.boxes) ? input.boxes : [];
  const destPin = pin6(consignee.pincode);
  if (!destPin || destPin.length !== 6) {
    throw new Error('Consignee pincode (6 digits) is required for Blue Dart booking.');
  }
  const consigneeMobile = mobile10(consignee.phone);
  if (!consigneeMobile) {
    throw new Error('Consignee phone is required for Blue Dart booking.');
  }
  const shipperPin = pin6(secrets.customerPincode) || pin6(input.returnAddress?.pincode);
  if (!shipperPin) {
    throw new Error('Ship-from pincode is missing. Set Customer pincode in Blue Dart API settings.');
  }
  if (!secrets.customerCode || !secrets.originArea) {
    throw new Error('Blue Dart CustomerCode / OriginArea missing. Save them in Logistics Settings.');
  }

  const addr = splitAddressLines(consignee.address);
  const returnSrc = input.returnAddress && typeof input.returnAddress === 'object'
    ? input.returnAddress
    : {};
  const retAddr = splitAddressLines(returnSrc.address || consignee.address);
  const shipperPhone = mobile10(returnSrc.phone) || consigneeMobile;
  const dims = boxes
    .map(box => ({
      Length: Number(box.lengthCm) || 0,
      Breadth: Number(box.widthCm) || 0,
      Height: Number(box.heightCm) || 0,
      Count: Math.max(1, Number(box.quantity) || 1),
    }))
    .filter(row => row.Length > 0 && row.Breadth > 0 && row.Height > 0);
  const weightKg = boxes.reduce((sum, box) => {
    const kg = Number(box.weightKg);
    return sum + (Number.isFinite(kg) && kg > 0 ? kg : 0);
  }, 0);
  const pieceCount = Math.max(1, boxes.length || 1);
  const declared = Number(input.invoiceValueInr);
  const declaredValue = Number.isFinite(declared) && declared > 0 ? declared : 1000;
  const pickupDt = nextPickupIst();
  const pickupMs = pickupDt.getTime();
  const cref = String(input.orderId || input.invoiceNumber || '').trim() || `YW${Date.now()}`;
  const fod = String(input.freightBillingMode || '').toLowerCase() === 'fod';
  const registerPickup = input.registerPickup !== false;
  const gstin = String(consignee.gstin || '').trim().toUpperCase();
  const sellerGstin = String(input.sellerGstin || '').trim().toUpperCase();

  const payload = {
    Request: {
      Consignee: {
        ConsigneeAddress1: addr[0],
        ConsigneeAddress2: addr[1],
        ConsigneeAddress3: addr[2],
        ConsigneeAddressType: 'R',
        ConsigneeAttention: '',
        ConsigneeEmailID: String(consignee.email || ''),
        ConsigneeGSTNumber: gstin,
        ConsigneeLatitude: '',
        ConsigneeLongitude: '',
        ConsigneeMaskedContactNumber: '',
        ConsigneeMobile: consigneeMobile,
        ConsigneeName: String(consignee.name || 'Consignee').slice(0, 30),
        ConsigneePincode: destPin,
        ConsigneeTelephone: '',
      },
      Returnadds: {
        ManifestNumber: '',
        ReturnAddress1: retAddr[0],
        ReturnAddress2: retAddr[1],
        ReturnAddress3: retAddr[2],
        ReturnContact: String(returnSrc.name || secrets.customerName).slice(0, 30),
        ReturnEmailID: '',
        ReturnLatitude: '',
        ReturnLongitude: '',
        ReturnMaskedContactNumber: '',
        ReturnMobile: shipperPhone,
        ReturnPincode: shipperPin,
        ReturnTelephone: '',
      },
      Services: {
        AWBNo: '',
        ActualWeight: weightKg > 0 ? weightKg.toFixed(2) : '0.50',
        Commodity: {},
        CreditReferenceNo: cref.slice(0, 20),
        DeclaredValue: declaredValue,
        Dimensions: dims,
        ECCN: '',
        PDFOutputNotRequired: false,
        PackType: '',
        PickupDate: `/Date(${pickupMs})/`,
        PickupTime: '1600',
        PieceCount: String(pieceCount),
        ProductCode: productCode,
        ProductType: 0,
        RegisterPickup: registerPickup,
        SpecialInstruction: '',
        SubProductCode: '',
        PrinterLableSize: BLUE_DART_PRINTER_LABEL_A4S,
        itemdtl: [],
        noOfDCGiven: 0,
      },
      Shipper: {
        CustomerAddress1: retAddr[0],
        CustomerAddress2: retAddr[1],
        CustomerAddress3: retAddr[2],
        CustomerCode: secrets.customerCode,
        CustomerEmailID: '',
        CustomerGSTNumber: sellerGstin,
        CustomerLatitude: '',
        CustomerLongitude: '',
        CustomerMaskedContactNumber: '',
        CustomerMobile: shipperPhone,
        CustomerName: secrets.customerName.slice(0, 50),
        CustomerPincode: shipperPin,
        CustomerTelephone: '',
        IsToPayCustomer: fod,
        OriginArea: secrets.originArea,
        Sender: 'YESWEIGH',
        VendorCode: '',
      },
    },
    Profile: profilePayload(config.env, secrets, 'shipping'),
  };

  let res = await blueDartFetch(db, '/waybill/v1/GenerateWayBill', {
    method: 'POST',
    body: payload,
  });

  let result = res.json?.GenerateWayBillResult || res.json;
  const isError = Boolean(result?.IsError) || !res.ok;
  if (isError && registerPickup) {
    payload.Request.Services.RegisterPickup = false;
    res = await blueDartFetch(db, '/waybill/v1/GenerateWayBill', {
      method: 'POST',
      body: payload,
    });
    result = res.json?.GenerateWayBillResult || res.json;
  }

  const awb = String(result?.AWBNo || '').replace(/\D/g, '').trim();
  const failed = Boolean(result?.IsError) || !res.ok || !awb;
  if (failed) {
    throw new Error(blueDartErrorMessage(
      res.json,
      res.text,
      res.status,
      'Blue Dart waybill failed',
    ));
  }

  const officialPdf = pdfFromPrintContent(result.AWBPrintContent);
  let documents = null;
  if (officialPdf && officialPdf.length > 100) {
    let labelPdf = officialPdf;
    try {
      labelPdf = await fitBlueDartWaybillToLabel(officialPdf);
    } catch {
      labelPdf = officialPdf;
    }
    const saved = await saveWaybillPdf(awb, labelPdf);
    documents = {
      awb,
      waybill: {
        ...saved,
        cachedAt: new Date().toISOString(),
        labelSize: '100x150',
      },
    };
  }

  return {
    ok: true,
    awb,
    env: config.env,
    productCode,
    destinationArea: result.DestinationArea || null,
    destinationLocation: result.DestinationLocation || null,
    creditReferenceNo: result.CCRCRDREF || cref,
    pickupRegistered: Boolean(payload.Request.Services.RegisterPickup),
    pickupDate: `${pickupDt.getUTCFullYear()}-${String(pickupDt.getUTCMonth() + 1).padStart(2, '0')}-${String(pickupDt.getUTCDate()).padStart(2, '0')}`,
    pickupTime: '1600',
    documents,
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function scanToHistory(scan) {
  const date = String(scan?.ScanDate || scan?.Date || '').trim();
  const time = String(scan?.ScanTime || scan?.Time || '').trim();
  const at = [date, time].filter(Boolean).join(' ');
  return {
    at: at || '',
    location: String(scan?.ScannedLocation || scan?.ScanLocation || scan?.Location || '').trim(),
    activity: String(scan?.Scan || scan?.ScanCode || scan?.Status || scan?.Remarks || '').trim(),
  };
}

function shipmentFromTrackJson(json) {
  const data = json?.ShipmentData || json?.ScanDetail || json;
  const shipment = data?.Shipment || data?.shipment || data;
  const list = asArray(shipment);
  return list[0] || shipment || data || {};
}

function xmlTag(xml, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return match ? String(match[1] || '').trim() : '';
}

function parseBlueDartTrackXml(xml) {
  const error = /<Error>([^<]+)<\/Error>/i.exec(xml);
  if (error) return { error: error[1].trim() };
  const ship = /<Shipment\b([^>]*)>([\s\S]*?)<\/Shipment>/i.exec(xml);
  if (!ship) return { error: 'No shipment data.' };
  const attrs = ship[1] || '';
  const body = ship[2] || '';
  const awb = /WaybillNo="([^"]*)"/i.exec(attrs)?.[1]
    || xmlTag(body, 'WaybillNo');
  const scans = [];
  const scanRe = /<ScanDetail>([\s\S]*?)<\/ScanDetail>/gi;
  let row;
  while ((row = scanRe.exec(body))) {
    scans.push({
      Scan: xmlTag(row[1], 'Scan'),
      ScanDate: xmlTag(row[1], 'ScanDate'),
      ScanTime: xmlTag(row[1], 'ScanTime'),
      ScannedLocation: xmlTag(row[1], 'ScannedLocation'),
    });
  }
  return {
    awb: String(awb || '').replace(/\D/g, ''),
    status: xmlTag(body, 'Status'),
    statusType: xmlTag(body, 'StatusType'),
    origin: xmlTag(body, 'Origin'),
    destination: xmlTag(body, 'Destination'),
    productType: xmlTag(body, 'ProductType') || xmlTag(body, 'Service'),
    scans,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} awb
 */
export async function fetchBlueDartTrack(db, awb) {
  const id = String(awb || '').replace(/\D/g, '').trim();
  if (!id) {
    return {
      awb: '',
      ok: false,
      error: 'AWB is required.',
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl: 'https://www.bluedart.com/web/guest/trackdartplus',
      fetchedAt: new Date().toISOString(),
    };
  }
  const config = await loadBlueDartPublicConfig(db);
  const secrets = await loadSecrets(db);
  const license = licenseFor(config.env, 'tracking', secrets);
  const query = new URLSearchParams({
    handler: 'tnt',
    action: 'custawbquery',
    loginid: secrets.loginId,
    awb: 'awb',
    numbers: id,
    format: 'xml',
    lickey: license,
    verno: '1.3',
    scan: '1',
  });
  const res = await blueDartFetch(db, `/tracking/v1?${query.toString()}`, {
    method: 'GET',
  });
  const fetchedAt = new Date().toISOString();
  const sourceUrl = `https://www.bluedart.com/web/guest/trackdartplus?trackFor=0&trackNo=${id}`;
  const looksXml = /<ShipmentData|<Shipment\b|<Error>/i.test(res.text || '');
  const parsedXml = looksXml
    ? parseBlueDartTrackXml(res.text || '')
    : { error: '', awb: '', status: '', statusType: '', origin: '', destination: '', productType: '', scans: [] };
  if (looksXml && parsedXml.error && !parsedXml.awb) {
    return {
      awb: id,
      ok: false,
      error: parsedXml.error,
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl,
      fetchedAt,
    };
  }
  if (!res.ok && !parsedXml.awb && !parsedXml.status) {
    return {
      awb: id,
      ok: false,
      error: blueDartErrorMessage(res.json, res.text, res.status, 'Blue Dart tracking failed'),
      status: null,
      origin: null,
      destination: null,
      consignmentType: null,
      bookedAt: null,
      deliveredAt: null,
      history: [],
      sourceUrl,
      fetchedAt,
    };
  }

  let shipment = parsedXml.awb || parsedXml.status
    ? {
      AWBNo: parsedXml.awb,
      Status: parsedXml.status,
      StatusType: parsedXml.statusType,
      Origin: parsedXml.origin,
      Destination: parsedXml.destination,
      ProductType: parsedXml.productType,
      Scans: { ScanDetail: parsedXml.scans },
    }
    : shipmentFromTrackJson(res.json);
  const scansRaw = shipment?.Scans?.ScanDetail
    || shipment?.ScanDetail
    || shipment?.Scans
    || parsedXml.scans
    || [];
  const history = asArray(scansRaw).map(scanToHistory).filter(row => row.activity || row.location);
  const status = String(
    shipment?.Status
    || shipment?.StatusType
    || history[0]?.activity
    || '',
  ).trim() || null;
  const notFound = /no information|incorrect waybill/i.test(status || '')
    || String(shipment?.StatusType || parsedXml.statusType || '') === 'NF';
  const deliveredAt = String(shipment?.DeliveryDate || shipment?.DeliveredDate || '').trim() || (
    /\bdelivered\b/i.test(status || '') ? fetchedAt : null
  );
  return {
    awb: String(shipment?.AWBNo || parsedXml.awb || id).replace(/\D/g, '') || id,
    ok: !notFound,
    error: notFound ? (status || 'No tracking information yet.') : null,
    status: notFound ? (status || 'No tracking information yet.') : status,
    statusType: shipment?.StatusType != null
      ? String(shipment.StatusType)
      : (parsedXml.statusType || null),
    origin: shipment?.Origin != null ? String(shipment.Origin) : (parsedXml.origin || null),
    destination: shipment?.Destination != null
      ? String(shipment.Destination)
      : (parsedXml.destination || null),
    consignmentType: shipment?.ProductType != null
      ? String(shipment.ProductType)
      : (parsedXml.productType || null),
    bookedAt: shipment?.NewWaybillDate || shipment?.BookingDate || null,
    deliveredAt,
    history,
    sourceUrl,
    fetchedAt,
  };
}

export { emptyPublic as emptyBlueDartPublicConfig };
