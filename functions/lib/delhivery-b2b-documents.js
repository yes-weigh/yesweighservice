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

import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
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
 * Label print URLs embed Master / child AWBs:
 *   /label/print/a4/{MWB}?box_index=1&…
 * Prefer box_index=1 as Master AWB (portal MWB).
 *
 * @param {unknown} urls
 * @param {string} [lrn]
 * @returns {{ masterAwb: string | null, waybills: string[] }}
 */
export function extractMasterAwbFromLabelUrls(urls, lrn = '') {
  const lrnDigits = normalizeLrn(lrn);
  const list = Array.isArray(urls) ? urls.map(u => String(u || '').trim()).filter(Boolean) : [];
  /** @type {{ awb: string, boxIndex: number | null }[]} */
  const parsed = [];
  for (const url of list) {
    const awbMatch = /\/label\/print\/[^/]+\/(\d{12,})(?:\?|$)/i.exec(url)
      || /\/(\d{12,})(?:\?|$)/.exec(url);
    const awb = awbMatch?.[1] || '';
    if (!awb || awb === lrnDigits) continue;
    const boxRaw = /[?&]box_index=(\d+)/i.exec(url)?.[1];
    const boxIndex = boxRaw != null ? Number(boxRaw) : null;
    parsed.push({ awb, boxIndex: Number.isFinite(boxIndex) ? boxIndex : null });
  }
  const waybills = [...new Set(parsed.map(item => item.awb))];
  const box1 = parsed.find(item => item.boxIndex === 1);
  return {
    masterAwb: box1?.awb || waybills[0] || null,
    waybills,
  };
}

/**
 * Resolve Master AWB for an LRN via LTL label URL list (lightweight; no image download).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} lrn
 * @param {'std' | 'md' | 'sm' | 'a4'} [size]
 */
export async function resolveDelhiveryMasterAwbFromLrn(db, lrn, size = 'a4') {
  const id = normalizeLrn(lrn);
  if (!id) {
    return { masterAwb: null, waybills: [], urls: [], error: 'LRN is required.' };
  }
  const labelSize = ['std', 'md', 'sm', 'a4'].includes(String(size)) ? String(size) : 'a4';
  try {
    const listRes = await ltlGet(db, `/label/get_urls/${labelSize}/${id}`);
    let listJson = null;
    try {
      listJson = JSON.parse(listRes.buf.toString('utf8'));
    } catch {
      listJson = null;
    }
    if (!listRes.res.ok || listJson?.success === false) {
      const message = listJson?.error?.message || listJson?.message || `Label URLs failed (${listRes.res.status})`;
      return { masterAwb: null, waybills: [], urls: [], error: String(message) };
    }
    const urls = Array.isArray(listJson?.data)
      ? listJson.data.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const extracted = extractMasterAwbFromLabelUrls(urls, id);
    return {
      masterAwb: extracted.masterAwb,
      waybills: extracted.waybills,
      urls,
      error: extracted.masterAwb ? null : 'No Master AWB in label URLs yet.',
    };
  } catch (err) {
    return {
      masterAwb: null,
      waybills: [],
      urls: [],
      error: err?.message || 'Could not resolve Master AWB.',
    };
  }
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
  /** @type {object | null} */
  let bookingDocs = null;
  let bookingStatus = '';

  if (bookingId) {
    const snap = await db.collection('logisticsBookings').doc(bookingId).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Shipment not found.');
    }
    const data = snap.data() || {};
    if (!lrn) lrn = normalizeLrn(data.consignmentNo || data.trackingNo);
    bookingDocs = data.delhiveryDocuments && typeof data.delhiveryDocuments === 'object'
      ? data.delhiveryDocuments
      : null;
    bookingStatus = String(data.status || '');
  }
  if (!lrn) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }

  const cacheMatchesLrn = Boolean(bookingDocs && normalizeLrn(bookingDocs.lrn) === lrn);
  const cachedPod = cacheMatchesLrn
    && Array.isArray(bookingDocs.pod?.storagePaths)
    && bookingDocs.pod.storagePaths.length > 0;
  const cachedCod = cacheMatchesLrn && Boolean(String(bookingDocs.cod?.storagePath || '').trim());

  /** @type {Array<{ id: string, label: string, kind: string, urls?: string[], note?: string }>} */
  const documents = [
    {
      id: 'lr_copy',
      label: 'LR copy',
      kind: 'lr_copy',
      note: cacheMatchesLrn && bookingDocs.lrCopy?.storagePath
        ? 'Cached on Firebase'
        : 'Official Delhivery shipper / accounts copy PDF',
    },
    {
      id: 'shipping_label',
      label: 'Shipping label',
      kind: 'shipping_label',
      note: cacheMatchesLrn && bookingDocs.shippingLabels?.images?.length
        ? 'Cached on Firebase'
        : 'Official Delhivery box labels',
    },
  ];

  /** @type {Array<{ id: string, reason: string }>} */
  const skipped = [];

  if (cachedPod) {
    documents.push({
      id: 'pod',
      label: 'Proof of delivery (POD)',
      kind: 'pod',
      note: 'Cached on Firebase',
    });
  } else if (bookingStatus === 'delivered') {
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
  } else {
    skipped.push({ id: 'pod', reason: 'POD not ready yet (usually after delivery)' });
  }

  if (cachedCod) {
    documents.push({
      id: 'cod',
      label: 'COD document',
      kind: 'cod',
      note: 'Cached on Firebase',
    });
  } else if (bookingStatus === 'delivered') {
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
  }

  return {
    lrn,
    documents,
    skipped,
  };
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

/**
 * @param {string} storagePath
 */
async function durableReadUrl(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('not-found', 'Cached Delhivery document not found.');
  }
  const [metadata] = await file.getMetadata();
  let token = metadata?.metadata?.firebaseStorageDownloadTokens;
  if (Array.isArray(token)) token = token[0];
  if (typeof token === 'string' && token.includes(',')) {
    token = token.split(',')[0].trim();
  }
  if (!token) {
    token = randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata.metadata || {}),
        firebaseStorageDownloadTokens: token,
      },
    });
  }
  return firebaseDownloadUrl(bucket.name, storagePath, token);
}

/**
 * @param {string} storagePath
 * @param {Buffer} buffer
 * @param {string} contentType
 */
async function saveDocBuffer(storagePath, buffer, contentType) {
  const token = randomUUID();
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: contentType || 'application/octet-stream',
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });
  return firebaseDownloadUrl(bucket.name, storagePath, token);
}

/**
 * @param {string} storagePath
 */
async function readDocBuffer(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata?.contentType || 'application/octet-stream');
  const url = await durableReadUrl(storagePath);
  return { buf, contentType, url };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} bookingId
 * @param {string} lrn
 */
async function loadBookingDocCache(db, bookingId, lrn) {
  const id = String(bookingId || '').trim();
  if (!id) return null;
  const ref = db.collection('logisticsBookings').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Shipment not found.');
  }
  const data = snap.data() || {};
  const bookingLrn = normalizeLrn(data.consignmentNo || data.trackingNo);
  const requested = normalizeLrn(lrn);
  if (requested && bookingLrn && requested !== bookingLrn) {
    throw new HttpsError('invalid-argument', 'LRN does not match this shipment.');
  }
  const resolvedLrn = requested || bookingLrn;
  if (!resolvedLrn) {
    throw new HttpsError('invalid-argument', 'LRN is required.');
  }
  const docs = data.delhiveryDocuments && typeof data.delhiveryDocuments === 'object'
    ? data.delhiveryDocuments
    : null;
  const cache = docs && normalizeLrn(docs.lrn) === resolvedLrn ? docs : null;
  return { ref, data, lrn: resolvedLrn, cache };
}

/**
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {object | null} previous
 * @param {string} lrn
 * @param {Record<string, unknown>} patch
 */
async function mergeDelhiveryDocuments(ref, previous, lrn, patch) {
  const next = {
    ...(previous && normalizeLrn(previous.lrn) === lrn ? previous : {}),
    lrn,
    ...patch,
  };
  await ref.set({
    delhiveryDocuments: next,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return next;
}

/**
 * Get-or-fetch LR copy PDF; caches under logistics/{bookingId}/delhivery-lr-copy/.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ bookingId?: string, lrn?: string, lrCopyType?: string }} input
 */
export async function ensureDelhiveryLrCopy(db, input = {}) {
  const bookingId = String(input.bookingId || '').trim();
  const lrCopyType = String(input.lrCopyType || 'all').trim() || 'all';
  if (!bookingId) {
    return fetchDelhiveryLrCopy(db, input.lrn, lrCopyType);
  }

  const loaded = await loadBookingDocCache(db, bookingId, input.lrn);
  const cachedPath = String(loaded.cache?.lrCopy?.storagePath || '').trim();
  if (cachedPath) {
    const cached = await readDocBuffer(cachedPath);
    if (cached?.buf?.length) {
      return {
        available: true,
        contentType: cached.contentType || loaded.cache.lrCopy.contentType || 'application/pdf',
        base64: cached.buf.toString('base64'),
        fileName: loaded.cache.lrCopy.fileName || `${loaded.lrn}-lr-copy.pdf`,
        url: cached.url,
        cached: true,
        error: null,
      };
    }
  }

  const fresh = await fetchDelhiveryLrCopy(db, loaded.lrn, lrCopyType);
  if (!fresh.available || !fresh.base64) return { ...fresh, url: null, cached: false };

  const fileName = fresh.fileName || `${loaded.lrn}-lr-copy.pdf`;
  const storagePath = `logistics/${bookingId}/delhivery-lr-copy/${fileName}`;
  const buffer = Buffer.from(fresh.base64, 'base64');
  const url = await saveDocBuffer(storagePath, buffer, fresh.contentType || 'application/pdf');
  await mergeDelhiveryDocuments(loaded.ref, loaded.cache, loaded.lrn, {
    lrCopy: {
      storagePath,
      contentType: fresh.contentType || 'application/pdf',
      fileName,
      cachedAt: new Date().toISOString(),
    },
  });
  return { ...fresh, fileName, url, cached: false };
}

/**
 * Get-or-fetch shipping label images; caches under logistics/{bookingId}/delhivery-shipping-label/.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ bookingId?: string, lrn?: string, size?: string }} input
 */
export async function ensureDelhiveryShippingLabels(db, input = {}) {
  const bookingId = String(input.bookingId || '').trim();
  const size = ['std', 'md', 'sm', 'a4'].includes(String(input.size || '').toLowerCase())
    ? String(input.size).toLowerCase()
    : 'a4';
  if (!bookingId) {
    return fetchDelhiveryShippingLabels(db, input.lrn, size);
  }

  const loaded = await loadBookingDocCache(db, bookingId, input.lrn);
  const cached = loaded.cache?.shippingLabels;
  if (
    cached
    && String(cached.size || 'a4') === size
    && Array.isArray(cached.images)
    && cached.images.length
  ) {
    /** @type {Array<{ contentType: string, base64: string, fileName: string, url: string }>} */
    const images = [];
    for (const image of cached.images) {
      const path = String(image?.storagePath || '').trim();
      if (!path) continue;
      try {
        const url = await durableReadUrl(path);
        images.push({
          contentType: image.contentType || 'image/png',
          base64: '',
          fileName: image.fileName || `${loaded.lrn}-label.png`,
          url,
        });
      } catch {
        // Missing file — fall through to refetch.
      }
    }
    if (images.length) {
      return {
        available: true,
        images,
        urls: images.map(image => image.url),
        cached: true,
        error: null,
      };
    }
  }

  const fresh = await fetchDelhiveryShippingLabels(db, loaded.lrn, size);
  if (!fresh.available || !fresh.images?.length) {
    return { ...fresh, urls: [], cached: false };
  }

  /** @type {Array<{ storagePath: string, contentType: string, fileName: string }>} */
  const metaImages = [];
  /** @type {Array<{ contentType: string, base64: string, fileName: string, url: string }>} */
  const images = [];
  for (let i = 0; i < fresh.images.length; i += 1) {
    const image = fresh.images[i];
    const fileName = image.fileName || `${loaded.lrn}-label-${size}-${i + 1}.png`;
    const storagePath = `logistics/${bookingId}/delhivery-shipping-label/${fileName}`;
    const buffer = Buffer.from(image.base64, 'base64');
    const url = await saveDocBuffer(storagePath, buffer, image.contentType || 'image/png');
    metaImages.push({
      storagePath,
      contentType: image.contentType || 'image/png',
      fileName,
    });
    images.push({
      contentType: image.contentType || 'image/png',
      base64: image.base64,
      fileName,
      url,
    });
  }

  await mergeDelhiveryDocuments(loaded.ref, loaded.cache, loaded.lrn, {
    shippingLabels: {
      size,
      images: metaImages,
      cachedAt: new Date().toISOString(),
    },
  });

  return {
    available: true,
    images,
    urls: images.map(image => image.url),
    cached: false,
    error: null,
  };
}

/**
 * @param {string} url
 * @returns {Promise<{ buf: Buffer, contentType: string } | null>}
 */
async function downloadRemoteImage(url) {
  const href = String(url || '').trim();
  if (!href) return null;
  try {
    const res = await fetch(href, { method: 'GET' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf[0] === 0x7b) return null;
    return {
      buf,
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  } catch {
    return null;
  }
}

/**
 * Get-or-fetch POD images; caches under logistics/{bookingId}/delhivery-pod/.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ bookingId?: string, lrn?: string }} input
 */
export async function ensureDelhiveryPod(db, input = {}) {
  const bookingId = String(input.bookingId || '').trim();
  if (!bookingId) {
    return fetchDelhiveryPodUrls(db, input.lrn);
  }

  const loaded = await loadBookingDocCache(db, bookingId, input.lrn);
  const cachedPaths = Array.isArray(loaded.cache?.pod?.storagePaths)
    ? loaded.cache.pod.storagePaths.map(path => String(path || '').trim()).filter(Boolean)
    : [];
  if (cachedPaths.length) {
    const urls = [];
    for (const path of cachedPaths) {
      try {
        urls.push(await durableReadUrl(path));
      } catch {
        // Ignore missing files and refetch below.
      }
    }
    if (urls.length) {
      return { available: true, urls, cached: true, error: null };
    }
  }

  const pod = await fetchDelhiveryPodUrls(db, loaded.lrn);
  /** @type {Array<{ buf: Buffer, contentType: string }>} */
  const downloaded = [];
  for (const url of pod.urls || []) {
    const file = await downloadRemoteImage(url);
    if (file) downloaded.push(file);
  }
  if (!downloaded.length) {
    const image = await fetchDelhiveryDocumentImage(db, loaded.lrn, 'POD');
    if (image.available && image.base64) {
      downloaded.push({
        buf: Buffer.from(image.base64, 'base64'),
        contentType: image.contentType || 'image/jpeg',
      });
    }
  }
  if (!downloaded.length) {
    return {
      available: false,
      urls: [],
      cached: false,
      error: pod.error || 'POD is not available yet for this shipment.',
    };
  }

  const storagePaths = [];
  const urls = [];
  for (let i = 0; i < downloaded.length; i += 1) {
    const file = downloaded[i];
    const ext = /png/i.test(file.contentType) ? 'png' : 'jpg';
    const fileName = `${loaded.lrn}-pod-${i + 1}.${ext}`;
    const storagePath = `logistics/${bookingId}/delhivery-pod/${fileName}`;
    const url = await saveDocBuffer(storagePath, file.buf, file.contentType);
    storagePaths.push(storagePath);
    urls.push(url);
  }

  await mergeDelhiveryDocuments(loaded.ref, loaded.cache, loaded.lrn, {
    pod: {
      storagePaths,
      cachedAt: new Date().toISOString(),
    },
  });

  return { available: true, urls, cached: false, error: null };
}

/**
 * Get-or-fetch COD image; caches under logistics/{bookingId}/delhivery-cod/.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ bookingId?: string, lrn?: string, docType?: 'POD' | 'COD' }} input
 */
export async function ensureDelhiveryDocumentImage(db, input = {}) {
  const docType = input.docType === 'COD' ? 'COD' : 'POD';
  const bookingId = String(input.bookingId || '').trim();
  if (!bookingId) {
    return fetchDelhiveryDocumentImage(db, input.lrn, docType);
  }
  if (docType === 'POD') {
    const pod = await ensureDelhiveryPod(db, input);
    if (!pod.available || !pod.urls?.length) {
      return {
        available: false,
        contentType: null,
        base64: null,
        url: null,
        cached: Boolean(pod.cached),
        error: pod.error,
      };
    }
    // Prefer first cached POD URL (client can display without base64).
    return {
      available: true,
      contentType: 'image/jpeg',
      base64: null,
      url: pod.urls[0],
      urls: pod.urls,
      cached: Boolean(pod.cached),
      error: null,
    };
  }

  const loaded = await loadBookingDocCache(db, bookingId, input.lrn);
  const cachedPath = String(loaded.cache?.cod?.storagePath || '').trim();
  if (cachedPath) {
    const cached = await readDocBuffer(cachedPath);
    if (cached?.buf?.length) {
      return {
        available: true,
        contentType: cached.contentType || loaded.cache.cod.contentType || 'image/jpeg',
        base64: cached.buf.toString('base64'),
        url: cached.url,
        cached: true,
        error: null,
      };
    }
  }

  const fresh = await fetchDelhiveryDocumentImage(db, loaded.lrn, 'COD');
  if (!fresh.available || !fresh.base64) {
    return { ...fresh, url: null, cached: false };
  }

  const fileName = `${loaded.lrn}-cod.jpg`;
  const storagePath = `logistics/${bookingId}/delhivery-cod/${fileName}`;
  const url = await saveDocBuffer(
    storagePath,
    Buffer.from(fresh.base64, 'base64'),
    fresh.contentType || 'image/jpeg',
  );
  await mergeDelhiveryDocuments(loaded.ref, loaded.cache, loaded.lrn, {
    cod: {
      storagePath,
      contentType: fresh.contentType || 'image/jpeg',
      fileName,
      cachedAt: new Date().toISOString(),
    },
  });
  return { ...fresh, url, cached: false };
}

/**
 * Whether a booking write should trigger background Delhivery doc prefetch.
 *
 * @param {Record<string, unknown> | null | undefined} before
 * @param {Record<string, unknown>} after
 * @returns {{ includePodCod: boolean, reason: string } | null}
 */
export function shouldPrefetchDelhiveryDocumentsOnWrite(before, after) {
  if (!after || String(after.partnerId || '') !== 'delhivery') return null;
  if (after.wizardStep != null && String(after.wizardStep).trim() !== '') return null;

  const lrn = normalizeLrn(after.consignmentNo || after.trackingNo);
  if (!lrn) return null;

  const beforeLrn = before ? normalizeLrn(before.consignmentNo || before.trackingNo) : '';
  const statusAfter = String(after.status || '');
  const statusBefore = before ? String(before.status || '') : '';
  const deliveredNow = statusAfter === 'delivered' && statusBefore !== 'delivered';
  const lrnChanged = lrn !== beforeLrn;
  const created = !before;

  const docs = after.delhiveryDocuments && typeof after.delhiveryDocuments === 'object'
    ? after.delhiveryDocuments
    : null;
  const cacheMatches = Boolean(docs && normalizeLrn(docs.lrn) === lrn);
  const missingLr = !cacheMatches || !String(docs?.lrCopy?.storagePath || '').trim();
  const missingLabels = !cacheMatches
    || !Array.isArray(docs?.shippingLabels?.images)
    || docs.shippingLabels.images.length === 0;
  const missingPod = statusAfter === 'delivered'
    && (!cacheMatches || !Array.isArray(docs?.pod?.storagePaths) || docs.pod.storagePaths.length === 0);
  const missingCod = statusAfter === 'delivered'
    && (!cacheMatches || !String(docs?.cod?.storagePath || '').trim());

  const needsBase = created || lrnChanged || missingLr || missingLabels;
  const needsDeliveryDocs = deliveredNow || missingPod || missingCod;
  if (!needsBase && !needsDeliveryDocs) return null;

  if (!created && !lrnChanged && !deliveredNow) {
    const lastAttempt = String(docs?.prefetchStatus?.lastAttemptAt || '').trim();
    if (lastAttempt) {
      const ms = Date.parse(lastAttempt);
      if (Number.isFinite(ms) && Date.now() - ms < 3 * 60 * 1000) {
        return null;
      }
    }
  }

  let reason = 'missing_cache';
  if (created) reason = 'created';
  else if (lrnChanged) reason = 'lrn_changed';
  else if (deliveredNow) reason = 'delivered';

  return {
    includePodCod: statusAfter === 'delivered' || deliveredNow,
    reason,
  };
}

/**
 * Prefetch Delhivery LR copy, shipping labels, and (when delivered) POD/COD into Storage
 * + `delhiveryDocuments` on the booking. Idempotent — skips docs already cached.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} bookingId
 * @param {{ includePodCod?: boolean, force?: boolean }} [options]
 */
export async function prefetchDelhiveryDocumentsForBooking(db, bookingId, options = {}) {
  const id = String(bookingId || '').trim();
  if (!id) return { skipped: true, reason: 'no_booking_id' };

  const snap = await db.collection('logisticsBookings').doc(id).get();
  if (!snap.exists) return { skipped: true, reason: 'not_found' };
  const data = snap.data() || {};

  if (String(data.partnerId || '') !== 'delhivery') {
    return { skipped: true, reason: 'not_delhivery' };
  }
  if (data.wizardStep != null && String(data.wizardStep).trim() !== '') {
    return { skipped: true, reason: 'draft' };
  }

  const lrn = normalizeLrn(data.consignmentNo || data.trackingNo);
  if (!lrn) return { skipped: true, reason: 'no_lrn' };

  const includePodCod = options.includePodCod === true || String(data.status || '') === 'delivered';
  const force = options.force === true;
  const cache = data.delhiveryDocuments && typeof data.delhiveryDocuments === 'object'
    && normalizeLrn(data.delhiveryDocuments.lrn) === lrn
    ? data.delhiveryDocuments
    : null;

  const ref = snap.ref;
  const startedAt = new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const prefetchStatus = {
    lastAttemptAt: startedAt,
    lrCopy: 'skipped',
    shippingLabels: 'skipped',
    pod: 'skipped',
    cod: 'skipped',
  };

  /** @type {Array<Promise<void>>} */
  const tasks = [];

  if (force || !String(cache?.lrCopy?.storagePath || '').trim()) {
    tasks.push((async () => {
      try {
        const result = await ensureDelhiveryLrCopy(db, {
          bookingId: id,
          lrn,
          lrCopyType: 'all',
        });
        prefetchStatus.lrCopy = result.available
          ? (result.cached ? 'cached' : 'fetched')
          : 'unavailable';
        if (result.error) prefetchStatus.lrCopyError = result.error;
      } catch (err) {
        prefetchStatus.lrCopy = 'error';
        prefetchStatus.lrCopyError = String(err?.message || err);
      }
    })());
  }

  if (
    force
    || !cache?.shippingLabels?.images?.length
    || String(cache.shippingLabels.size || 'a4') !== 'a4'
  ) {
    tasks.push((async () => {
      try {
        const result = await ensureDelhiveryShippingLabels(db, {
          bookingId: id,
          lrn,
          size: 'a4',
        });
        prefetchStatus.shippingLabels = result.available
          ? (result.cached ? 'cached' : 'fetched')
          : 'unavailable';
        if (result.error) prefetchStatus.shippingLabelsError = result.error;
      } catch (err) {
        prefetchStatus.shippingLabels = 'error';
        prefetchStatus.shippingLabelsError = String(err?.message || err);
      }
    })());
  }

  if (includePodCod) {
    if (force || !Array.isArray(cache?.pod?.storagePaths) || cache.pod.storagePaths.length === 0) {
      tasks.push((async () => {
        try {
          const result = await ensureDelhiveryPod(db, { bookingId: id, lrn });
          prefetchStatus.pod = result.available
            ? (result.cached ? 'cached' : 'fetched')
            : 'unavailable';
          if (result.error) prefetchStatus.podError = result.error;
        } catch (err) {
          prefetchStatus.pod = 'error';
          prefetchStatus.podError = String(err?.message || err);
        }
      })());
    }

    if (force || !String(cache?.cod?.storagePath || '').trim()) {
      tasks.push((async () => {
        try {
          const result = await ensureDelhiveryDocumentImage(db, {
            bookingId: id,
            lrn,
            docType: 'COD',
          });
          prefetchStatus.cod = result.available
            ? (result.cached ? 'cached' : 'fetched')
            : 'unavailable';
          if (result.error) prefetchStatus.codError = result.error;
        } catch (err) {
          prefetchStatus.cod = 'error';
          prefetchStatus.codError = String(err?.message || err);
        }
      })());
    }
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }

  prefetchStatus.completedAt = new Date().toISOString();
  await ref.set({
    delhiveryDocuments: {
      ...(cache || {}),
      lrn,
      prefetchStatus,
    },
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return { ok: true, bookingId: id, lrn, prefetchStatus };
}
