import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { isCatalogSyncWindow } from './lib/business-hours.js';
import {
  getAccessToken,
  resolveOrganizationId,
  fetchProductDetail,
  moveProductToCategory,
} from './lib/zoho.js';
import {
  syncCatalogToFirestore,
  readCatalogFromFirestore,
  patchProductCategory,
  saveCategoryOrder,
  uploadCategoryThumbnail,
  uploadProductImage,
} from './lib/catalog-sync.js';
import {
  getLinkedSparesForProduct,
  getLinkedProductsForSpare,
  saveProductSpareMap,
  saveSpareProductMap,
} from './lib/spare-links.js';
import { deleteManagedUserAccount } from './lib/user-delete.js';
import { syncCustomersToFirestore } from './lib/zoho-customers.js';
import {
  listDealers,
  exportDealersCsv,
  getDealerStatsSummary,
  getDealerLocationsSummary,
  getDealerRecord,
  patchDealerRecord,
  linkDealerPortalUser,
  refreshDealerZohoRecord,
  pushDealerToZohoRecord,
  readDealerSetting,
  writeDealerSetting,
} from './lib/dealers-api.js';
import {
  importCrmDealerOverlay,
  backfillDealerLocations,
} from './lib/dealer-legacy-import.js';
import {
  listDealerInvoices,
  getDealerInvoiceDashboard as buildDealerInvoiceDashboard,
  getDealerInvoiceDetail as fetchDealerInvoiceDetail,
  downloadDealerInvoiceDocument as fetchDealerInvoiceDocument,
  downloadAdminInvoiceDocument as fetchAdminInvoiceDocument,
  resolveZohoCustomerIdForUser,
} from './lib/zoho-invoices.js';
import {
  syncInvoicesToFirestore,
  verifyZohoWebhookSignature,
  handleZohoInvoiceWebhook,
} from './lib/invoice-sync.js';
import {
  getOrgInvoiceSyncStatus,
  countOrgInvoicesInRange,
  syncOrgInvoicesToFirestore,
} from './lib/org-invoice-sync.js';
import { getZohoApiUsageStatus } from './lib/zoho-api-usage.js';
import { lookupPincodeLocation } from './lib/location-utils.js';
import {
  normalizePhone10,
  lookupDealerForLogin,
  sendDealerLoginOtp as dispatchDealerLoginOtp,
  verifyDealerLoginOtp as validateDealerLoginOtp,
  completeDealerSignup as finalizeDealerSignup,
} from './lib/dealer-otp.js';
import { prepareSupportAttachmentUpload } from './lib/support-attachments.js';
import { getHrStaffFileUrl, uploadHrStaffFile } from './lib/hr-staff-upload.js';

initializeApp({
  storageBucket: 'yesweigh-service.firebasestorage.app',
});

const zohoClientId = defineSecret('ZOHO_CLIENT_ID');
const zohoClientSecret = defineSecret('ZOHO_CLIENT_SECRET');
const zohoRefreshToken = defineSecret('ZOHO_REFRESH_TOKEN');
const watiToken = defineSecret('WATI_TOKEN');
const watiEndpoint = defineSecret('WATI_ENDPOINT');
const zohoOrganizationId = defineString('ZOHO_ORGANIZATION_ID');
const zohoWebhookSecret = defineString('ZOHO_WEBHOOK_SECRET', { default: '' });

const ALLOWED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);
const SYNC_ROLES = new Set(['staff', 'super_admin']);
const SUPER_ADMIN_ROLES = new Set(['super_admin']);
const DEALER_INVOICE_ROLES = new Set(['dealer', 'dealer_staff']);

function zohoSecrets() {
  return {
    clientId: zohoClientId.value(),
    clientSecret: zohoClientSecret.value(),
    refreshToken: zohoRefreshToken.value(),
  };
}

async function readUserRole(uid) {
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) return null;

  const data = snap.data();
  const role = String(data?.role ?? '');
  if (role === 'admin') return 'super_admin';
  if (role === 'director') return 'dealer';
  if (role === 'director_staff') return 'dealer_staff';
  if (ALLOWED_ROLES.has(role)) return role;
  return null;
}

async function requireActiveUser(uid, allowedRoles = ALLOWED_ROLES) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const role = await readUserRole(uid);
  if (!role || !allowedRoles.has(role)) {
    throw new HttpsError('permission-denied', 'You do not have access.');
  }

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  if (!userSnap.exists || userSnap.data()?.active === false) {
    throw new HttpsError('permission-denied', 'Your account is inactive.');
  }

  return role;
}

function filterCatalogItems(items, { search, category, stockStatus } = {}) {
  let filtered = items;

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(item =>
      String(item.name ?? '').toLowerCase().includes(q)
      || String(item.sku ?? '').toLowerCase().includes(q)
      || String(item.categoryName ?? '').toLowerCase().includes(q),
    );
  }

  if (category) {
    filtered = filtered.filter(item => item.categoryId === category);
  }

  if (stockStatus) {
    filtered = filtered.filter(item => item.stockStatus === stockStatus);
  }

  return filtered;
}

/** Cached catalog — public (no auth) and authenticated clients. */
export const getCatalog = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const { search, category, stockStatus } = request.data ?? {};
    const catalog = await readCatalogFromFirestore();
    const items = filterCatalogItems(catalog.items, { search, category, stockStatus });

    return {
      ...catalog,
      items,
      total: items.length,
    };
  },
);

/** Live Zoho product detail with warehouse breakdown. */
export const getCatalogProductDetail = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    const detail = await fetchProductDetail(accessToken, organizationId, productId);

    const cached = await getFirestore().collection('catalogProducts').doc(productId).get();
    if (cached.exists) {
      const data = cached.data();
      if (!detail.imageUrl) {
        detail.imageUrl = data?.imageUrl ?? null;
      }
      if (data?.syncedAt) {
        detail.syncedAt = data.syncedAt;
      }
    }

    return detail;
  },
);

/** Auto sync — every 30 min, Mon–Sat 09:00–18:00 IST. */
export const syncZohoCatalogScheduled = onSchedule(
  {
    schedule: '*/30 9-18 * * 1-6',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    if (!isCatalogSyncWindow()) {
      console.log('Skipping scheduled catalog sync — outside business hours (IST).');
      return;
    }

    const result = await syncCatalogToFirestore(
      zohoSecrets(),
      zohoOrganizationId.value(),
      { skipNewImages: true },
    );

    console.log(
      `Scheduled catalog sync: ${result.syncedCount} products, ${result.categoryCount} categories (${result.categorizedProductCount} categorized).`,
    );
  },
);

/** Manual sync — staff / super admin only. */
export const syncZohoCatalog = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const result = await syncCatalogToFirestore(
      zohoSecrets(),
      zohoOrganizationId.value(),
      { skipNewImages: true },
    );

    return result;
  },
);

/** Save drag-and-drop category order — staff / super admin only. */
export const saveCatalogCategoryOrder = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const categories = request.data?.categories;
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new HttpsError('invalid-argument', 'categories array is required.');
    }

    const payload = categories.map((cat, index) => ({
      id: String(cat.id ?? '').trim(),
      name: String(cat.name ?? 'Category'),
      displayOrder: Number.isFinite(cat.displayOrder) ? cat.displayOrder : index,
    })).filter(cat => cat.id);

    if (!payload.length) {
      throw new HttpsError('invalid-argument', 'No valid categories provided.');
    }

    await saveCategoryOrder(payload);
    return { ok: true, count: payload.length };
  },
);

/** Upload custom category thumbnail — staff / super admin only. */
export const uploadCatalogCategoryThumbnail = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const categoryId = String(request.data?.categoryId ?? '').trim();
    const categoryName = String(request.data?.categoryName ?? '').trim();
    const contentType = String(request.data?.contentType ?? 'image/jpeg').trim();
    const imageBase64 = String(request.data?.imageBase64 ?? '').trim();

    if (!categoryId || !imageBase64) {
      throw new HttpsError('invalid-argument', 'categoryId and imageBase64 are required.');
    }

    let buffer;
    try {
      buffer = Buffer.from(imageBase64, 'base64');
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid image data.');
    }

    if (!buffer.length) {
      throw new HttpsError('invalid-argument', 'Empty image data.');
    }

    try {
      return await uploadCategoryThumbnail(categoryId, categoryName, buffer, contentType);
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Thumbnail upload failed.');
    }
  },
);

/** Upload product/spare image to Zoho + Firebase cache — staff / super admin only. */
export const uploadCatalogProductImage = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const contentType = String(request.data?.contentType ?? 'image/jpeg').trim();
    const imageBase64 = String(request.data?.imageBase64 ?? '').trim();

    if (!productId || !imageBase64) {
      throw new HttpsError('invalid-argument', 'productId and imageBase64 are required.');
    }

    let buffer;
    try {
      buffer = Buffer.from(imageBase64, 'base64');
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid image data.');
    }

    if (!buffer.length) {
      throw new HttpsError('invalid-argument', 'Empty image data.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await uploadProductImage(productId, buffer, contentType, accessToken, organizationId);
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Product image upload failed.');
    }
  },
);

/** Assign product to a Zoho item category (PUT /items with category_id + label_rate). */
export const assignCatalogProductCategory = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const categoryId = String(request.data?.categoryId ?? '').trim();
    const categoryName = String(request.data?.categoryName ?? '').trim();

    if (!productId || !categoryId) {
      throw new HttpsError('invalid-argument', 'productId and categoryId are required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    await moveProductToCategory(accessToken, organizationId, productId, categoryId);
    await patchProductCategory(productId, categoryId, categoryName);

    return { ok: true };
  },
);

/** Read product↔spare links (dealers read; staff manage). */
export const getCatalogSpareLinks = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid);

    const productId = String(request.data?.productId ?? '').trim();
    const spareId = String(request.data?.spareId ?? '').trim();

    if (Boolean(productId) === Boolean(spareId)) {
      throw new HttpsError('invalid-argument', 'Provide exactly one of productId or spareId.');
    }

    try {
      if (productId) {
        const items = await getLinkedSparesForProduct(productId);
        return { kind: 'spares', items };
      }
      const items = await getLinkedProductsForSpare(spareId);
      return { kind: 'products', items };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not load spare links.');
    }
  },
);

/** Save product↔spare links from product or spare context. */
export const saveCatalogSpareLinks = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const spareId = String(request.data?.spareId ?? '').trim();
    const spareIds = Array.isArray(request.data?.spareIds) ? request.data.spareIds : null;
    const productIds = Array.isArray(request.data?.productIds) ? request.data.productIds : null;

    try {
      if (productId && spareIds) {
        return await saveProductSpareMap(productId, spareIds, uid);
      }
      if (spareId && productIds) {
        return await saveSpareProductMap(spareId, productIds, uid);
      }
      throw new HttpsError(
        'invalid-argument',
        'Provide productId+spareIds or spareId+productIds.',
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not save spare links.');
    }
  },
);

export const deleteManagedUser = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, new Set(['super_admin']));

    const targetUid = request.data?.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'User id is required.');
    }
    if (targetUid === request.auth.uid) {
      throw new HttpsError('failed-precondition', 'You cannot delete your own account.');
    }

    try {
      return await deleteManagedUserAccount(targetUid);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete user.');
    }
  },
);

/** @deprecated Use Firestore catalog read on the client — thin cache proxy for old app bundles. */
export const getZohoCatalog = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid);

    const catalog = await readCatalogFromFirestore();

    return {
      organizationId: catalog.items[0]?.organizationId ?? null,
      syncedAt: catalog.syncedAt ?? new Date().toISOString(),
      stats: {
        totalItems: catalog.stats.totalProducts,
        totalCategories: catalog.stats.totalCategories,
        activeItems: catalog.stats.totalProducts,
        activeCategories: catalog.stats.totalCategories,
        totalGroups: catalog.stats.totalCategories,
        activeGroups: catalog.stats.totalCategories,
      },
      items: catalog.items.map(item => ({
        id: item.id,
        name: item.name,
        sku: item.sku ?? '',
        rate: item.rate,
        status: item.status,
        unit: item.unit,
        type: '',
        description: item.description ?? '',
        categoryId: item.categoryId ?? undefined,
        categoryName: item.categoryName ?? undefined,
        groupId: item.categoryId ?? undefined,
        groupName: item.categoryName ?? undefined,
      })),
      categories: catalog.categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: '',
        status: 'active',
        unit: '',
        itemCount: cat.productCount,
        items: catalog.items
          .filter(p => p.categoryId === cat.id)
          .map(item => ({
            id: item.id,
            name: item.name,
            sku: item.sku ?? '',
            rate: item.rate,
            status: item.status,
            unit: item.unit,
            type: '',
            description: item.description ?? '',
            categoryId: item.categoryId ?? undefined,
            categoryName: item.categoryName ?? undefined,
            groupId: item.categoryId ?? undefined,
            groupName: item.categoryName ?? undefined,
          })),
      })),
      itemGroups: catalog.categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: '',
        status: 'active',
        unit: '',
        itemCount: cat.productCount,
        items: catalog.items
          .filter(p => p.categoryId === cat.id)
          .map(item => ({
            id: item.id,
            name: item.name,
            sku: item.sku ?? '',
            rate: item.rate,
            status: item.status,
            unit: item.unit,
            type: '',
            description: item.description ?? '',
            groupId: item.categoryId ?? undefined,
            groupName: item.categoryName ?? undefined,
          })),
      })),
    };
  },
);

/** Sync Zoho customers (dealers) — staff / super admin. */
export const syncZohoCustomers = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    try {
      const count = await syncCustomersToFirestore(zohoSecrets(), zohoOrganizationId.value());
      return { syncedCount: count };
    } catch (err) {
      console.error('syncZohoCustomers failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Zoho customer sync failed.');
    }
  },
);

/** Invoice aggregates + recent list for dealer dashboard (Firestore mirror). */
export const getDealerInvoiceDashboard = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    try {
      return await buildDealerInvoiceDashboard(
        null,
        null,
        uid,
        role,
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not load invoice dashboard.');
    }
  },
);

/** Single invoice with line items for dealer detail view (Firestore mirror). */
export const getDealerInvoiceDetail = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    if (!invoiceId) {
      throw new HttpsError('invalid-argument', 'Invoice id is required.');
    }
    try {
      return await fetchDealerInvoiceDetail(
        null,
        null,
        uid,
        role,
        invoiceId,
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not load invoice.');
    }
  },
);

/** Download invoice or linked sales order PDF (lazy-fetch from Zoho on first view). */
export const downloadDealerInvoiceDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const documentType = String(request.data?.documentType ?? '').trim().toLowerCase();
    if (!invoiceId) {
      throw new HttpsError('invalid-argument', 'Invoice id is required.');
    }
    if (documentType !== 'invoice' && documentType !== 'salesorder') {
      throw new HttpsError('invalid-argument', 'documentType must be invoice or salesorder.');
    }
    try {
      return await fetchDealerInvoiceDocument(
        zohoSecrets(),
        zohoOrganizationId.value(),
        uid,
        role,
        invoiceId,
        documentType,
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not download document.');
    }
  },
);

/** Download invoice PDF for super admin (any dealer customer). */
export const downloadAdminInvoiceDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const documentType = String(request.data?.documentType ?? '').trim().toLowerCase();
    if (!customerId) {
      throw new HttpsError('invalid-argument', 'Customer id is required.');
    }
    if (!invoiceId) {
      throw new HttpsError('invalid-argument', 'Invoice id is required.');
    }
    if (documentType !== 'invoice' && documentType !== 'salesorder') {
      throw new HttpsError('invalid-argument', 'documentType must be invoice or salesorder.');
    }
    try {
      return await fetchAdminInvoiceDocument(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
        invoiceId,
        documentType,
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not download document.');
    }
  },
);

/** List dealer invoices from Firestore mirror (fast, no Zoho rate limits). */
export const getDealerInvoices = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    try {
      return await listDealerInvoices(
        null,
        null,
        uid,
        role,
        request.data ?? {},
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not load invoices.');
    }
  },
);

/** Zoho Books webhook — keeps Firestore invoice mirror up to date. */
export const zohoInvoiceWebhook = onRequest(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const secret = zohoWebhookSecret.value()?.trim();
    if (secret && !verifyZohoWebhookSignature(req, secret)) {
      console.warn('Zoho invoice webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoInvoiceWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho invoice webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/** Nightly invoice backfill — 2 AM IST; uses at most 70% of daily Zoho quota (30% reserved). */
export const syncZohoInvoicesScheduled = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 1800,
    memory: '2GiB',
  },
  async () => {
    try {
      const result = await syncOrgInvoicesToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          source: 'scheduled',
          quotaReserveRatio: 0.30,
        },
      );
      console.log(
        `Scheduled org invoice sync: status=${result.status}, newlyPulled=${result.newlyPulled}, `
        + `failed=${result.failedCount}, remaining=${result.remaining}, rateLimited=${result.rateLimited}, `
        + `quotaReserved=${result.quotaReserved}.`,
      );
    } catch (err) {
      console.error('Scheduled org invoice sync failed:', err?.message ?? err);
    }
  },
);

/** Manual invoice sync — staff / super admin (details only; PDFs load on first view). */
export const syncZohoInvoices = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const customerId = String(request.data?.customerId ?? '').trim();
    try {
      const result = await syncInvoicesToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          customerId: customerId || undefined,
          skipPdfs: request.data?.skipPdfs !== false,
          concurrency: 3,
          delayMs: 350,
        },
      );
      return result;
    } catch (err) {
      console.error('syncZohoInvoices failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice sync failed.');
    }
  },
);

/** Org-wide invoice backfill status — super admin. */
export const getOrgInvoiceSyncStatusCallable = onCall(
  { region: 'asia-south1', timeoutSeconds: 30, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    return getOrgInvoiceSyncStatus();
  },
);

/** Zoho API usage today — super admin (on-demand from admin invoice sync page). */
export const getZohoApiUsageCallable = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await getZohoApiUsageStatus(
        zohoSecrets(),
        zohoOrganizationId.value(),
        { forceRefresh: request.data?.forceRefresh === true },
      );
    } catch (err) {
      console.error('getZohoApiUsageStatus failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not load Zoho API usage.');
    }
  },
);

/** Count every org invoice in Zoho — super admin. */
export const countOrgInvoicesInRangeCallable = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 3600,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await countOrgInvoicesInRange(
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      console.error('countOrgInvoicesInRange failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice count failed.');
    }
  },
);

/** Pull all org invoice details into Firestore — super admin. */
export const runOrgInvoiceSync = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 3600,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await syncOrgInvoicesToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        { source: 'manual' },
      );
    } catch (err) {
      if (err?.code === 'ALREADY_RUNNING') {
        throw new HttpsError('failed-precondition', err.message);
      }
      if (err?.code === 'RATE_LIMITED') {
        throw new HttpsError(
          'resource-exhausted',
          'Zoho API rate limit reached. Wait a few minutes and click Pull now again.',
        );
      }
      console.error('runOrgInvoiceSync failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Org invoice sync failed.');
    }
  },
);

/** Pull invoice details from Zoho into Firestore for the signed-in dealer (no PDFs). */
export const syncDealerInvoicesFromZoho = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    try {
      const customerId = await resolveZohoCustomerIdForUser(uid, role);
      const result = await syncInvoicesToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          customerId,
          skipPdfs: true,
          skipImages: false,
          concurrency: 3,
          delayMs: 350,
        },
      );
      return result;
    } catch (err) {
      console.error('syncDealerInvoicesFromZoho failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice sync failed.');
    }
  },
);

/** List Zoho dealers with filters — staff / super admin. */
export const getDealers = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    return listDealers(request.data ?? {});
  },
);

/** Dealer's own Zoho customer record — dealer / dealer_staff. */
export const getMyDealerProfile = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES);
    try {
      const customerId = await resolveZohoCustomerIdForUser(uid, role);
      const dealer = await getDealerRecord(customerId, {
        refreshFromZoho: { force: false },
        secrets: zohoSecrets(),
        orgId: zohoOrganizationId.value(),
      });
      return { dealer };
    } catch (err) {
      if (err?.message === 'Dealer not found.') {
        throw new HttpsError('not-found', err.message);
      }
      throw new HttpsError('internal', err?.message ?? 'Could not load dealer profile.');
    }
  },
);

/** Single dealer by id — staff / super admin. Refreshes Zoho detail when stale. */
export const getDealer = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    try {
      const dealer = await getDealerRecord(id, {
        refreshFromZoho: {
          force: Boolean(request.data?.forceRefresh),
        },
        secrets: zohoSecrets(),
        orgId: zohoOrganizationId.value(),
      });
      return { dealer };
    } catch (err) {
      if (err?.message === 'Dealer not found.') {
        throw new HttpsError('not-found', err.message);
      }
      throw err;
    }
  },
);

/** Force refresh one dealer from Zoho detail API — staff / super admin. */
export const refreshZohoDealer = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    try {
      const dealer = await refreshDealerZohoRecord(
        id,
        zohoSecrets(),
        zohoOrganizationId.value(),
        { force: true },
      );
      return { dealer };
    } catch (err) {
      if (err?.message === 'Dealer not found.') {
        throw new HttpsError('not-found', err.message);
      }
      console.error('refreshZohoDealer failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Zoho dealer refresh failed.');
    }
  },
);

/** Push editable contact fields to Zoho Inventory — staff / super admin. */
export const pushDealerToZoho = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    const changes = request.data?.changes ?? {};
    try {
      const dealer = await pushDealerToZohoRecord(
        id,
        changes,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
      return { dealer };
    } catch (err) {
      if (err?.message === 'Dealer not found.') {
        throw new HttpsError('not-found', err.message);
      }
      console.error('pushDealerToZoho failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Push to Zoho failed.');
    }
  },
);

/** Export dealers CSV — staff / super admin. */
export const exportDealers = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const csv = await exportDealersCsv(request.data ?? {});
    return { csv };
  },
);

/** Dealer KPI stats — staff / super admin. */
export const getDealerStats = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    return getDealerStatsSummary();
  },
);

/** Dealer location facets — staff / super admin. */
export const getDealerLocations = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    return getDealerLocationsSummary();
  },
);

/** Resolve state and district from a 6-digit Indian PIN code. */
export const lookupDealerPincode = onCall(
  { region: 'asia-south1', timeoutSeconds: 30, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const pincode = String(request.data?.pincode ?? '').replace(/\D/g, '').slice(0, 6);
    if (pincode.length !== 6) {
      throw new HttpsError('invalid-argument', 'Enter a valid 6-digit PIN code.');
    }
    const zipCache = await readDealerSetting('zip_codes', {});
    const location = await lookupPincodeLocation(pincode, zipCache);
    if (!location?.state || !location?.district) {
      throw new HttpsError('not-found', 'Could not find state and district for this PIN code.');
    }
    return location;
  },
);

/** Patch dealer overrides — staff / super admin. */
export const patchDealer = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    const updated = await patchDealerRecord(id, request.data?.patch ?? {});
    return { dealer: updated };
  },
);

/** Link portal user to Zoho customer — staff / super admin. */
export const linkDealerPortalUserFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const zohoCustomerId = String(request.data?.zohoCustomerId ?? '').trim();
    const portalUserId = String(request.data?.portalUserId ?? '').trim();
    if (!zohoCustomerId || !portalUserId) {
      throw new HttpsError('invalid-argument', 'zohoCustomerId and portalUserId are required.');
    }
    await linkDealerPortalUser(zohoCustomerId, portalUserId);
    return { ok: true };
  },
);

/** KAM list — staff / super admin. */
export const getDealerKams = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const snap = await getFirestore().collection('kams').orderBy('name').get();
    return { data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  },
);

/** Create KAM — staff / super admin. */
export const createDealerKam = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const name = String(request.data?.name ?? '').trim();
    if (!name) throw new HttpsError('invalid-argument', 'name is required.');
    const phone = request.data?.phone ? String(request.data.phone).trim() : null;
    const ref = await getFirestore().collection('kams').add({
      name,
      phone,
      createdAt: new Date().toISOString(),
    });
    const snap = await ref.get();
    return { data: { id: snap.id, ...snap.data() } };
  },
);

/** Delete KAM — staff / super admin. */
export const deleteDealerKam = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    await getFirestore().collection('kams').doc(id).delete();
    return { ok: true };
  },
);

/** Dealer settings (categories, etc.) — staff / super admin. */
export const getDealerSetting = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const key = String(request.data?.key ?? '').trim();
    if (!key) throw new HttpsError('invalid-argument', 'key is required.');
    const fallback = request.data?.fallback ?? [];
    const value = await readDealerSetting(key, fallback);
    return { value };
  },
);

export const setDealerSetting = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const key = String(request.data?.key ?? '').trim();
    if (!key) throw new HttpsError('invalid-argument', 'key is required.');
    const value = await writeDealerSetting(key, request.data?.value);
    return { value };
  },
);

/** Apply KAM/stage/deactivation overlay from yesweighmomentumhub CRM Firebase — staff / super admin. */
export const importCrmDealerOverlayFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 540, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    try {
      const result = await importCrmDealerOverlay();
      return result;
    } catch (err) {
      console.error('importCrmDealerOverlay failed:', err);
      throw new HttpsError('internal', err?.message ?? 'CRM dealer overlay import failed.');
    }
  },
);

/** @deprecated Use importCrmDealerOverlayFn */
export const importDealerLegacyOverridesFn = importCrmDealerOverlayFn;

/** Backfill dealer state/district/zip from cache + Zoho detail — staff / super admin. */
export const backfillDealerLocationsFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    try {
      const result = await backfillDealerLocations(
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
      return result;
    } catch (err) {
      console.error('backfillDealerLocations failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Location backfill failed.');
    }
  },
);

// ============================================================================
// DEALER OTP LOGIN (Wati WhatsApp)
// ============================================================================

function parseDealerPhoneInput(raw) {
  const phone = normalizePhone10(raw);
  if (!phone) {
    throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.');
  }
  return phone;
}

function dealerOtpError(err, fallback) {
  const message = err?.message ?? fallback;
  if (message.includes('already') || message.includes('Invalid') || message.includes('expired')) {
    throw new HttpsError('failed-precondition', message);
  }
  if (message.includes('not found') || message.includes('No dealer')) {
    throw new HttpsError('not-found', message);
  }
  throw new HttpsError('internal', message);
}

/** Public — match dealer by 10-digit phone against synced Zoho customers. */
export const dealerLoginLookup = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const phone = parseDealerPhoneInput(request.data?.phone);
    try {
      return await lookupDealerForLogin(phone);
    } catch (err) {
      dealerOtpError(err, 'Dealer lookup failed.');
    }
  },
);

/** Public — send WhatsApp OTP via Wati for first-time dealer portal signup. */
export const sendDealerLoginOtp = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [watiToken, watiEndpoint],
  },
  async request => {
    const phone = parseDealerPhoneInput(request.data?.phone);
    try {
      return await dispatchDealerLoginOtp(phone, watiToken.value(), watiEndpoint.value());
    } catch (err) {
      dealerOtpError(err, 'Could not send OTP.');
    }
  },
);

/** Public — verify OTP and issue a short-lived setup token. */
export const verifyDealerLoginOtp = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const phone = parseDealerPhoneInput(request.data?.phone);
    const code = String(request.data?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Enter the 6-digit OTP.');
    }
    try {
      return await validateDealerLoginOtp(phone, code);
    } catch (err) {
      dealerOtpError(err, 'OTP verification failed.');
    }
  },
);

/** Public — create dealer portal account after OTP verification. */
export const completeDealerSignup = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const phone = parseDealerPhoneInput(request.data?.phone);
    const setupToken = String(request.data?.setupToken ?? '').trim();
    const password = String(request.data?.password ?? '');
    if (!setupToken) {
      throw new HttpsError('invalid-argument', 'Verification session is missing.');
    }
    try {
      return await finalizeDealerSignup(phone, setupToken, password);
    } catch (err) {
      dealerOtpError(err, 'Signup failed.');
    }
  },
);

/** Signed upload URL for support ticket evidence — bypasses client Storage rules. */
export const prepareSupportAttachmentUploadFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid);
  try {
    return await prepareSupportAttachmentUpload(request.auth.uid, request.data ?? {});
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const message = String(err?.message ?? 'Could not prepare upload.');
    if (message.includes('signBlob') || message.includes('serviceAccounts.signBlob')) {
      throw new HttpsError(
        'failed-precondition',
        'Server upload signing is not configured. The app will upload directly from your device.',
      );
    }
    throw new HttpsError('internal', message);
  }
  },
);

/** HR staff photo / document upload — uses Admin SDK (no client Storage write rules). */
export const uploadHrStaffFileFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await uploadHrStaffFile(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload HR file.');
    }
  },
);

/** Signed read URL for HR staff files in Storage. */
export const getHrStaffFileUrlFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await getHrStaffFileUrl(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load HR file.');
    }
  },
);
