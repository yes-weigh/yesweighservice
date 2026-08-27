/**
 * YesGATC → YesOne ingest. Stores certificates and RC details pushed from yesgatc.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const YESGATC_CERTIFICATES = 'yesgatcCertificates';
export const YESGATC_RC_DETAILS = 'yesgatcRcDetails';
export const YESGATC_WEBHOOK_SETTINGS_DOC = 'appSettings/yesgatcWebhook';

const MAX_BATCH = 400;
const MAX_RAW_CHARS = 700_000;

function pickStr(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = source[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function pickCertificateStatus(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.signed === true || record.isSigned === true || record.digitallySigned === true) {
    return 'signed';
  }
  const text = pickStr(record, [
    'status', 'state', 'certificateStatus', 'signStatus', 'signedStatus',
    'tag', 'message', 'signed', 'isSigned',
  ]);
  return text || null;
}

function sanitizeId(raw) {
  const text = String(raw ?? '').trim().replace(/[/\\]+/g, '_').slice(0, 700);
  return text || randomUUID();
}

function jsonSafe(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (depth > 8) return String(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => jsonSafe(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      out[key] = jsonSafe(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

function stripSecrets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  delete out.secret;
  delete out.key;
  delete out.token;
  return out;
}

function rawForStore(value) {
  const safe = jsonSafe(stripSecrets(value));
  try {
    const encoded = JSON.stringify(safe);
    if (encoded.length > MAX_RAW_CHARS) {
      return { truncated: true, preview: encoded.slice(0, 8000) };
    }
  } catch {
    return { truncated: true };
  }
  return safe;
}

function looksLikeRc(record) {
  const type = pickStr(record, ['type', 'kind', 'recordType', 'entity', 'entityType']).toLowerCase();
  if (['rc', 'rc_detail', 'rc_details', 'rcdetails', 'regional_center', 'regionalcenter', 'rc_office'].includes(type)) {
    return true;
  }
  if (['certificate', 'cert', 'stamping_certificate', 'verification_certificate'].includes(type)) {
    return false;
  }
  const keys = Object.keys(record || {}).map(key => key.toLowerCase());
  if (keys.some(key => key.includes('certificate'))) return false;
  return keys.some(key => (
    key === 'rccode'
    || key === 'rc_code'
    || key === 'rcnumber'
    || key === 'rc_number'
    || key === 'rcid'
    || key === 'regionalcenter'
    || key === 'regional_center'
    || key === 'officename'
  ));
}

function wrapArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function objectRecords(value) {
  return wrapArray(value).filter(item => item && typeof item === 'object' && !Array.isArray(item));
}

function collectRecords(body) {
  const root = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const nested = (root.data && typeof root.data === 'object' && !Array.isArray(root.data))
    ? root.data
    : {};
  const certificates = [
    ...objectRecords(root.certificates),
    ...objectRecords(root.certificate),
    ...objectRecords(root.certs),
    ...objectRecords(nested.certificates),
    ...objectRecords(nested.certificate),
  ];
  const rcDetails = [
    ...objectRecords(root.rcDetails),
    ...objectRecords(root.rc_details),
    ...objectRecords(root.rcs),
    ...objectRecords(root.rc),
    ...objectRecords(nested.rcDetails),
    ...objectRecords(nested.rc_details),
    ...objectRecords(nested.rcs),
  ];

  if (Array.isArray(body)) {
    for (const item of objectRecords(body)) {
      if (looksLikeRc(item)) rcDetails.push(item);
      else certificates.push(item);
    }
  } else if (Array.isArray(root.data)) {
    for (const item of objectRecords(root.data)) {
      if (looksLikeRc(item)) rcDetails.push(item);
      else certificates.push(item);
    }
  } else if (root && !certificates.length && !rcDetails.length) {
    const skip = new Set(['secret', 'key', 'token', 'type', 'kind']);
    const keys = Object.keys(root).filter(key => !skip.has(key));
    if (keys.length > 0) {
      if (looksLikeRc(root) || String(root.type ?? '').toLowerCase().includes('rc')) {
        rcDetails.push(root);
      } else {
        certificates.push(root);
      }
    }
  }

  const typeHint = pickStr(root, ['type', 'kind']).toLowerCase();
  if (typeHint.includes('rc') && certificates.length && !rcDetails.length) {
    rcDetails.push(...certificates.splice(0, certificates.length));
  }

  return { certificates, rcDetails };
}

function normalizeCertificate(record) {
  const certificateNumber = pickStr(record, [
    'certificateNumber', 'certificateNo', 'certificate_no', 'certNo', 'cert_no',
    'number', 'certificateId', 'certificate_id',
  ]);
  const serialNumber = pickStr(record, [
    'serialNumber', 'serial_number', 'serial', 'slNo', 'sl_no', 'machineSerial',
  ]);
  const idHint = pickStr(record, ['id', 'docId', '_id', 'uuid', 'certificateId']);
  const rc = rcFieldsFromRecord(record);
  const yesoneVisible = isYesoneIwpRc({ code: rc.code, name: rc.name, raw: record });
  return {
    certificateNumber,
    serialNumber,
    dealerName: pickStr(record, ['dealerName', 'dealer_name', 'dealer', 'customerName', 'customer']),
    dealerId: pickStr(record, ['dealerId', 'dealer_id', 'zohoCustomerId', 'customerId']) || null,
    productName: pickStr(record, ['productName', 'product_name', 'product', 'model', 'instrument', 'make']),
    sku: pickStr(record, ['sku', 'itemCode', 'item_code']) || null,
    rcCode: yesoneVisible ? YESONE_RC_CODE : (rc.code || null),
    rcName: rc.name || null,
    yesoneVisible,
    status: pickCertificateStatus(record),
    issuedAt: pickStr(record, ['issuedAt', 'issueDate', 'issued_on', 'date', 'createdAt']) || null,
    pdfUrl: pickStr(record, ['pdfUrl', 'pdf_url', 'fileUrl', 'file_url', 'url', 'certificateUrl']) || null,
    max: pickStr(record, ['max', 'Max', 'maxCapacity', 'max_capacity', 'maxKg', 'Max (kg)']),
    min: pickStr(record, ['min', 'Min', 'minCapacity', 'min_capacity', 'minG', 'Min (g)']),
    e: pickStr(record, ['e', 'E', 'eValue', 'e_value', 'eG', 'e (g)']),
    raw: rawForStore(record),
    receivedAt: FieldValue.serverTimestamp(),
    source: 'yesgatc',
    docKey: sanitizeId(idHint || certificateNumber || serialNumber || randomUUID()),
  };
}

function normalizeRc(record) {
  const code = pickStr(record, ['code', 'rcCode', 'rc_code', 'rcNumber', 'rc_number', 'rcId']);
  const name = pickStr(record, ['name', 'rcName', 'officeName', 'office_name', 'title']);
  const idHint = pickStr(record, ['id', 'docId', '_id', 'uuid', 'rcId']);
  const yesoneVisible = isYesoneIwpRc({ code, name, raw: record });
  return {
    code: yesoneVisible ? YESONE_RC_CODE : code,
    name,
    yesoneVisible,
    address: pickStr(record, ['address', 'officeAddress']) || null,
    city: pickStr(record, ['city', 'district']) || null,
    state: pickStr(record, ['state', 'region']) || null,
    pincode: pickStr(record, ['pincode', 'pin', 'zip']) || null,
    phone: pickStr(record, ['phone', 'mobile', 'contact']) || null,
    email: pickStr(record, ['email']) || null,
    status: pickStr(record, ['status']) || null,
    raw: rawForStore(record),
    receivedAt: FieldValue.serverTimestamp(),
    source: 'yesgatc',
    docKey: sanitizeId(idHint || code || name || randomUUID()),
  };
}

async function commitChunks(writes) {
  const db = getFirestore();
  let written = 0;
  for (let i = 0; i < writes.length; i += MAX_BATCH) {
    const chunk = writes.slice(i, i + MAX_BATCH);
    const batch = db.batch();
    for (const row of chunk) {
      batch.set(db.doc(row.path), row.data, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

export function readProvidedSecret(req) {
  const header = String(
    req.get?.('x-yesgatc-secret')
    || req.get?.('x-webhook-secret')
    || req.get?.('x-yesweigh-secret')
    || '',
  ).trim();
  const auth = String(req.get?.('authorization') ?? '').trim();
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const query = String(req.query?.key ?? req.query?.secret ?? '').trim();
  const bodySecret = (req.body && typeof req.body === 'object')
    ? String(req.body.secret ?? req.body.key ?? '').trim()
    : '';
  return header || bearer || query || bodySecret;
}

export async function loadWebhookSecret() {
  const snap = await getFirestore().doc(YESGATC_WEBHOOK_SETTINGS_DOC).get();
  return String(snap.data()?.secret ?? '').trim();
}

export async function handleYesgatcPush(body) {
  const { certificates, rcDetails } = collectRecords(body);
  const writes = [
    ...certificates.map(record => {
      const data = normalizeCertificate(record);
      const { docKey, ...rest } = data;
      return { path: `${YESGATC_CERTIFICATES}/${docKey}`, data: rest };
    }),
    ...rcDetails.map(record => {
      const data = normalizeRc(record);
      const { docKey, ...rest } = data;
      return { path: `${YESGATC_RC_DETAILS}/${docKey}`, data: rest };
    }),
  ];
  const written = await commitChunks(writes);
  return {
    ok: true,
    certificates: certificates.length,
    rcDetails: rcDetails.length,
    written,
  };
}

export function applyCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-YesGatc-Secret, X-Webhook-Secret');
}

const DEST_URL = 'https://yesweigh-service.web.app/webhooks/yesgatc';
export const YESONE_RC_CODE = 'IWP';
export const YESONE_RC_NAME = 'INTERWEIGHING PVT LTD';

function normCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function rcFieldsFromRecord(record) {
  if (!record || typeof record !== 'object') return { code: '', name: '' };
  const nested = [record.rcOffice, record.regionalCenter, record.rcDetail, record.rc_office]
    .find(item => item && typeof item === 'object' && !Array.isArray(item));
  const rcObject = (record.rc && typeof record.rc === 'object' && !Array.isArray(record.rc))
    ? record.rc
    : null;
  const code = pickStr(record, [
    'rcCode', 'rc_code', 'rcNumber', 'rc_number', 'rcId', 'officeCode', 'rcOfficeCode',
  ]) || (typeof record.rc === 'string' ? String(record.rc).trim() : '')
    || pickStr(rcObject, ['code', 'rcCode', 'id'])
    || pickStr(nested, ['code', 'rcCode', 'id']);
  const name = pickStr(record, [
    'rcName', 'rc_name', 'officeName', 'rcOfficeName', 'regionalCenterName',
  ]) || pickStr(rcObject, ['name', 'rcName', 'title'])
    || pickStr(nested, ['name', 'rcName', 'title']);
  return { code, name };
}

export function isYesoneIwpRc({ code, name, raw } = {}) {
  if (isIwpCode(code) || isIwpName(name)) return true;
  if (raw && typeof raw === 'object') {
    const nested = rcFieldsFromRecord(raw);
    if (isIwpCode(nested.code) || isIwpName(nested.name)) return true;
    if (isIwpName(pickStr(raw, ['issuedBy', 'issued_by', 'office', 'rcOfficeName']))) return true;
  }
  return false;
}

function isIwpCode(value) {
  const code = normCode(value);
  return code === YESONE_RC_CODE || code.startsWith(`${YESONE_RC_CODE}/`) || code.startsWith(`${YESONE_RC_CODE}-`);
}

function isIwpName(value) {
  const compact = normName(value).replace(/[\s\-_]/g, '');
  return compact === 'INTERWEIGHINGPVTLTD' || compact.includes('INTERWEIGHING');
}

function webhookSettingsFromSecret(secret) {
  return {
    secret,
    destinationUrl: DEST_URL,
    pasteUrl: `${DEST_URL}?key=${encodeURIComponent(secret)}`,
  };
}

function isoFromAdmin(value) {
  if (value == null) return null;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  const text = String(value).trim();
  return text || null;
}

export async function ensureWebhookSettings(actorName, { rotate = false } = {}) {
  const ref = getFirestore().doc(YESGATC_WEBHOOK_SETTINGS_DOC);
  const snap = await ref.get();
  const existing = String(snap.data()?.secret ?? '').trim();
  if (existing && !rotate) return webhookSettingsFromSecret(existing);
  const secret = randomBytes(24).toString('hex');
  await ref.set({
    secret,
    destinationUrl: DEST_URL,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorName || 'YESWEIGH',
  }, { merge: true });
  return webhookSettingsFromSecret(secret);
}

function mapCertificateDoc(row) {
  const data = row.data() || {};
  return {
    id: row.id,
    certificateNumber: String(data.certificateNumber ?? ''),
    serialNumber: String(data.serialNumber ?? ''),
    dealerName: String(data.dealerName ?? ''),
    dealerId: data.dealerId != null ? String(data.dealerId) : null,
    productName: String(data.productName ?? ''),
    sku: data.sku != null ? String(data.sku) : null,
    rcCode: data.rcCode != null ? String(data.rcCode) : null,
    rcName: data.rcName != null ? String(data.rcName) : null,
    yesoneVisible: data.yesoneVisible === true,
    status: data.status != null
      ? String(data.status)
      : (data.signed === true || data.isSigned === true ? 'signed' : null),
    issuedAt: data.issuedAt != null ? String(data.issuedAt) : null,
    pdfUrl: data.pdfUrl != null ? String(data.pdfUrl) : null,
    max: data.max != null ? String(data.max) : '',
    min: data.min != null ? String(data.min) : '',
    e: data.e != null ? String(data.e) : '',
    receivedAt: isoFromAdmin(data.receivedAt),
    raw: data.raw ?? null,
  };
}

function mapRcDoc(row) {
  const data = row.data() || {};
  const code = String(data.code ?? '');
  const name = String(data.name ?? '')
    || (isIwpCode(code) || isIwpName(data.name) ? YESONE_RC_NAME : '');
  return {
    id: row.id,
    code,
    name,
    yesoneVisible: data.yesoneVisible === true,
    address: data.address != null ? String(data.address) : null,
    city: data.city != null ? String(data.city) : null,
    state: data.state != null ? String(data.state) : null,
    pincode: data.pincode != null ? String(data.pincode) : null,
    phone: data.phone != null ? String(data.phone) : null,
    email: data.email != null ? String(data.email) : null,
    status: data.status != null ? String(data.status) : null,
    receivedAt: isoFromAdmin(data.receivedAt),
    raw: data.raw ?? null,
  };
}

async function paginateQuery(queryBase, pageSize = 500) {
  const docs = [];
  let last = null;
  for (;;) {
    let q = queryBase.limit(pageSize);
    if (last) q = queryBase.startAfter(last).limit(pageSize);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    if (snap.size < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}

async function listCollection(name, mapFn, max = 400) {
  const col = getFirestore().collection(name);
  try {
    const snap = await col.orderBy('receivedAt', 'desc').limit(max).get();
    return snap.docs.map(mapFn);
  } catch {
    const snap = await col.limit(max).get();
    return snap.docs.map(mapFn);
  }
}

function publicCertificateRow(row) {
  const { raw, ...rest } = row;
  return rest;
}

export function isYesoneIwpCertificateRow(row) {
  return isYesoneIwpRc({
    code: row?.rcCode ?? row?.code,
    name: row?.rcName ?? row?.name,
    raw: row?.raw,
  });
}

export async function listCertificatesForOps(max = 10000, filter = {}) {
  const cap = Math.min(20000, Math.max(1, Number(max) || 10000));
  const wanted = String(filter.rcCode ?? YESONE_RC_CODE).trim().toUpperCase() || YESONE_RC_CODE;
  const isIwp = wanted === YESONE_RC_CODE;
  const col = getFirestore().collection(YESGATC_CERTIFICATES);
  const seen = new Set();
  const out = [];

  const matches = (row) => {
    if (isIwp) return isYesoneIwpCertificateRow(row);
    return String(row.rcCode ?? '').trim().toUpperCase() === wanted;
  };

  const take = (docs) => {
    for (const doc of docs) {
      if (seen.has(doc.id) || out.length >= cap) continue;
      const row = mapCertificateDoc(doc);
      if (!matches(row)) continue;
      seen.add(doc.id);
      out.push(publicCertificateRow(row));
    }
  };

  const queries = isIwp
    ? [col.where('yesoneVisible', '==', true), col.where('rcCode', '==', YESONE_RC_CODE)]
    : [col.where('rcCode', '==', wanted)];

  for (const queryBase of queries) {
    try {
      take(await paginateQuery(queryBase));
    } catch {
      // Missing index or field — fall through to the full scan.
    }
    if (out.length >= cap) return out;
  }

  if (out.length === 0) {
    try {
      take(await paginateQuery(col.orderBy('receivedAt', 'desc')));
    } catch {
      take(await paginateQuery(col));
    }
  }
  return out;
}

export async function listRcDetailsForOps(max = 400) {
  const cap = Math.min(500, Math.max(1, Number(max) || 400));
  const pool = await listCollection(YESGATC_RC_DETAILS, mapRcDoc, cap);
  return pool.sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')));
}
