import { createHmac } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export const MEEZAN_MIRROR_COLLECTIONS = [
  'catalogProducts',
  'catalogCategories',
  'catalogProductSpareMap',
  'catalogProductMedia',
  'catalogProductSupport',
];

export const MEEZAN_MIRROR_SINGLE_DOCS = [
  { collection: 'catalogMeta', id: 'sync' },
  { collection: 'appSettings', id: 'priceLevels' },
  { collection: 'appSettings', id: 'productSettings' },
];

export const MEEZAN_CATALOG_STORAGE_PREFIXES = [
  'catalog/',
  'catalogMedia/',
  'catalogSupport/',
  'productSettings/approvalPdfs/',
];

const IMAGE_COLLECTIONS = new Set([
  'catalogProducts',
  'catalogCategories',
  'catalogProductMedia',
  'catalogProductSupport',
]);

const YESWEIGH_BUCKET = 'yesweigh-service.firebasestorage.app';
const SNAPSHOT_BUDGET_MS = 480_000;

export function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'object') {
    if (typeof value.isEqual === 'function' && typeof value.path === 'string') {
      return value.path;
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      out[key] = serializeFirestoreValue(nested);
    }
    return out;
  }
  return value;
}

export function catalogDocsEqual(before, after) {
  return JSON.stringify(serializeFirestoreValue(before)) === JSON.stringify(serializeFirestoreValue(after));
}

export function isMeezanCatalogMirrorConfigured(url, secret) {
  return Boolean(String(url ?? '').trim() && String(secret ?? '').trim());
}

export function isMeezanCatalogStoragePath(storagePath) {
  const path = String(storagePath ?? '').replace(/^\/+/, '').trim();
  if (!path || path.endsWith('/')) return false;
  return MEEZAN_CATALOG_STORAGE_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function yesweighCatalogFileUrl(storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  const base = `https://firebasestorage.googleapis.com/v0/b/${YESWEIGH_BUCKET}/o/${encoded}?alt=media`;
  return token ? `${base}&token=${token}` : base;
}

export async function postMeezanCatalogWebhook(url, secret, payload) {
  const endpoint = String(url ?? '').trim();
  const key = String(secret ?? '').trim();
  if (!endpoint || !key) {
    throw new Error('Meezan catalog webhook URL or secret is not configured.');
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = Date.now();
  const signature = createHmac('sha256', key)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-meezan-catalog-signature': `t=${timestamp},v1=${signature}`,
    },
    body: rawBody,
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.message || text || `HTTP ${response.status}`;
    throw new Error(`Meezan catalog ingest failed: ${message}`);
  }
  return body;
}

export async function pushMeezanCatalogDoc(url, secret, collection, id, data) {
  const op = data == null ? 'delete' : 'upsert';
  return postMeezanCatalogWebhook(url, secret, {
    op,
    collection,
    copyFiles: true,
    docs: [{ id, data: data == null ? null : serializeFirestoreValue(data) }],
  });
}

export async function pushMeezanCatalogFile(url, secret, { storagePath, sourceUrl, contentType, deleted }) {
  if (deleted) {
    return postMeezanCatalogWebhook(url, secret, {
      op: 'file-delete',
      storagePath,
    });
  }
  return postMeezanCatalogWebhook(url, secret, {
    op: 'file',
    storagePath,
    sourceUrl,
    contentType: contentType || null,
  });
}

export async function sourceUrlForCatalogFile(storagePath) {
  const file = getStorage().bucket(YESWEIGH_BUCKET).file(storagePath);
  try {
    const [metadata] = await file.getMetadata();
    const token = metadata?.metadata?.firebaseStorageDownloadTokens;
    return yesweighCatalogFileUrl(storagePath, token);
  } catch {
    return yesweighCatalogFileUrl(storagePath);
  }
}

function chunkSizeFor(collection) {
  return IMAGE_COLLECTIONS.has(collection) ? 3 : 25;
}

export async function pushMeezanCatalogSnapshot(url, secret, options = {}) {
  const db = getFirestore();
  const started = Date.now();
  let cursor = Number(options.cursor ?? 0) || 0;
  let pushed = Number(options.pushed ?? 0) || 0;
  let step = 0;

  const jobs = [];
  for (const collection of MEEZAN_MIRROR_COLLECTIONS) {
    jobs.push({ type: 'collection', collection });
  }
  for (const item of MEEZAN_MIRROR_SINGLE_DOCS) {
    jobs.push({ type: 'doc', ...item });
  }

  for (const job of jobs) {
    if (job.type === 'collection') {
      const snap = await db.collection(job.collection).get();
      const docs = snap.docs.map(docSnap => ({
        id: docSnap.id,
        data: serializeFirestoreValue(docSnap.data()),
      }));
      const size = chunkSizeFor(job.collection);
      for (let i = 0; i < docs.length; i += size) {
        if (step++ < cursor) continue;
        if (Date.now() - started > SNAPSHOT_BUDGET_MS) {
          return { ok: true, done: false, cursor: step - 1, pushed };
        }
        const chunk = docs.slice(i, i + size);
        await postMeezanCatalogWebhook(url, secret, {
          op: 'upsert',
          collection: job.collection,
          copyFiles: true,
          docs: chunk,
        });
        pushed += chunk.length;
        cursor = step;
      }
    } else {
      if (step++ < cursor) continue;
      if (Date.now() - started > SNAPSHOT_BUDGET_MS) {
        return { ok: true, done: false, cursor: step - 1, pushed };
      }
      const snap = await db.collection(job.collection).doc(job.id).get();
      await postMeezanCatalogWebhook(url, secret, {
        op: snap.exists ? 'upsert' : 'delete',
        collection: job.collection,
        copyFiles: true,
        docs: [{ id: job.id, data: snap.exists ? serializeFirestoreValue(snap.data()) : null }],
      });
      pushed += 1;
      cursor = step;
    }
  }

  await db.collection('catalogMeta').doc('meezanMirror').set({
    lastSnapshotAt: new Date().toISOString(),
    lastSnapshotCount: pushed,
    lastSnapshotDone: true,
  }, { merge: true });

  return { ok: true, done: true, cursor, pushed };
}
