/**
 * Delhivery B2B documents.
 *
 * LTL clients API (manifest JWT):
 *   GET /lr_copy/print/{lrn}              → PDF (Shipper / Recipient / all)
 *   GET /label/get_urls/{size}/{lrn}      → signed label print URLs
 *   GET /label/print/...                  → JSON { data: "data:image/png;base64,..." }
 *
 * Btob API (same JWT host family for some accounts):
 *   GET /v2/pod/{lrn}                     → POD image URLs (after delivery)
 *   GET /v2/document/POD|COD/{lrn}        → image bytes
 */

import { HttpsError } from 'firebase-functions/v2/https';
import {
  delhiveryB2bFetch,
  getValidDelhiveryJwt,
  loadDelhiveryB2bPublicConfig,
} from './delhivery-b2b.js';
import { delhiveryLtlBaseUrl } from './delhivery-freight.js';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeLrn(raw) {
  return String(raw ?? '').replace(/\D/g, '').trim();
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} path
 * @param {Record<string, string>} [extraHeaders]
 */
async function ltlGet(db, path, extraHeaders = {}) {
  const config = await loadDelhiveryB2bPublicConfig(db);
  const auth = await getValidDelhiveryJwt(db);
  const base = delhiveryLtlBaseUrl(config.env);
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = {
    Authorization: `Bearer ${auth.jwt}`,
    Accept: 'application/json,application/pdf,image/*,*/*',
    ...extraHeaders,
  };
  let res = await fetch(url, { method: 'GET', headers });
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidDelhiveryJwt(db, { force: true });
    headers.Authorization = `Bearer ${fresh.jwt}`;
    res = await fetch(url, { method: 'GET', headers });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, auth, base };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} path
 */
async function btobGet(db, path) {
  return delhiveryB2bFetch(db, path, { method: 'GET' });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} lrn
 * @returns {Promise<{ available: boolean, urls: string[], error: string | null }>}
 */
export async function fetchDelhiveryPodUrls(db, lrn) {
  const id = normalizeLrn(lrn);
  if (!id) {
    return { available: false, urls: [], error: 'LRN is required.' };
  }
  const res = await btobGet(db, `/v2/pod/${id}`);
  if (res.ok) {
    const urls = Array.isArray(res.json)
      ? res.json.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    return { available: urls.length > 0, urls, error: null };
  }
  const message = String(res.json?.error || res.text || '').trim();
  if (
    res.status === 400
    && /no data|not found|not valid/i.test(message)
  ) {
    return { available: false, urls: [], error: null };
  }
  return {
    available: false,
    urls: [],
    error: message || `POD lookup failed (${res.status})`,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} lrn
 * @param {'POD' | 'COD'} docType
 */
export async function fetchDelhiveryDocumentImage(db, lrn, docType) {
  const id = normalizeLrn(lrn);
  if (!id) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }
  const type = docType === 'COD' ? 'COD' : 'POD';
  const auth = await getValidDelhiveryJwt(db);
  const url = `${auth.baseUrl}/v2/document/${type}/${id}`;
  const headers = {
    Authorization: `Bearer ${auth.jwt}`,
    Accept: 'image/*,application/json,*/*',
  };
  let res = await fetch(url, { method: 'GET', headers });
  if (res.status === 401 || res.status === 403) {
    const fresh = await getValidDelhiveryJwt(db, { force: true });
    headers.Authorization = `Bearer ${fresh.jwt}`;
    res = await fetch(url, { method: 'GET', headers });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  if (!res.ok) {
    if (res.status === 404 || /not found|no data/i.test(text)) {
      return { available: false, contentType: null, base64: null, error: null };
    }
    throw new HttpsError(
      'internal',
      String((() => {
        try {
          return JSON.parse(text)?.error;
        } catch {
          return null;
        }
      })() || text || `${type} download failed (${res.status})`),
    );
  }
  if (buf[0] === 0x7b /* { */) {
    return { available: false, contentType: null, base64: null, error: null };
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return {
    available: true,
    contentType,
    base64: buf.toString('base64'),
    error: null,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} lrn
 * @param {string} [lrCopyType] e.g. "SHIPPER COPY" | "RECIPIENT COPY" | "all"
 */
export async function fetchDelhiveryLrCopy(db, lrn, lrCopyType = 'all') {
  const id = normalizeLrn(lrn);
  if (!id) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }
  const type = String(lrCopyType || 'all').trim() || 'all';
  const qs = type && type.toLowerCase() !== 'all'
    ? `?lr_copy_type=${encodeURIComponent(type)}`
    : '';
  const { res, buf } = await ltlGet(db, `/lr_copy/print/${id}${qs}`);
  if (!res.ok) {
    const message = (() => {
      try {
        return JSON.parse(buf.toString('utf8'))?.error?.message;
      } catch {
        return buf.toString('utf8').slice(0, 200);
      }
    })();
    if (res.status === 404 || /not found|no data|invalid/i.test(String(message || ''))) {
      return { available: false, contentType: null, base64: null, fileName: null, error: null };
    }
    throw new HttpsError('internal', String(message || `LR copy failed (${res.status})`));
  }
  if (buf[0] === 0x7b /* { */) {
    return { available: false, contentType: null, base64: null, fileName: null, error: null };
  }
  const contentType = res.headers.get('content-type') || 'application/pdf';
  const suffix = type.toLowerCase() === 'all' ? 'lr-copy' : type.toLowerCase().replace(/\s+/g, '-');
  return {
    available: true,
    contentType,
    base64: buf.toString('base64'),
    fileName: `${id}-${suffix}.pdf`,
    error: null,
  };
}

/**
 * @param {string} dataUrlOrBase64
 * @returns {{ contentType: string, base64: string } | null}
 */
function parseImagePayload(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || '').trim();
  if (!raw) return null;
  const match = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (match) {
    return { contentType: match[1], base64: match[2] };
  }
  // Assume raw base64 PNG/JPEG.
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.length > 80) {
    return { contentType: 'image/png', base64: raw.replace(/\s+/g, '') };
  }
  return null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} lrn
 * @param {'std' | 'md' | 'sm' | 'a4'} [size]
 */
export async function fetchDelhiveryShippingLabels(db, lrn, size = 'a4') {
  const id = normalizeLrn(lrn);
  if (!id) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }
  const labelSize = ['std', 'md', 'sm', 'a4'].includes(String(size)) ? String(size) : 'a4';
  const listRes = await ltlGet(db, `/label/get_urls/${labelSize}/${id}`);
  let listJson = null;
  try {
    listJson = JSON.parse(listRes.buf.toString('utf8'));
  } catch {
    listJson = null;
  }
  if (!listRes.res.ok || listJson?.success === false) {
    const message = listJson?.error?.message || listJson?.message || `Label URLs failed (${listRes.res.status})`;
    if (/not found|invalid|no data/i.test(String(message))) {
      return { available: false, images: [], error: null };
    }
    throw new HttpsError('internal', String(message));
  }
  const urls = Array.isArray(listJson?.data)
    ? listJson.data.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (!urls.length) {
    return { available: false, images: [], error: null };
  }

  /** @type {Array<{ contentType: string, base64: string, fileName: string }>} */
  const images = [];
  for (let i = 0; i < urls.length; i += 1) {
    const { res, buf } = await ltlGet(db, urls[i]);
    if (!res.ok) continue;
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('json') || buf[0] === 0x7b) {
      let json = null;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch {
        continue;
      }
      const parsed = parseImagePayload(json?.data);
      if (!parsed) continue;
      images.push({
        ...parsed,
        fileName: `${id}-label-${labelSize}-${i + 1}.png`,
      });
      continue;
    }
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      images.push({
        contentType: 'image/png',
        base64: buf.toString('base64'),
        fileName: `${id}-label-${labelSize}-${i + 1}.png`,
      });
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
      images.push({
        contentType: 'image/jpeg',
        base64: buf.toString('base64'),
        fileName: `${id}-label-${labelSize}-${i + 1}.jpg`,
      });
    }
  }

  return {
    available: images.length > 0,
    images,
    error: images.length ? null : 'Could not download Delhivery shipping label images.',
  };
}

/**
 * List Delhivery-native docs for this LR.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ lrn?: string, bookingId?: string }} input
 */
export async function listDelhiveryBookingDocuments(db, input = {}) {
  let lrn = normalizeLrn(input.lrn);
  const bookingId = String(input.bookingId || '').trim();

  if (!lrn && bookingId) {
    const snap = await db.collection('logisticsBookings').doc(bookingId).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Shipment not found.');
    }
    const data = snap.data() || {};
    lrn = normalizeLrn(data.consignmentNo || data.trackingNo);
  }
  if (!lrn) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }

  /** @type {Array<{ id: string, label: string, kind: string, urls?: string[], note?: string }>} */
  const documents = [
    {
      id: 'lr_copy',
      label: 'LR copy',
      kind: 'lr_copy',
      note: 'Official Delhivery shipper / accounts copy PDF',
    },
    {
      id: 'shipping_label',
      label: 'Shipping label',
      kind: 'shipping_label',
      note: 'Official Delhivery box labels',
    },
  ];

  /** @type {Array<{ id: string, reason: string }>} */
  const skipped = [];

  const pod = await fetchDelhiveryPodUrls(db, lrn);
  if (pod.available) {
    documents.push({
      id: 'pod',
      label: 'Proof of delivery (POD)',
      kind: 'pod',
      urls: pod.urls,
    });
  } else {
    skipped.push({ id: 'pod', reason: 'POD not ready yet (usually after delivery)' });
  }

  try {
    const auth = await getValidDelhiveryJwt(db);
    const res = await fetch(`${auth.baseUrl}/v2/document/COD/${lrn}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.jwt}`,
        Accept: 'image/*,application/json,*/*',
      },
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 100 && buf[0] !== 0x7b) {
        documents.push({
          id: 'cod',
          label: 'COD document',
          kind: 'cod',
          note: 'Available from Delhivery',
        });
      }
    }
  } catch {
    // Skip COD when probe fails.
  }

  return {
    lrn,
    documents,
    skipped,
  };
}
