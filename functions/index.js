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
  getStockStatus,
} from './lib/zoho.js';
import {
  syncCatalogToFirestore,
  readCatalogFromFirestore,
  patchProductPackageInfo,
  readPackageInfo,
  saveCategoryOrder,
  saveCategoryProductOrder,
  uploadCategoryThumbnail,
  importProductImagesFromZoho,
  pushMissingCatalogProductImagesToZoho,
  recordCatalogBinLabelPrint,
} from './lib/catalog-sync.js';
import {
  mutateCatalogProductDetails,
  mutateCatalogProductOverlays,
  mutateCatalogProductCatalogVisibility,
  mutateCatalogProductStatus,
  mutateCatalogProductCategory,
  mutateCatalogProductImageUpload,
  mutateCatalogProductImageDelete,
} from './lib/catalog-product-mutations.js';
import { applyAllSkuRepairs, applyBulkCatalogSkuUpdates } from './lib/sku-correction.js';
import {
  recordCatalogProductAudit as persistCatalogProductAudit,
  listCatalogProductAuditLogs,
  backfillLegacyCatalogProductAudits,
} from './lib/catalog-product-audit.js';
import { migrateExistingAuditsIntoCycles } from './lib/audit-cycles-migrate.js';
import { transferCatalogProductWarehouseStock as persistWarehouseTransfer } from './lib/zoho-warehouse-transfer.js';
import {
  getLinkedSparesForProduct,
  getLinkedProductsForSpare,
  saveProductSpareMap,
  saveSpareProductMap,
} from './lib/spare-links.js';
import { syncLinkedAuditPhotosToZoho, reconcileLinkedAuditPhotosOnZoho } from './lib/audit-zoho-images.js';
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
import { prepareSupportAttachmentUpload, uploadSupportAttachment } from './lib/support-attachments.js';
import { appendSupportMessage } from './lib/support-messages.js';
import { markSupportMessageReceipts } from './lib/support-message-receipts.js';
import { getHrStaffFileUrl, uploadHrStaffFile } from './lib/hr-staff-upload.js';
import { getYesStorePhotoUrl, uploadYesStorePhoto } from './lib/yes-store-upload.js';
import {
  uploadLogisticsPhoto as storeLogisticsPhoto,
  getLogisticsPhotoUrl,
  getPublicLogisticsInsidePhotoUrl,
} from './lib/logistics-upload.js';
import {
  uploadApprovalNumberPdf as storeApprovalNumberPdf,
  removeApprovalNumberPdf as clearApprovalNumberPdf,
  deleteApprovalPdfObject,
} from './lib/approval-pdf-upload.js';
import {
  deleteCatalogNcPhoto as removeCatalogNcPhoto,
  uploadCatalogNcPhoto as storeCatalogNcPhoto,
} from './lib/catalog-nc-upload.js';
import {
  deleteCatalogMediaFile as removeCatalogMediaFile,
  uploadCatalogMediaFile as storeCatalogMediaFile,
} from './lib/catalog-media-upload.js';
import { CI_BUILD_TAG } from './lib/ci-build.js';

// CI smoke-test marker (shared bundle entry — triggers full functions deploy in CI).
void CI_BUILD_TAG;

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

const ALLOWED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin', 'media']);
const SYNC_ROLES = new Set(['staff', 'super_admin']);
const CATALOG_IMAGE_ROLES = new Set(['staff', 'super_admin', 'media']);
const SUPER_ADMIN_ROLES = new Set(['super_admin']);
const DEALER_INVOICE_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);

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
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    const cached = await getFirestore().collection('catalogProducts').doc(productId).get();
    const cachedData = cached.exists ? (cached.data() ?? {}) : null;

    let detail;
    let zohoLive = true;
    try {
      detail = await fetchProductDetail(accessToken, organizationId, productId);
    } catch (err) {
      console.warn('getCatalogProductDetail: Zoho fetch failed:', err?.message ?? err);
      if (!cachedData) {
        const message = err?.message ?? 'Could not load product from Zoho.';
        const rateLimited = /rate|blocked|too many requests|exceeded the maximum number of requests/i.test(message);
        throw new HttpsError(rateLimited ? 'resource-exhausted' : 'internal', message);
      }
      const stock = Number(cachedData.stock ?? 0);
      const reorderLevel = Number(cachedData.reorderLevel ?? 0);
      detail = {
        id: String(cachedData.id ?? productId),
        name: String(cachedData.name ?? ''),
        sku: cachedData.sku == null ? null : String(cachedData.sku),
        description: cachedData.description == null ? null : String(cachedData.description),
        unit: String(cachedData.unit ?? 'pcs'),
        rate: Number(cachedData.rate ?? 0),
        stock,
        stockStatus: cachedData.stockStatus ?? getStockStatus(stock, reorderLevel),
        categoryId: cachedData.categoryId ?? null,
        categoryName: cachedData.categoryName ?? null,
        status: String(cachedData.status ?? 'active'),
        hsn: cachedData.hsn ?? null,
        taxName: cachedData.taxName ?? null,
        taxPercentage: cachedData.taxPercentage != null ? Number(cachedData.taxPercentage) : null,
        reorderLevel,
        preferredVendor: null,
        warehouses: Array.isArray(cachedData.warehouses) ? cachedData.warehouses : [],
      };
      zohoLive = false;
    }

    if (zohoLive) {
      try {
        await importProductImagesFromZoho(productId, accessToken, organizationId);
      } catch (err) {
        console.warn('importProductImagesFromZoho failed:', err?.message ?? err);
      }
    }

    if (cachedData) {
      if (cachedData.imageUrl) {
        detail.imageUrl = cachedData.imageUrl;
      }
      if (Array.isArray(cachedData.imageUrls) && cachedData.imageUrls.length) {
        detail.imageUrls = cachedData.imageUrls.filter(url => String(url ?? '').trim());
      }
      if (Array.isArray(cachedData.imageDocs) && cachedData.imageDocs.length) {
        detail.imageDocs = cachedData.imageDocs
          .map(row => {
            const documentId = String(row?.documentId ?? '').trim();
            const url = String(row?.url ?? '').trim();
            const storagePath = String(row?.storagePath ?? '').trim();
            if (!documentId || !url) return null;
            return storagePath
              ? { documentId, url, storagePath }
              : { documentId, url };
          })
          .filter(Boolean);
      }
      if (cachedData.syncedAt) {
        detail.syncedAt = cachedData.syncedAt;
      }
      const packageInfo = readPackageInfo(cachedData.packageInfo);
      if (packageInfo) {
        detail.packageInfo = packageInfo;
      }
      if (cachedData.auditSnapshot) {
        detail.auditSnapshot = cachedData.auditSnapshot;
      } else {
        detail.auditSnapshot = null;
      }
      const mrpOverride = Number(cachedData.mrpOverride);
      if (Number.isFinite(mrpOverride) && mrpOverride > 0) {
        detail.mrpOverride = Math.round(mrpOverride * 100) / 100;
      }
      const modelNumber = String(cachedData.modelNumber ?? '').trim();
      if (modelNumber) {
        detail.modelNumber = modelNumber;
      }
      const approvalNumber = String(cachedData.approvalNumber ?? '').trim();
      if (approvalNumber) {
        detail.approvalNumber = approvalNumber;
      }
      const spareGroupId = String(cachedData.spareGroupId ?? '').trim();
      if (spareGroupId) {
        detail.spareGroupId = spareGroupId;
      }
      if (typeof cachedData.skuChangedAt === 'string' && cachedData.skuChangedAt.trim()) {
        detail.skuChangedAt = cachedData.skuChangedAt.trim();
      }
      if (typeof cachedData.nameChangedAt === 'string' && cachedData.nameChangedAt.trim()) {
        detail.nameChangedAt = cachedData.nameChangedAt.trim();
      }
      if (typeof cachedData.binLabelPrintedSku === 'string' && cachedData.binLabelPrintedSku.trim()) {
        detail.binLabelPrintedSku = cachedData.binLabelPrintedSku.trim();
      }
      if (typeof cachedData.binLabelPrintedName === 'string' && cachedData.binLabelPrintedName.trim()) {
        detail.binLabelPrintedName = cachedData.binLabelPrintedName.trim();
      }
      if (typeof cachedData.binLabelPrintedAt === 'string' && cachedData.binLabelPrintedAt.trim()) {
        detail.binLabelPrintedAt = cachedData.binLabelPrintedAt.trim();
      }
      if (cachedData.hiddenFromCatalog === true) {
        detail.hiddenFromCatalog = true;
      }
    }

    if (!zohoLive) {
      detail.zohoLive = false;
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

/** Save drag-and-drop product order within a category — staff / super admin only. */
export const saveCatalogCategoryProductOrder = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const categoryId = String(request.data?.categoryId ?? '').trim();
    const products = request.data?.products;
    if (!categoryId) {
      throw new HttpsError('invalid-argument', 'categoryId is required.');
    }
    if (!Array.isArray(products) || products.length === 0) {
      throw new HttpsError('invalid-argument', 'products array is required.');
    }

    const payload = products.map((product, index) => ({
      id: String(product.id ?? '').trim(),
      displayOrder: Number.isFinite(product.displayOrder) ? product.displayOrder : index,
    })).filter(product => product.id);

    if (!payload.length) {
      throw new HttpsError('invalid-argument', 'No valid products provided.');
    }

    try {
      await saveCategoryProductOrder(categoryId, payload);
      return { ok: true, count: payload.length };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not save product order.');
    }
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

/** Upload product/spare image to Zoho + Firebase cache — staff / super admin / media. */
export const uploadCatalogProductImage = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, CATALOG_IMAGE_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const contentType = String(request.data?.contentType ?? 'image/jpeg').trim();
    const imageBase64 = String(request.data?.imageBase64 ?? '').trim();
    const modeRaw = String(request.data?.mode ?? 'replace').trim().toLowerCase();
    const mode = modeRaw === 'add' || modeRaw === 'promote' ? modeRaw : 'replace';
    const documentId = String(request.data?.documentId ?? '').trim() || undefined;

    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (mode !== 'promote' && !imageBase64) {
      throw new HttpsError('invalid-argument', 'productId and imageBase64 are required.');
    }
    if (mode === 'promote' && !documentId) {
      throw new HttpsError('invalid-argument', 'documentId is required to set a gallery photo as main.');
    }

    let buffer = Buffer.alloc(0);
    if (mode !== 'promote') {
      try {
        buffer = Buffer.from(imageBase64, 'base64');
      } catch {
        throw new HttpsError('invalid-argument', 'Invalid image data.');
      }

      if (!buffer.length) {
        throw new HttpsError('invalid-argument', 'Empty image data.');
      }
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await mutateCatalogProductImageUpload(
        productId,
        buffer,
        contentType,
        accessToken,
        organizationId,
        mode,
        { documentId },
      );
    } catch (err) {
      const message = err?.message ?? 'Product image upload failed.';
      console.error('uploadCatalogProductImage failed:', {
        productId,
        mode,
        documentId: documentId || null,
        contentType,
        bufferBytes: buffer?.length ?? 0,
        message,
      });
      if (/not found|refresh the product|unsupported image|empty image|5 mb/i.test(message)) {
        throw new HttpsError('failed-precondition', message);
      }
      if (/rate|blocked|too many requests/i.test(message)) {
        throw new HttpsError('resource-exhausted', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/** Delete product/spare image from Zoho + Firebase cache — staff / super admin / media. */
export const deleteCatalogProductImage = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, CATALOG_IMAGE_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    const documentId = String(request.data?.documentId ?? '').trim() || undefined;
    const imageUrl = String(request.data?.imageUrl ?? '').trim() || undefined;

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await mutateCatalogProductImageDelete(
        productId,
        accessToken,
        organizationId,
        {
          ...(documentId ? { documentId } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
      );
    } catch (err) {
      const message = err?.message ?? 'Product image delete failed.';
      if (/rate|blocked|too many requests|exceeded the maximum number of requests/i.test(message)) {
        throw new HttpsError('resource-exhausted', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/**
 * Compare Firebase vs Zoho product images; optionally upload Firebase-only images to Zoho
 * (slow, rate-limit safe). Staff / super admin / media.
 */
export const pushMissingCatalogProductImagesToZohoFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, CATALOG_IMAGE_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    const dryRun = Boolean(request.data?.dryRun);

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await pushMissingCatalogProductImagesToZoho(
        productId,
        accessToken,
        organizationId,
        { dryRun },
      );
    } catch (err) {
      console.error('pushMissingCatalogProductImagesToZohoFn failed:', err);
      const message = err?.message ?? 'Could not push images to Zoho.';
      if (/rate|blocked|too many requests/i.test(message)) {
        throw new HttpsError('resource-exhausted', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/** Set Zoho item active/inactive — super admin only. */
export const setCatalogProductStatus = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const status = String(request.data?.status ?? '').trim().toLowerCase();

    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (status !== 'active' && status !== 'inactive') {
      throw new HttpsError('invalid-argument', 'status must be active or inactive.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      await mutateCatalogProductStatus(accessToken, organizationId, productId, status);
      return { ok: true, status };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not update item status on Zoho.');
    }
  },
);

/** Update Zoho item name, SKU, optional rate — staff / super admin only. */
export const updateCatalogProductDetails = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const name = String(request.data?.name ?? '').trim();
    const sku = String(request.data?.sku ?? '').trim();

    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (!name) {
      throw new HttpsError('invalid-argument', 'name is required.');
    }
    if (!sku) {
      throw new HttpsError('invalid-argument', 'sku is required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      const saved = await mutateCatalogProductDetails(accessToken, organizationId, productId, {
        name,
        sku,
        rate: request.data?.rate,
        mrpOverride: request.data?.mrpOverride,
        modelNumber: request.data?.modelNumber,
        approvalNumber: request.data?.approvalNumber,
      });
      return { ok: true, ...saved };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not update item details on Zoho.');
    }
  },
);

/** Record bin label print for spare-rack SKU status (Firestore only). */
export const recordCatalogBinLabelPrintFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    const sku = String(request.data?.sku ?? '').trim();
    const name = String(request.data?.name ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (!sku) {
      throw new HttpsError('invalid-argument', 'sku is required.');
    }

    try {
      await recordCatalogBinLabelPrint(productId, sku, name);
      return { ok: true, productId, sku, name: name || null };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not record bin label print.');
    }
  },
);

/** Firestore-only model / approval / spare group — no Zoho (works while Zoho is rate-limited). */
export const updateCatalogProductOverlays = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }

    const hasModel = 'modelNumber' in (request.data ?? {});
    const hasApproval = 'approvalNumber' in (request.data ?? {});
    const hasSpareGroup = 'spareGroupId' in (request.data ?? {});
    if (!hasModel && !hasApproval && !hasSpareGroup) {
      throw new HttpsError(
        'invalid-argument',
        'modelNumber, approvalNumber, or spareGroupId is required.',
      );
    }

    try {
      const saved = await mutateCatalogProductOverlays(productId, {
        ...(hasModel ? { modelNumber: request.data.modelNumber } : {}),
        ...(hasApproval ? { approvalNumber: request.data.approvalNumber } : {}),
        ...(hasSpareGroup ? { spareGroupId: request.data.spareGroupId } : {}),
      });
      return { ok: true, ...saved };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not update product overlays.');
    }
  },
);

/** Hide/unhide a product from dealer/public catalogue — super admin only (Firestore). */
export const setCatalogProductHidden = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }
    if (typeof request.data?.hidden !== 'boolean') {
      throw new HttpsError('invalid-argument', 'hidden must be a boolean.');
    }

    try {
      const saved = await mutateCatalogProductCatalogVisibility(
        productId,
        request.data.hidden,
        request.auth?.uid ?? null,
      );
      return { ok: true, ...saved };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not update catalogue visibility.');
    }
  },
);

/**
 * Assign (or clear) spareGroupId on many spare catalog products.
 * Staff / super_admin. Validates group id against Product settings when non-null.
 */
export const assignCatalogSpareGroups = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const productIds = Array.isArray(request.data?.productIds)
      ? [...new Set(
        request.data.productIds
          .map(id => String(id ?? '').trim())
          .filter(Boolean),
      )]
      : [];
    if (!productIds.length) {
      throw new HttpsError('invalid-argument', 'productIds is required.');
    }
    if (productIds.length > 200) {
      throw new HttpsError('invalid-argument', 'Assign at most 200 spares at a time.');
    }

    const rawGroup = request.data?.spareGroupId;
    const spareGroupId = rawGroup == null || rawGroup === ''
      ? null
      : String(rawGroup).trim() || null;

    if (spareGroupId) {
      const settingsSnap = await getFirestore()
        .collection('appSettings')
        .doc('productSettings')
        .get();
      const groups = Array.isArray(settingsSnap.data()?.spareGroups)
        ? settingsSnap.data().spareGroups
        : [];
      const known = new Set(
        groups
          .map(g => String(g?.id ?? '').trim())
          .filter(Boolean),
      );
      if (!known.has(spareGroupId)) {
        throw new HttpsError('invalid-argument', 'Unknown spare group.');
      }
    }

    try {
      let updated = 0;
      for (const productId of productIds) {
        await mutateCatalogProductOverlays(productId, { spareGroupId });
        updated += 1;
      }
      return { ok: true, updated, spareGroupId };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not assign spare groups.');
    }
  },
);

/**
 * Apply all Invalid-chars SKU repairs: sanitize to 0-9A-Z, uniquify with 2/3/…,
 * push each to Zoho, then mirror Firestore. Super admin only.
 */
export const applyCatalogSkuRepairs = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await applyAllSkuRepairs(accessToken, organizationId);
    } catch (err) {
      console.error('applyCatalogSkuRepairs failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not apply SKU repairs.');
    }
  },
);

/** Bulk SKU updates from CSV upload — super admin only. */
export const applyBulkCatalogSkuUpdatesFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const updates = request.data?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new HttpsError('invalid-argument', 'updates array is required.');
    }

    const secrets = zohoSecrets();
    const accessToken = await getAccessToken(secrets);
    const organizationId = await resolveOrganizationId(accessToken, zohoOrganizationId.value());

    try {
      return await applyBulkCatalogSkuUpdates(accessToken, organizationId, updates);
    } catch (err) {
      console.error('applyBulkCatalogSkuUpdatesFn failed:', err);
      const message = err?.message ?? 'Could not apply bulk SKU updates.';
      if (/invalid|required|at most/i.test(message)) {
        throw new HttpsError('invalid-argument', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/** Update master carton / single box packaging — Firestore only, not synced to Zoho. */
export const updateCatalogProductPackageInfo = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SYNC_ROLES);

    const productId = String(request.data?.productId ?? '').trim();
    if (!productId) {
      throw new HttpsError('invalid-argument', 'productId is required.');
    }

    const userSnap = uid ? await getFirestore().doc(`users/${uid}`).get() : null;
    const displayName = userSnap?.exists
      ? String(userSnap.data()?.displayName ?? userSnap.data()?.name ?? '').trim() || null
      : null;

    try {
      const saved = await patchProductPackageInfo(
        productId,
        {
          masterCarton: request.data?.masterCarton ?? null,
          singleBox: request.data?.singleBox ?? null,
        },
        { uid: uid ?? null, displayName },
      );
      return { ok: true, packageInfo: saved };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not save package information.');
    }
  },
);

/** Record a product-level inventory audit snapshot (live Zoho + warehouse counts). */
export const recordCatalogProductAudit = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SYNC_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    const trigger = String(request.data?.trigger ?? 'manual').trim();
    const auditCycleId = String(request.data?.auditCycleId ?? '').trim() || null;

    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }
    if (!['warehouse_count', 'cochin_inventory', 'manual'].includes(trigger)) {
      throw new HttpsError('invalid-argument', 'Invalid audit trigger.');
    }

    const userSnap = uid ? await getFirestore().doc(`users/${uid}`).get() : null;
    const displayName = userSnap?.exists
      ? String(userSnap.data()?.displayName ?? userSnap.data()?.name ?? '').trim() || null
      : null;

    try {
      const result = await persistCatalogProductAudit(
        zohoSecrets(),
        zohoOrganizationId.value(),
        catalogProductId,
        { trigger, auditCycleId, editor: { uid: uid ?? null, displayName } },
      );
      return result;
    } catch (err) {
      if (err?.code === 'failed-precondition') {
        throw new HttpsError('failed-precondition', err.message);
      }
      throw new HttpsError('internal', err?.message ?? 'Could not record product audit.');
    }
  },
);

/** List audit history for a catalog product. */
export const getCatalogProductAuditLogs = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    const max = Number(request.data?.max ?? 20);

    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }

    try {
      const logs = await listCatalogProductAuditLogs(catalogProductId, max);
      return { logs };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not load audit history.');
    }
  },
);

/** Zoho stock movements — lifetime ledger or up to a datetime (audit popup). */
export const getCatalogProductStockMovements = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    const until = String(request.data?.until ?? '').trim();
    const lifetime = Boolean(request.data?.lifetime) || !until;

    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }
    if (!lifetime && Number.isNaN(Date.parse(until))) {
      throw new HttpsError('invalid-argument', 'until must be a valid ISO datetime.');
    }

    try {
      const {
        listCatalogProductStockMovements,
        getLifetimeStockMovements,
      } = await import('./lib/zoho-stock-movements.js');

      if (lifetime) {
        return await getLifetimeStockMovements(
          zohoSecrets(),
          zohoOrganizationId.value(),
          catalogProductId,
        );
      }

      return await listCatalogProductStockMovements(
        zohoSecrets(),
        zohoOrganizationId.value(),
        catalogProductId,
        until,
      );
    } catch (err) {
      console.error('getCatalogProductStockMovements failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not load stock movements.');
    }
  },
);

/**
 * Move Zoho stock between Cochin and Head Office.
 * Updates catalog product warehouses[] only — never auditSnapshot / auditLogs.
 */
export const transferCatalogProductWarehouseStock = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    const toWarehouseName = String(request.data?.toWarehouseName ?? '').trim();
    const quantityRaw = request.data?.quantity;
    const quantity = quantityRaw == null || quantityRaw === ''
      ? null
      : Number(quantityRaw);

    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }
    if (!toWarehouseName) {
      throw new HttpsError('invalid-argument', 'toWarehouseName is required.');
    }
    if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) {
      throw new HttpsError('invalid-argument', 'quantity must be a positive number.');
    }

    try {
      return await persistWarehouseTransfer(
        zohoSecrets(),
        zohoOrganizationId.value(),
        { catalogProductId, toWarehouseName, quantity },
      );
    } catch (err) {
      if (err?.code === 'failed-precondition') {
        throw new HttpsError('failed-precondition', err.message);
      }
      console.error('transferCatalogProductWarehouseStock failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not transfer warehouse stock.');
    }
  },
);

/** Migrate existing warehouse + Cochin counts into audit snapshots (idempotent). */
export const backfillCatalogProductAuditsFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const dryRun = Boolean(request.data?.dryRun);
    const onlyMissing = request.data?.onlyMissing !== false;

    try {
      return await backfillLegacyCatalogProductAudits({ dryRun, onlyMissing });
    } catch (err) {
      console.error('backfillCatalogProductAudits failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Audit backfill failed.');
    }
  },
);

/** Create open Initial cycles + stamp existing audits into them (idempotent). */
export const migrateAuditsIntoCyclesFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const dryRun = Boolean(request.data?.dryRun);
    const force = Boolean(request.data?.force);

    try {
      return await migrateExistingAuditsIntoCycles({ dryRun, force });
    } catch (err) {
      console.error('migrateAuditsIntoCycles failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Audit cycle migration failed.');
    }
  },
);

/** Push linked warehouse audit photos (2 per bin) to Zoho item images — super admin only. */
export const syncCatalogAuditImagesToZoho = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }

    try {
      return await syncLinkedAuditPhotosToZoho(
        catalogProductId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not sync audit photos to Zoho.');
    }
  },
);

/** Remove orphaned audit photos from Zoho after warehouse bins are unlinked — super admin only. */
export const reconcileCatalogAuditImagesOnZoho = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const catalogProductId = String(request.data?.catalogProductId ?? '').trim();
    if (!catalogProductId) {
      throw new HttpsError('invalid-argument', 'catalogProductId is required.');
    }

    try {
      return await reconcileLinkedAuditPhotosOnZoho(
        catalogProductId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not reconcile audit photos on Zoho.');
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

    await mutateCatalogProductCategory(accessToken, organizationId, productId, categoryId, categoryName);

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
      const message = err?.message ?? 'Zoho customer sync failed.';
      if (
        err?.code === 'RATE_LIMITED'
        || err?.dailyQuota
        || /rate.?limit|too many requests|maximum call rate limit|10,?000/i.test(message)
      ) {
        throw new HttpsError(
          'resource-exhausted',
          err?.dailyQuota || /maximum call rate limit|10,?000/i.test(message)
            ? 'Zoho daily API limit (10,000 calls) has been reached for this organization. Wait until the quota resets, then try Sync again. You can check usage under Admin → Invoice Sync.'
            : 'Zoho is temporarily rate-limited. Wait a few minutes, then try Sync again.',
        );
      }
      throw new HttpsError('internal', message);
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
        request.data ?? {},
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
    const dealerId = String(request.data?.dealerId ?? '').trim();
    if (!dealerId) {
      throw new HttpsError('invalid-argument', 'Select which dealer account to use.');
    }
    try {
      return await dispatchDealerLoginOtp(phone, dealerId, watiToken.value(), watiEndpoint.value());
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
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
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

/** Append a support conversation message — Admin SDK bypasses client Firestore rules. */
export const appendSupportMessageFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await appendSupportMessage(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not send message.');
    }
  },
);

/** Mark support messages delivered or read (WhatsApp-style receipts). */
export const markSupportMessageReceiptsFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 30, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await markSupportMessageReceipts(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update message receipts.');
    }
  },
);

/** Direct support evidence upload via Admin SDK (photos and shorter videos). */
export const uploadSupportAttachmentFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await uploadSupportAttachment(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload attachment.');
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

/** YesStore warehouse photo upload — Admin SDK, isolated from HR/support Storage rules. */
export const uploadYesStorePhotoFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await uploadYesStorePhoto(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload warehouse photo.');
    }
  },
);

/** Logistics package photo upload — Admin SDK (avoids client Storage rule 403s). */
export const uploadLogisticsPhotoFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await storeLogisticsPhoto(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload logistics photo.');
    }
  },
);

/** Durable read URL for logistics photos — Admin SDK token (avoids client Storage read 403s). */
export const getLogisticsPhotoUrlFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await getLogisticsPhotoUrl(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load logistics photo.');
    }
  },
);

/**
 * Public short link for shipping-label “VIEW PACKAGE CONTENTS” QR.
 * Hosting rewrite: GET /lp/{bookingId}/{boxIndex} → 302 to Storage token URL.
 */
export const redirectLogisticsPackagePhoto = onRequest(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const path = String(req.path || req.url || '');
      const match = path.match(/\/lp\/([^/]+)\/([^/?#]+)/i)
        || path.match(/\/([^/]+)\/([^/?#]+)/);
      if (!match) {
        res.status(404).type('html').send(
          '<!doctype html><title>Not found</title><p>Package photo link is invalid.</p>',
        );
        return;
      }

      const { url } = await getPublicLogisticsInsidePhotoUrl(match[1], match[2]);
      res.set('Cache-Control', 'public, max-age=300');
      res.redirect(302, url);
    } catch (err) {
      const code = err instanceof HttpsError ? err.code : 'internal';
      const status = code === 'not-found' || code === 'invalid-argument' ? 404 : 500;
      console.error('redirectLogisticsPackagePhoto failed:', err);
      res.status(status).type('html').send(
        '<!doctype html><title>Photo unavailable</title><p>Package photo is not available.</p>',
      );
    }
  },
);

/**
 * Promote same-day shipped bookings to in_transit after 7 PM IST.
 * Runs every 30 minutes; catches late same-day confirms and any missed prior days.
 */
export const promoteShippedToInTransitScheduled = onSchedule(
  {
    schedule: '*/30 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const nowParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const part = (type) => nowParts.find(item => item.type === type)?.value ?? '';
    const todayYmd = `${part('year')}-${part('month')}-${part('day')}`;
    const hour = Number(part('hour')) || 0;

    const snap = await db.collection('logisticsBookings').where('status', '==', 'shipped').get();
    if (snap.empty) {
      console.log('promoteShippedToInTransit: no shipped bookings.');
      return;
    }

    const updatedAt = new Date().toISOString();
    let promoted = 0;
    let skipped = 0;
    const writers = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const bookingDate = String(data.bookingDate || '').slice(0, 10);
      const pastBookingDay = Boolean(bookingDate) && bookingDate < todayYmd;
      const sameDayAfterSeven = (!bookingDate || bookingDate === todayYmd) && hour >= 19;
      if (!pastBookingDay && !sameDayAfterSeven) {
        skipped += 1;
        continue;
      }
      writers.push(
        docSnap.ref.update({
          status: 'in_transit',
          updatedAt,
          inTransitAt: updatedAt,
        }),
      );
      promoted += 1;
    }

    if (writers.length) {
      await Promise.all(writers);
    }
    console.log(
      `promoteShippedToInTransit: promoted=${promoted}, skipped=${skipped}, checked=${snap.size} (IST ${todayYmd} ${hour}:00).`,
    );
  },
);

/** Catalog NC photo upload — Admin SDK (avoids client Storage rule 403s). */
export const uploadCatalogNcPhotoFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await storeCatalogNcPhoto(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload NC photo.');
    }
  },
);

/** Approval certificate PDF upload — Admin SDK (avoids client Storage rule 403s). */
export const uploadApprovalNumberPdfFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await storeApprovalNumberPdf(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload approval PDF.');
    }
  },
);

/** Remove PDF from an approval number (keeps the number). */
export const removeApprovalNumberPdfFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await clearApprovalNumberPdf(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not remove approval PDF.');
    }
  },
);

/** Delete an approval PDF object when removing the approval number row. */
export const deleteApprovalPdfObjectFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await deleteApprovalPdfObject(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete approval PDF.');
    }
  },
);

/** Delete a catalog NC photo from Storage. */
export const deleteCatalogNcPhotoFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await removeCatalogNcPhoto(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete NC photo.');
    }
  },
);

/** Catalog product media upload (images / PDF / video) — media + super admin. */
export const uploadCatalogMediaFileFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 180, memory: '512MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await storeCatalogMediaFile(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload media file.');
    }
  },
);

/** Delete a catalog media file from Storage. */
export const deleteCatalogMediaFileFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await removeCatalogMediaFile(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete media file.');
    }
  },
);

/** Signed read URL for YesStore photos in Storage. */
export const getYesStorePhotoUrlFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await getYesStorePhotoUrl(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load warehouse photo.');
    }
  },
);
