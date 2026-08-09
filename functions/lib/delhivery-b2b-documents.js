/**
 * Delhivery B2B document helpers (POD / COD when present).
 *
 * Verified with production JWT:
 *   GET /v2/pod/{lrn}              → JSON string[] of signed image URLs (delivered only)
 *   GET /v2/document/POD/{lrn}     → JPEG bytes (delivered only)
 *   GET /v2/document/COD/{lrn}     → image when COD remittance doc exists
 *
 * Shipping label / LR copy appear in the developer portal but are not exposed
 * on btob.api under paths reachable with the B2B JWT we use for manifest/track.
 * Those are omitted until Delhivery provides working endpoints for this account.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { delhiveryB2bFetch, getValidDelhiveryJwt } from './delhivery-b2b.js';

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
  // JSON error wrapped as 200 is unlikely; treat non-image as unavailable.
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
 * List Delhivery-native docs that exist for this LR right now.
 * Stage-gated items that are not ready are omitted (not returned as errors).
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
  const documents = [];

  const pod = await fetchDelhiveryPodUrls(db, lrn);
  if (pod.available) {
    documents.push({
      id: 'pod',
      label: 'Proof of delivery (POD)',
      kind: 'pod',
      urls: pod.urls,
    });
  }

  // COD remittance image — only when Delhivery has one (rare for prepaid/FOD).
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
    /**
     * Portal lists shipping label / LR copy / generate document APIs, but they
     * are not callable with this account’s B2B JWT yet — omitted on purpose.
     */
    skipped: [
      { id: 'shipping_label_api', reason: 'Delhivery shipping-label API not available for this account JWT' },
      { id: 'lr_copy_api', reason: 'Delhivery LR-copy API not available for this account JWT' },
      ...(pod.available ? [] : [{ id: 'pod', reason: 'POD not ready yet (usually after delivery)' }]),
    ],
  };
}
