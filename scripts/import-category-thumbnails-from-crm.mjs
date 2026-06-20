/**
 * Copy category tile images from yesweigh CRM (crm.yesweigh.in) into
 * yesweigh-service Firestore + Firebase Storage.
 *
 * Usage:
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\yesweigh-service-sa.json
 *   npm run import:category-thumbnails
 *   npm run import:category-thumbnails -- --dry-run
 *   npm run import:category-thumbnails -- --force
 *
 * Without --force, categories that already have thumbnailUrl are skipped
 * (often stale product-image fallbacks). Use --force to replace from CRM.
 */

import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const CRM_CATALOG_URL = 'https://crm.yesweigh.in/api/v1/catalog/products?limit=1';
const CRM_MEDIA_BASE = 'https://crm.yesweigh.in/api/v1/catalog/media';
const CATEGORIES_COLLECTION = 'catalogCategories';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

function normName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function mediaIdFromThumbnailUrl(url) {
  if (!url) return null;
  const match = String(url).match(/\/media-gallery\/([^/]+)/);
  return match?.[1] ?? null;
}

function hasAdminCredentials() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return Boolean(credPath && existsSync(credPath));
}

function initFirebaseAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credPath || !existsSync(credPath)) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS file not found.');
  }
  const cred = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({
    credential: cert(cred),
    projectId: cred.project_id,
    storageBucket: `${cred.project_id}.firebasestorage.app`,
  });
}

function publicStorageUrl(bucketName, storagePath) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}

function versionedPublicStorageUrl(bucketName, storagePath, version) {
  const v = encodeURIComponent(String(version));
  return `${publicStorageUrl(bucketName, storagePath)}&v=${v}`;
}

async function saveCategoryThumbnail(db, categoryId, categoryName, buffer, contentType) {
  const id = String(categoryId ?? '').trim();
  if (!id) throw new Error('categoryId is required.');

  const type = String(contentType ?? 'image/jpeg').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
  }

  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const storagePath = `catalog/categories/${id}.${ext}`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: { contentType: type, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  const now = new Date().toISOString();
  const thumbnailUrl = versionedPublicStorageUrl(bucket.name, storagePath, now);

  await db.collection(CATEGORIES_COLLECTION).doc(id).set({
    id,
    name: categoryName || 'Category',
    thumbnailUrl,
    updatedAt: now,
  }, { merge: true });

  return { thumbnailUrl };
}

async function fetchCrmCategories() {
  const res = await fetch(CRM_CATALOG_URL);
  if (!res.ok) {
    throw new Error(`CRM catalog API failed (${res.status})`);
  }
  const payload = await res.json();
  const categories = payload?.data?.categories ?? payload?.categories ?? [];
  if (!Array.isArray(categories) || !categories.length) {
    throw new Error('CRM catalog returned no categories.');
  }
  return categories;
}

async function downloadCrmThumbnail(thumbnailUrl) {
  const mediaId = mediaIdFromThumbnailUrl(thumbnailUrl);
  if (!mediaId) return null;

  const res = await fetch(`${CRM_MEDIA_BASE}/${mediaId}`);
  if (!res.ok) {
    throw new Error(`CRM media download failed (${res.status}) for ${mediaId}`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) {
    throw new Error(`Empty image for media ${mediaId}`);
  }
  return { buffer, contentType, mediaId };
}

function resolveLocalCategoryId(crmCat, byId, byName) {
  const crmId = String(crmCat.categoryId ?? crmCat.id ?? '').trim();
  const crmName = crmCat.categoryName ?? crmCat.name ?? 'Category';

  if (crmId && byId.has(crmId)) {
    return { id: crmId, name: crmName };
  }

  const nameKey = normName(crmName);
  if (nameKey && byName.has(nameKey)) {
    const local = byName.get(nameKey);
    return { id: String(local.id), name: crmName };
  }

  if (crmId) return { id: crmId, name: crmName };
  return null;
}

const crmCategories = await fetchCrmCategories();

let db = null;
let localCategories = [];
if (hasAdminCredentials()) {
  initFirebaseAdmin();
  db = getFirestore();
  const localSnap = await db.collection(CATEGORIES_COLLECTION).get();
  localCategories = localSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
} else if (!dryRun) {
  console.error(
    'Set GOOGLE_APPLICATION_CREDENTIALS to a yesweigh-service service account JSON before importing.',
  );
  process.exit(1);
} else {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — dry-run uses CRM category IDs only.\n');
}

const byId = new Map(localCategories.map(cat => [String(cat.id), cat]));
const byName = new Map(localCategories.map(cat => [normName(cat.name), cat]));

console.log(`CRM categories: ${crmCategories.length}`);
console.log(`Local catalogCategories docs: ${localCategories.length}`);
if (dryRun) console.log('DRY RUN — no writes\n');
if (!force && !dryRun) {
  console.log('Tip: existing thumbnailUrl values are kept unless you pass --force\n');
}

let imported = 0;
let skipped = 0;
let failed = 0;

for (const crmCat of crmCategories) {
  const label = crmCat.categoryName ?? crmCat.name ?? crmCat.categoryId ?? '?';
  const thumbnailUrl = crmCat.thumbnailUrl ?? null;

  if (!thumbnailUrl) {
    console.log(`  skip (no CRM thumbnail): ${label}`);
    skipped += 1;
    continue;
  }

  const target = resolveLocalCategoryId(crmCat, byId, byName);
  if (!target) {
    console.log(`  skip (no local match): ${label}`);
    skipped += 1;
    continue;
  }

  const existing = byId.get(target.id);
  if (existing?.thumbnailUrl && !force) {
    console.log(`  skip (already has thumbnail — use --force): ${label}`);
    skipped += 1;
    continue;
  }

  try {
    const image = await downloadCrmThumbnail(thumbnailUrl);
    if (!image) {
      console.log(`  skip (unparseable CRM URL): ${label}`);
      skipped += 1;
      continue;
    }

    console.log(
      `  ${dryRun ? 'would import' : 'import'}: ${label} → catalog/categories/${target.id} (${image.buffer.length} bytes)`,
    );

    if (!dryRun) {
      const result = await saveCategoryThumbnail(
        db,
        target.id,
        target.name,
        image.buffer,
        image.contentType,
      );

      if (Number.isFinite(crmCat.displayOrder)) {
        await db.collection(CATEGORIES_COLLECTION).doc(target.id).set({
          displayOrder: crmCat.displayOrder,
        }, { merge: true });
      }

      console.log(`    ✓ ${result.thumbnailUrl}`);
    }

    imported += 1;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

console.log(`\nDone — imported: ${imported}, skipped: ${skipped}, failed: ${failed}`);
if (imported === 0 && skipped > 0 && !force && !dryRun) {
  console.log('Re-run with --force to replace existing thumbnails from CRM.');
}
if (failed > 0) process.exit(1);
