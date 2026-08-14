import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
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
import { effectiveCatalogStockStatus } from './lib/sac-catalog.js';
import {
  syncCatalogToFirestore,
  readCatalogFromFirestore,
  patchProductPackageInfo,
  readPackageInfo,
  saveCategoryOrder,
  saveCategoryProductOrder,
  saveCategoryWeighingScaleFlags,
  seedWeighingScaleCategoriesIfEmpty,
  uploadCategoryThumbnail,
  importProductImagesFromZoho,
  pushMissingCatalogProductImagesToZoho,
  recordCatalogBinLabelPrint,
  handleZohoItemWebhook,
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
import { syncCustomersToFirestore, handleZohoCustomerWebhook } from './lib/zoho-customers.js';
import {
  listDealers,
  exportDealersCsv,
  listAssignableStaffOptions,
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
  syncSingleInvoiceFromZoho,
  verifyZohoWebhookSignature,
  handleZohoInvoiceWebhook,
} from './lib/invoice-sync.js';
import { ensureInvoiceEwayBill, cancelInvoiceEwayBill } from './lib/invoice-ewaybill.js';
import {
  markInvoiceCustomerPickup,
  updateCustomerPickupEwayPartB,
} from './lib/invoice-customer-pickup.js';
import { markInvoiceDelivered } from './lib/invoice-manual-delivery.js';
import { listZohoTransporters, formatEwayBillPortalError } from './lib/zoho-ewaybills.js';
import { syncOrgInvoicesToFirestore } from './lib/org-invoice-sync.js';
import {
  backfillInvoiceCategoriesToProduct,
  reclassifyInvoiceCategoriesFromCatalog,
} from './lib/invoice-category.js';
import { backfillGatcReportsFromInvoices } from './lib/gatc-report.js';
import { upsertInvoicesFromCsv } from './lib/invoice-csv-upsert.js';
import {
  archiveOldInvoices,
  backfillInvoiceStatsAndSummaries,
  backfillInvoiceSummaryCustomerPickups,
} from './lib/invoice-stats.js';
import { backfillSalesOrderStats } from './lib/sales-order-stats.js';
import {
  analyzeDealerStaffLinking,
  assignNoUsableInvoiceDealers,
  backfillDealerAssignedStaff,
  claimUnassignedDealersForSalesperson,
  undoNoUsableInvoiceAssign,
  wipeLegacyKamData,
} from './lib/dealer-staff-assignment.js';
import {
  getZohoSalespersonHideImpact,
  listCachedZohoSalespersons,
  setZohoSalespersonHiddenFromPortal,
  syncZohoSalespersonsToFirestore,
} from './lib/zoho-salespersons.js';
import {
  syncOrgPurchaseOrdersToFirestore,
  reclassifyPurchaseOrderCategoriesFromCatalog,
  ensurePurchaseOrderPdf,
  handleZohoPurchaseOrderWebhook,
} from './lib/purchase-order-sync.js';
import {
  syncOrgGoodsReceiptsToFirestore,
  reclassifyGoodsReceiptCategoriesFromCatalog,
  ensureGoodsReceiptPdf,
  handleZohoGoodsReceiptWebhook,
} from './lib/goods-receipt-sync.js';
import {
  syncOrgSalesOrdersToFirestore,
  reclassifySalesOrderCategoriesFromCatalog,
  ensureSalesOrderPdf,
  listDealerSalesOrders as listDealerSalesOrderRecords,
  getDealerSalesOrderDetail as getDealerSalesOrderDetailRecord,
  ensureDealerSalesOrderPdf,
  syncDealerSalesOrdersToFirestore,
  handleZohoSalesOrderWebhook,
} from './lib/sales-order-sync.js';
import { lookupPincodeLocation } from './lib/location-utils.js';
import {
  normalizePhone10,
  lookupDealerForLogin,
  sendDealerLoginOtp as dispatchDealerLoginOtp,
  verifyDealerLoginOtp as validateDealerLoginOtp,
  completeDealerSignup as finalizeDealerSignup,
  completeDealerPasswordReset as finalizeDealerPasswordReset,
} from './lib/dealer-otp.js';
import { setManagedUserPassword as updateManagedUserPassword } from './lib/set-user-password.js';
import { prepareSupportAttachmentUpload, uploadSupportAttachment } from './lib/support-attachments.js';
import { appendSupportMessage } from './lib/support-messages.js';
import { markSupportMessageReceipts } from './lib/support-message-receipts.js';
import { raiseLogisticsIssueTicket as raiseLogisticsIssueTicketHandler } from './lib/raise-logistics-issue-ticket.js';
import {
  listDelhiveryBookingDocuments,
  ensureDelhiveryLrCopy,
  ensureDelhiveryShippingLabels,
  ensureDelhiveryPod,
  ensureDelhiveryDocumentImage,
  prefetchDelhiveryDocumentsForBooking,
  shouldPrefetchDelhiveryDocumentsOnWrite,
} from './lib/delhivery-b2b-documents.js';
import { getHrStaffFileUrl, uploadHrStaffFile } from './lib/hr-staff-upload.js';
import { getYesStorePhotoUrl, uploadYesStorePhoto } from './lib/yes-store-upload.js';
import {
  uploadLogisticsPhoto as storeLogisticsPhoto,
  getLogisticsPhotoUrl,
  getPublicLogisticsInsidePhotoUrl,
} from './lib/logistics-upload.js';
import {
  fetchStCourierTrack,
  renderStCourierTrackHtml,
} from './lib/st-courier-track.js';
import { fetchStCourierDeliveryOffice } from './lib/st-courier-pincode.js';
import { fillCourierDeliveryOfficeOnBooking } from './lib/st-courier-delivery-office-sync.js';
import {
  persistStCourierTrackOnBooking,
  syncStCourierTrackingForBookings,
} from './lib/st-courier-track-sync.js';
import {
  fetchTrackonTrack,
  renderTrackonTrackHtml,
} from './lib/trackon-track.js';
import {
  persistTrackonTrackOnBooking,
  syncTrackonTrackingForBookings,
} from './lib/trackon-track-sync.js';
import {
  loadDelhiveryB2bPublicConfig,
  saveDelhiveryB2bConfig,
  testDelhiveryB2bConnection,
} from './lib/delhivery-b2b.js';
import {
  bookDelhiveryB2bShipment,
  cancelDelhiveryB2bShipment,
  resolveDelhiveryPickupLocationName,
  resolveInvoiceFieldsForDelhiveryBook,
} from './lib/delhivery-b2b-manifest.js';
import { createDelhiveryPickupRequest } from './lib/delhivery-pickup.js';
import { resolveDelhiveryMasterAwbFromLrn } from './lib/delhivery-b2b-documents.js';
import { syncDelhiveryWarehouseForSite } from './lib/delhivery-warehouse.js';
import {
  fetchDelhiveryTrack,
  renderDelhiveryTrackHtml,
} from './lib/delhivery-track.js';
import {
  persistDelhiveryTrackOnBooking,
  syncDelhiveryFreightForBookings,
  syncDelhiveryTrackingForBookings,
} from './lib/delhivery-track-sync.js';
import {
  checkDelhiveryPincodeServiceability,
  fetchDelhiveryTat,
  quoteDelhiveryLane,
  fetchDelhiveryFreightCharges,
} from './lib/delhivery-quote.js';
import {
  submitDealerOrder as submitDealerOrderRecord,
  createStaffSalesOrder as createStaffSalesOrderRecord,
  confirmMirroredSalesOrder as confirmMirroredSalesOrderRecord,
  voidMirroredSalesOrder as voidMirroredSalesOrderRecord,
  purgeAllDealerOrders as purgeAllDealerOrdersRecord,
} from './lib/dealer-orders.js';
import { getPendingFreightDiffPreview } from './lib/freight-diff-settlement.js';
import {
  updateDraftSalesOrderLines as updateDraftSalesOrderLinesRecord,
  updateDraftSalesOrderShipping as updateDraftSalesOrderShippingRecord,
  markSalesOrderReadyForPayment as markSalesOrderReadyForPaymentRecord,
  markSalesOrderInvoicedManually as markSalesOrderInvoicedManuallyRecord,
  repairSalesOrderInvoicingMismatch as repairSalesOrderInvoicingMismatchRecord,
  uploadSalesOrderPaymentScreenshot as uploadSalesOrderPaymentScreenshotRecord,
  submitSalesOrderPayment as submitSalesOrderPaymentRecord,
  verifySalesOrderPayment as verifySalesOrderPaymentRecord,
  applySalesOrderSalespersonFromDealer as applySalesOrderSalespersonFromDealerRecord,
  applySalesOrderSalespersonFromStaff as applySalesOrderSalespersonFromStaffRecord,
  backfillOpenSalesOrdersSalespersonForCustomer as backfillOpenSalesOrdersSalespersonForCustomerRecord,
  voidSalesOrderWithWorkflow as voidSalesOrderWithWorkflowRecord,
  deleteDraftSalesOrder as deleteDraftSalesOrderRecord,
} from './lib/sales-order-workflow.js';
import {
  listAddressesForUser as listAddressesForUserRecord,
  addAddressForUser as addAddressForUserRecord,
  updateAddressForUser as updateAddressForUserRecord,
  deleteAddressForUser as deleteAddressForUserRecord,
  listContactAddressesForCustomer as listContactAddressesForCustomerRecord,
  addContactAddress as addContactAddressRecord,
  updateContactAddress as updateContactAddressRecord,
  deleteContactAddress as deleteContactAddressRecord,
} from './lib/zoho-contact-addresses.js';
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
import { fetchBlueDartDieselFuelSurcharge } from './lib/blue-dart-diesel-fuel.js';
import { fetchBlueDartAirSurcharges } from './lib/blue-dart-air-surcharges.js';
import { updatePublicSalaryShare as updatePublicSalaryShareRecord } from './lib/hr-salary-share-update.js';
import { switchPublicSalarySharePeriod as switchPublicSalarySharePeriodRecord } from './lib/hr-salary-share-switch-period.js';
import {
  fetchGatcVerificationEmbedSrc,
  GATC_VERIFICATION_EMBED_URL,
} from './lib/gatc-verification-embed.js';
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
const yesweighEmbedSecret = defineString('YESWEIGH_EMBED_SECRET', { default: '' });

const ALLOWED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin', 'media']);
const SYNC_ROLES = new Set(['staff', 'super_admin']);
const CATALOG_IMAGE_ROLES = new Set(['staff', 'super_admin', 'media']);
const SUPER_ADMIN_ROLES = new Set(['super_admin']);
const DEALER_INVOICE_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);
const GATC_EMBED_ROLES = new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']);

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

async function requireActiveUser(uid, allowedRoles = ALLOWED_ROLES, options = {}) {
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

  const data = userSnap.data() || {};
  // View-only super admins may browse the app / read callables, but not mutate.
  if (
    role === 'super_admin'
    && data.superAdminAccess === 'view_only'
    && options.allowViewOnly !== true
  ) {
    throw new HttpsError(
      'permission-denied',
      'Your account is view-only and cannot make changes.',
    );
  }

  return role;
}

const LOGISTICS_DEFAULT_STAFF_PERMS = new Set([
  'orders.view',
  'orders.manage',
  'support.view',
  'support.return',
  'invoices.view',
  'logistics.view',
  'loyalty.view',
  'catalog.view',
]);

const ADMIN_DEFAULT_STAFF_PERMS = new Set(['orders.view', 'orders.manage']);

function staffHasPermissionFromUserData(role, data, permission) {
  if (role === 'super_admin') return true;
  if (role !== 'staff') return false;
  const mode = String(data?.staffAccessMode ?? 'role');
  const perms = Array.isArray(data?.staffPermissions)
    ? data.staffPermissions.map(String)
    : [];
  if ((mode === 'custom' || mode === 'role') && perms.length > 0) {
    return perms.includes(permission);
  }
  const dept = String(data?.staffDepartment ?? 'admin');
  if (dept === 'admin') return true;
  if (dept === 'logistics') return LOGISTICS_DEFAULT_STAFF_PERMS.has(permission);
  return ADMIN_DEFAULT_STAFF_PERMS.has(permission);
}

async function requireAdminInvoiceDocumentAccess(uid) {
  const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']), { allowViewOnly: true });
  if (role !== 'staff') return role;

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  if (!staffHasPermissionFromUserData(role, userSnap.data() || {}, 'invoices.view')) {
    throw new HttpsError('permission-denied', 'You do not have permission to view invoices.');
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
        stockStatus: effectiveCatalogStockStatus(
          cachedData.stockStatus ?? getStockStatus(stock, reorderLevel, cachedData.hsn),
          cachedData.hsn,
        ),
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
      if (Array.isArray(cachedData.gatcStampingPriceIds)) {
        detail.gatcStampingPriceIds = [
          ...new Set(
            cachedData.gatcStampingPriceIds
              .map(id => String(id ?? '').trim())
              .filter(Boolean),
          ),
        ];
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
      if (Number.isFinite(Number(cachedData.ledgerClosingStock))) {
        detail.ledgerClosingStock = Number(cachedData.ledgerClosingStock);
      }
      if (typeof cachedData.ledgerClosingStockAt === 'string' && cachedData.ledgerClosingStockAt.trim()) {
        detail.ledgerClosingStockAt = cachedData.ledgerClosingStockAt.trim();
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
      `Scheduled catalog sync: wrote ${result.syncedCount}, skipped ${result.skippedCount ?? 0} unchanged, ${result.categoryCount} categories (${result.categorizedProductCount} categorized).`,
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

/** Save weighing-scale category flags — staff / super admin only. */
export const saveCatalogCategoryWeighingScaleFlags = onCall(
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

    const payload = categories.map(cat => ({
      id: String(cat?.id ?? '').trim(),
      isWeighingScale: Boolean(cat?.isWeighingScale),
    })).filter(cat => cat.id);

    if (!payload.length) {
      throw new HttpsError('invalid-argument', 'No valid categories provided.');
    }

    try {
      return await saveCategoryWeighingScaleFlags(payload);
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not save weighing-scale flags.');
    }
  },
);

/** One-shot seed of default weighing-scale categories when none are flagged. */
export const seedCatalogWeighingScaleCategories = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    try {
      return await seedWeighingScaleCategoriesIfEmpty();
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not seed weighing-scale categories.');
    }
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
    const hasGatc = 'gatcStampingPriceIds' in (request.data ?? {});
    if (!hasModel && !hasApproval && !hasSpareGroup && !hasGatc) {
      throw new HttpsError(
        'invalid-argument',
        'modelNumber, approvalNumber, spareGroupId, or gatcStampingPriceIds is required.',
      );
    }

    try {
      const saved = await mutateCatalogProductOverlays(productId, {
        ...(hasModel ? { modelNumber: request.data.modelNumber } : {}),
        ...(hasApproval ? { approvalNumber: request.data.approvalNumber } : {}),
        ...(hasSpareGroup ? { spareGroupId: request.data.spareGroupId } : {}),
        ...(hasGatc ? { gatcStampingPriceIds: request.data.gatcStampingPriceIds } : {}),
      });
      return { ok: true, ...saved };
    } catch (err) {
      throw new HttpsError('internal', err?.message ?? 'Could not update product overlays.');
    }
  },
);

/** Rename a model number in Product settings and on assigned catalog products. Super admin only. */
export const renameCatalogModelNumber = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);

    const fromValue = String(request.data?.from ?? '').trim();
    const toValue = String(request.data?.to ?? '').trim();
    if (!fromValue || !toValue) {
      throw new HttpsError('invalid-argument', 'from and to are required.');
    }

    const db = getFirestore();
    const settingsRef = db.collection('appSettings').doc('productSettings');
    const settingsSnap = await settingsRef.get();
    const raw = Array.isArray(settingsSnap.data()?.modelNumbers)
      ? settingsSnap.data().modelNumbers
        .map(value => String(value ?? '').trim())
        .filter(Boolean)
      : [];

    if (!raw.includes(fromValue)) {
      throw new HttpsError('not-found', 'Model number is not in the settings list.');
    }
    if (
      raw.some(
        value => value !== fromValue && value.toLowerCase() === toValue.toLowerCase(),
      )
    ) {
      throw new HttpsError('invalid-argument', 'That model number already exists.');
    }

    const modelNumbers = [...new Set(
      raw.map(value => (value === fromValue ? toValue : value)),
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    let productsUpdated = 0;
    if (fromValue !== toValue) {
      const productsSnap = await db.collection('catalogProducts')
        .where('modelNumber', '==', fromValue)
        .get();
      for (const productDoc of productsSnap.docs) {
        await mutateCatalogProductOverlays(productDoc.id, { modelNumber: toValue });
        productsUpdated += 1;
      }
    }

    await settingsRef.set({
      modelNumbers,
      updatedAt: new Date().toISOString(),
      ...(request.auth?.uid ? { updatedBy: request.auth.uid } : {}),
    }, { merge: true });

    return { ok: true, modelNumbers, productsUpdated };
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
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });

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
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
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
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
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
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
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

/** Download invoice PDF for ops (any dealer customer). Super admin or staff with invoices.view. */
export const downloadAdminInvoiceDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireAdminInvoiceDocumentAccess(request.auth?.uid);
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

/** Generate or fetch cached e-way bill PDF for a linked invoice (logistics). */
export const ensureInvoiceEwayBillFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const partnerId = String(request.data?.partnerId ?? '').trim();
    const lrNumber = String(request.data?.lrNumber ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const autoGenerate = request.data?.autoGenerate !== false;
    if (!customerId || !invoiceId) {
      throw new HttpsError('invalid-argument', 'Customer id and invoice id are required.');
    }
    try {
      return await ensureInvoiceEwayBill(zohoSecrets(), zohoOrganizationId.value(), {
        customerId,
        invoiceId,
        partnerId: partnerId || null,
        lrNumber: lrNumber || null,
        bookingId: bookingId || null,
        autoGenerate,
        invoiceTotalInr: request.data?.invoiceTotalInr ?? null,
        forceRequired: request.data?.forceRequired === true,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const message = formatEwayBillPortalError(err?.message ?? 'Could not ensure e-way bill.');
      const code = /not configured|not linked|not required|not found|cancelled|Distance \(km\)|Ship-from|API access|GST|e-way|IRN|dispatch|transporter|pincode/i.test(message)
        ? 'failed-precondition'
        : 'internal';
      throw new HttpsError(code, message);
    }
  },
);

/** List Zoho e-way transporters for logistics partner settings. */
export const listZohoEwayTransportersFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    try {
      const accessToken = await getAccessToken(zohoSecrets());
      const orgId = zohoOrganizationId.value();
      const transporters = await listZohoTransporters(accessToken, orgId);
      return { transporters };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load Zoho transporters.');
    }
  },
);

/** Cancel a generated e-way bill on the GST portal (ops). */
export const cancelInvoiceEwayBillFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const reason = String(request.data?.reason ?? '').trim();
    const remarks = String(request.data?.remarks ?? '').trim();
    if (!customerId || !invoiceId) {
      throw new HttpsError('invalid-argument', 'Customer id and invoice id are required.');
    }
    if (!reason) {
      throw new HttpsError('invalid-argument', 'Cancellation reason is required.');
    }
    try {
      return await cancelInvoiceEwayBill(zohoSecrets(), zohoOrganizationId.value(), {
        customerId,
        invoiceId,
        bookingId: bookingId || null,
        reason,
        remarks: remarks || null,
        localOnly: request.data?.localOnly === true,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not cancel e-way bill.');
    }
  },
);

/** Mark invoice as customer pickup (no logistics booking); e-way Part B when eligible. */
export const markInvoiceCustomerPickupFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SYNC_ROLES);
    const userSnap = await getFirestore().doc(`users/${uid}`).get();
    const userData = userSnap.data() ?? {};
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const shipFromSite = String(request.data?.shipFromSite ?? 'cochin').trim() || 'cochin';
    const vehicleNumber = String(request.data?.vehicleNumber ?? '').trim();
    if (!customerId || !invoiceId) {
      throw new HttpsError('invalid-argument', 'Customer id and invoice id are required.');
    }
    try {
      return await markInvoiceCustomerPickup(zohoSecrets(), zohoOrganizationId.value(), {
        customerId,
        invoiceId,
        shipFromSite,
        vehicleNumber: vehicleNumber || null,
        markedByUid: uid,
        markedByName: String(userData.displayName ?? userData.loginId ?? userData.email ?? 'YESWEIGH').trim(),
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const message = formatEwayBillPortalError(err?.message ?? 'Could not mark customer pickup.');
      const code = /already|required|not found|missing|vehicle|Ship-from|transporter|API access|GST|e-way|IRN|dispatch/i.test(message)
        ? 'failed-precondition'
        : 'internal';
      throw new HttpsError(code, message);
    }
  },
);

/** Mark invoice delivered from the invoice screen (optional linked logistics booking). */
export const markInvoiceDeliveredFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SYNC_ROLES);
    const userSnap = await getFirestore().doc(`users/${uid}`).get();
    const userData = userSnap.data() ?? {};
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    if (!customerId || !invoiceId) {
      throw new HttpsError('invalid-argument', 'Customer id and invoice id are required.');
    }
    try {
      return await markInvoiceDelivered({
        customerId,
        invoiceId,
        markedByUid: uid,
        markedByName: String(userData.displayName ?? userData.loginId ?? userData.email ?? 'YESWEIGH').trim(),
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const message = err?.message ?? 'Could not mark invoice delivered.';
      const code = /already|void|returned|not found|required/i.test(message)
        ? 'failed-precondition'
        : 'internal';
      throw new HttpsError(code, message);
    }
  },
);

/** Update e-way bill Part B vehicle on customer-pickup invoice. */
export const updateCustomerPickupEwayPartBFn = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const customerId = String(request.data?.customerId ?? '').trim();
    const invoiceId = String(request.data?.invoiceId ?? '').trim();
    const vehicleNumber = String(request.data?.vehicleNumber ?? '').trim();
    if (!customerId || !invoiceId || !vehicleNumber) {
      throw new HttpsError(
        'invalid-argument',
        'Customer id, invoice id, and vehicle number are required.',
      );
    }
    try {
      return await updateCustomerPickupEwayPartB(zohoSecrets(), zohoOrganizationId.value(), {
        customerId,
        invoiceId,
        vehicleNumber,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const message = formatEwayBillPortalError(err?.message ?? 'Could not update e-way bill Part B.');
      const code = /not found|missing|required|Ship-from|transporter|pincode|API access|GST|e-way|IRN|dispatch|cancel/i.test(message)
        ? 'failed-precondition'
        : 'internal';
      throw new HttpsError(code, message);
    }
  },
);

/** List dealer invoices from Firestore mirror (fast, no Zoho rate limits). */
export const getDealerInvoices = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
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

/** Zoho Sales Order webhook — create/edit/delete mirror in Firestore. */
export const zohoSalesOrderWebhook = onRequest(
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
      console.warn('Zoho sales order webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoSalesOrderWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho sales order webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/** Zoho Purchase Order webhook — create/edit/delete mirror in Firestore. */
export const zohoPurchaseOrderWebhook = onRequest(
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
      console.warn('Zoho purchase order webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoPurchaseOrderWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho purchase order webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/** Zoho Purchase Bill webhook — draft bills mirrored as goods receipts. */
export const zohoGoodsReceiptWebhook = onRequest(
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
      console.warn('Zoho goods receipt webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoGoodsReceiptWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho goods receipt webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/** Zoho Item webhook — create/edit/delete catalogProducts mirror. */
export const zohoItemWebhook = onRequest(
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
      console.warn('Zoho item webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoItemWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho item webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/** Zoho Customer webhook — create/edit/soft-delete zohoCustomers mirror. */
export const zohoCustomerWebhook = onRequest(
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
      console.warn('Zoho customer webhook rejected: invalid signature.');
      res.status(401).send('Invalid signature');
      return;
    }
    if (!secret) {
      console.warn('ZOHO_WEBHOOK_SECRET not set — accepting webhook without signature verification.');
    }

    try {
      const result = await handleZohoCustomerWebhook(
        zohoSecrets(),
        zohoOrganizationId.value(),
        req,
      );
      res.status(result.status).json(result);
    } catch (err) {
      console.error('Zoho customer webhook failed:', err);
      res.status(500).json({ ok: false, message: err?.message ?? 'Webhook processing failed.' });
    }
  },
);

/**
 * Nightly org sync safety net if webhooks miss updates.
 * Invoices 2 AM IST, POs 3 AM, SOs 4 AM — each uses at most 70% of daily Zoho quota.
 */
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

export const syncZohoPurchaseOrdersScheduled = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 1800,
    memory: '2GiB',
  },
  async () => {
    try {
      const result = await syncOrgPurchaseOrdersToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          source: 'scheduled',
          quotaReserveRatio: 0.30,
        },
      );
      console.log(
        `Scheduled org PO sync: status=${result.status}, newlyPulled=${result.newlyPulled}, `
        + `failed=${result.failedCount}, remaining=${result.remaining}, rateLimited=${result.rateLimited}, `
        + `quotaReserved=${result.quotaReserved}.`,
      );
    } catch (err) {
      console.error('Scheduled org PO sync failed:', err?.message ?? err);
    }
  },
);

/** Nightly draft purchase bills → goodsReceipts (4:30 AM IST, after POs). */
export const syncZohoGoodsReceiptsScheduled = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 1800,
    memory: '2GiB',
  },
  async () => {
    try {
      const result = await syncOrgGoodsReceiptsToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          source: 'scheduled',
          quotaReserveRatio: 0.30,
        },
      );
      console.log(
        `Scheduled org goods receipt sync: status=${result.status}, newlyPulled=${result.newlyPulled}, `
        + `failed=${result.failedCount}, remaining=${result.remaining}, rateLimited=${result.rateLimited}, `
        + `quotaReserved=${result.quotaReserved}.`,
      );
    } catch (err) {
      console.error('Scheduled org goods receipt sync failed:', err?.message ?? err);
    }
  },
);

export const syncZohoSalesOrdersScheduled = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 1800,
    memory: '2GiB',
  },
  async () => {
    try {
      const result = await syncOrgSalesOrdersToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          source: 'scheduled',
          quotaReserveRatio: 0.30,
        },
      );
      console.log(
        `Scheduled org SO sync: status=${result.status}, newlyPulled=${result.newlyPulled}, `
        + `failed=${result.failedCount}, remaining=${result.remaining}, rateLimited=${result.rateLimited}, `
        + `quotaReserved=${result.quotaReserved}.`,
      );
    } catch (err) {
      console.error('Scheduled org SO sync failed:', err?.message ?? err);
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

/**
 * Reclassify existing invoices from lineItems.itemId → catalogProducts (HSN/category).
 * No Zoho calls. Alias kept for older clients.
 */
export const reclassifyInvoiceCategoriesFromCatalogFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await reclassifyInvoiceCategoriesFromCatalog({
        onlyMissing: request.data?.onlyMissing === true,
      });
    } catch (err) {
      console.error('reclassifyInvoiceCategoriesFromCatalog failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice category reclassify failed.');
    }
  },
);

/**
 * Bulk upsert invoices from a parsed CSV payload (no Zoho API).
 * Super admin only. Client sends batches of ≤100 invoices.
 */
export const upsertInvoicesFromCsvFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await upsertInvoicesFromCsv({
        invoices: request.data?.invoices,
      });
    } catch (err) {
      console.error('upsertInvoicesFromCsvFn failed:', err);
      const message = err?.message ?? 'Invoice CSV upsert failed.';
      if (/required|at most|invalid/i.test(message)) {
        throw new HttpsError('invalid-argument', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/**
 * Rebuild invoiceStats + invoiceSummaries from hot invoices (one-shot / rare).
 * Sets invoiceStats/config.listSource = summaries when done.
 */
export const backfillInvoiceStatsAndSummariesFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillInvoiceStatsAndSummaries();
    } catch (err) {
      console.error('backfillInvoiceStatsAndSummaries failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice stats backfill failed.');
    }
  },
);

/** Copy customerPickup from invoices onto invoiceSummaries (admin list source). */
export const backfillInvoiceSummaryCustomerPickupsFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillInvoiceSummaryCustomerPickups();
    } catch (err) {
      console.error('backfillInvoiceSummaryCustomerPickups failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Customer pickup summary backfill failed.');
    }
  },
);

/**
 * Rebuild gatcReports from portal SOs with zohoInvoiceId + stamping,
 * then invoices that still carry salesOrderId. Super admin only.
 */
export const backfillGatcReportsFromInvoicesFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillGatcReportsFromInvoices({
        dryRun: Boolean(request.data?.dryRun),
      });
    } catch (err) {
      console.error('backfillGatcReportsFromInvoices failed:', err);
      throw new HttpsError('internal', err?.message ?? 'GATC report backfill failed.');
    }
  },
);

/**
 * Rebuild salesOrderStats + salesOrderMonthStats + salesOrderDealerStats (one-shot / rare).
 */
export const backfillSalesOrderStatsFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillSalesOrderStats();
    } catch (err) {
      console.error('backfillSalesOrderStats failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Sales order stats backfill failed.');
    }
  },
);

/**
 * Assign dealers to portal staff from latest usable invoice salespersonId.
 */
export const backfillDealerAssignedStaffFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillDealerAssignedStaff({
        dryRun: Boolean(request.data?.dryRun),
        onlyFillUnassigned: Boolean(request.data?.onlyFillUnassigned),
      });
    } catch (err) {
      console.error('backfillDealerAssignedStaff failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Dealer staff assignment backfill failed.');
    }
  },
);

/**
 * Super-admin Dealers tab: salesperson unlocks + dealers with no usable invoice.
 */
export const analyzeDealerStaffLinkingFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await analyzeDealerStaffLinking({
        runByUid: request.auth?.uid || null,
      });
    } catch (err) {
      console.error('analyzeDealerStaffLinking failed:', err);
      try {
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        await getFirestore().doc('appSettings/dealerStaffLinkingCheck').set({
          status: 'error',
          errorMessage: err?.message ?? 'Dealer staff linking analysis failed.',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch {
        // ignore secondary write failure
      }
      throw new HttpsError('internal', err?.message ?? 'Dealer staff linking analysis failed.');
    }
  },
);

/**
 * Claim unassigned dealers for one Zoho salesperson onto a portal staff user.
 */
export const claimDealersBySalespersonFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '2GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await claimUnassignedDealersForSalesperson({
        zohoSalespersonId: request.data?.zohoSalespersonId,
        zohoSalespersonName: request.data?.zohoSalespersonName,
        staffUid: request.data?.staffUid,
      });
    } catch (err) {
      console.error('claimDealersBySalesperson failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not claim dealers for salesperson.');
    }
  },
);

/**
 * Assign selected "no usable invoice" dealers to a portal user (linking check tab).
 */
export const assignNoUsableInvoiceDealersFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await assignNoUsableInvoiceDealers({
        dealerIds: request.data?.dealerIds,
        staffUid: request.data?.staffUid,
      });
    } catch (err) {
      console.error('assignNoUsableInvoiceDealers failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not assign dealers.');
    }
  },
);

/**
 * Undo last no-usable-invoice assign batch from the linking check tab.
 */
export const undoNoUsableInvoiceAssignFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await undoNoUsableInvoiceAssign({
        dealers: request.data?.dealers,
        staffUid: request.data?.staffUid,
      });
    } catch (err) {
      console.error('undoNoUsableInvoiceAssign failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not undo dealer assignment.');
    }
  },
);

/**
 * Delete legacy kams collection and strip kamId / staffKamId fields.
 */
export const wipeLegacyKamDataFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await wipeLegacyKamData();
    } catch (err) {
      console.error('wipeLegacyKamData failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Legacy KAM wipe failed.');
    }
  },
);

/** Move invoices older than 24 months (default) into archive subcollections. */
export const archiveOldInvoicesFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await archiveOldInvoices({
        olderThanMonths: Number(request.data?.olderThanMonths) || undefined,
        maxDocs: Number(request.data?.maxDocs) || 500,
      });
    } catch (err) {
      console.error('archiveOldInvoices failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice archive failed.');
    }
  },
);

/** Scheduled monthly cold-archive of invoices older than 24 months. */
export const archiveOldInvoicesScheduled = onSchedule(
  {
    schedule: '0 3 1 * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const result = await archiveOldInvoices({ maxDocs: 2000 });
    console.log('archiveOldInvoicesScheduled:', result);
  },
);

/** List cached Zoho salespersons from Firestore (fast; super admin). */
export const listZohoSalespersons = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await listCachedZohoSalespersons();
    } catch (err) {
      console.error('listZohoSalespersons failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not load Zoho salespersons.');
    }
  },
);

/** Pull Zoho Inventory salespersons into Firestore cache (super admin). */
export const syncZohoSalespersons = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      const result = await syncZohoSalespersonsToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
      return {
        count: result.count,
        removed: result.removed,
        salespersons: result.salespersons,
      };
    } catch (err) {
      console.error('syncZohoSalespersons failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not sync Zoho salespersons.');
    }
  },
);

/** Preview dealer impact before hiding a Zoho salesperson. */
export const getZohoSalespersonHideImpactFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    const salespersonId = String(request.data?.salespersonId ?? '').trim();
    if (!salespersonId) {
      throw new HttpsError('invalid-argument', 'salespersonId is required.');
    }
    try {
      return await getZohoSalespersonHideImpact(salespersonId);
    } catch (err) {
      console.error('getZohoSalespersonHideImpactFn failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not load hide impact.');
    }
  },
);

/** Hide / unhide a Zoho salesperson from portal pickers and dealer linking. */
export const setZohoSalespersonPortalHidden = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    const salespersonId = String(request.data?.salespersonId ?? '').trim();
    if (!salespersonId) {
      throw new HttpsError('invalid-argument', 'salespersonId is required.');
    }
    if (typeof request.data?.hidden !== 'boolean') {
      throw new HttpsError('invalid-argument', 'hidden must be a boolean.');
    }
    const reassignToStaffUid = request.data?.reassignToStaffUid != null
      ? String(request.data.reassignToStaffUid).trim() || null
      : null;
    try {
      return await setZohoSalespersonHiddenFromPortal(
        salespersonId,
        request.data.hidden,
        { reassignToStaffUid },
      );
    } catch (err) {
      console.error('setZohoSalespersonPortalHidden failed:', err);
      const message = err?.message ?? 'Could not update salesperson visibility.';
      if (/Reassign them|different portal owner|Target/i.test(message)) {
        throw new HttpsError('failed-precondition', message);
      }
      throw new HttpsError('internal', message);
    }
  },
);

/** @deprecated Prefer reclassifyInvoiceCategoriesFromCatalogFn */
export const backfillInvoiceCategoriesToProductFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await backfillInvoiceCategoriesToProduct({
        onlyMissing: request.data?.onlyMissing === true,
      });
    } catch (err) {
      console.error('backfillInvoiceCategoriesToProduct failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Invoice category backfill failed.');
    }
  },
);

/** Reclassify existing purchase orders from lineItems.itemId → catalogProducts. */
export const reclassifyPurchaseOrderCategoriesFromCatalogFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      const result = await reclassifyPurchaseOrderCategoriesFromCatalog();
      return {
        scanned: result.scanned,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: 0,
        byCategory: result.counts,
      };
    } catch (err) {
      console.error('reclassifyPurchaseOrderCategoriesFromCatalog failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Purchase order category reclassify failed.');
    }
  },
);

/** Download purchase order PDF (lazy cache) — staff / super admin. */
export const downloadPurchaseOrderDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const poId = String(request.data?.purchaseOrderId ?? '').trim();
    if (!poId) {
      throw new HttpsError('invalid-argument', 'purchaseOrderId is required.');
    }
    try {
      return await ensurePurchaseOrderPdf(
        zohoSecrets(),
        zohoOrganizationId.value(),
        poId,
      );
    } catch (err) {
      console.error('downloadPurchaseOrderDocument failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not download purchase order PDF.');
    }
  },
);

/** Reclassify existing goods receipts from lineItems.itemId → catalogProducts. */
export const reclassifyGoodsReceiptCategoriesFromCatalogFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      const result = await reclassifyGoodsReceiptCategoriesFromCatalog();
      return {
        scanned: result.scanned,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: 0,
        byCategory: result.counts,
      };
    } catch (err) {
      console.error('reclassifyGoodsReceiptCategoriesFromCatalog failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Goods receipt category reclassify failed.');
    }
  },
);

/** Download goods receipt (draft bill) PDF — staff / super admin. */
export const downloadGoodsReceiptDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const goodsReceiptId = String(request.data?.goodsReceiptId ?? '').trim();
    if (!goodsReceiptId) {
      throw new HttpsError('invalid-argument', 'goodsReceiptId is required.');
    }
    try {
      return await ensureGoodsReceiptPdf(
        zohoSecrets(),
        zohoOrganizationId.value(),
        goodsReceiptId,
      );
    } catch (err) {
      console.error('downloadGoodsReceiptDocument failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not download goods receipt PDF.');
    }
  },
);

/** Reclassify existing sales orders from lineItems.itemId → catalogProducts. */
export const reclassifySalesOrderCategoriesFromCatalogFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      const result = await reclassifySalesOrderCategoriesFromCatalog();
      return {
        scanned: result.scanned,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: 0,
        byCategory: result.counts,
      };
    } catch (err) {
      console.error('reclassifySalesOrderCategoriesFromCatalog failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Sales order category reclassify failed.');
    }
  },
);

/** Download sales order PDF (lazy cache) — staff / super admin, or owning dealer. */
export const downloadSalesOrderDocument = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
    const soId = String(request.data?.salesOrderId ?? '').trim();
    if (!soId) {
      throw new HttpsError('invalid-argument', 'salesOrderId is required.');
    }
    try {
      if (role === 'dealer' || role === 'dealer_staff') {
        return await ensureDealerSalesOrderPdf(
          zohoSecrets(),
          zohoOrganizationId.value(),
          uid,
          role,
          soId,
        );
      }
      return await ensureSalesOrderPdf(
        zohoSecrets(),
        zohoOrganizationId.value(),
        soId,
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('downloadSalesOrderDocument failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Could not download sales order PDF.');
    }
  },
);

/** Dealer: list own Zoho sales orders (Firestore + lazy customer sync). */
export const listDealerSalesOrders = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      return await listDealerSalesOrderRecords(uid, role, request.data ?? {}, {
        secrets: zohoSecrets(),
        orgId: zohoOrganizationId.value(),
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load sales orders.');
    }
  },
);

/** Dealer: pull own Zoho sales orders into Firestore (like invoice sync). */
export const syncDealerSalesOrdersFromZoho = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      const customerId = await resolveZohoCustomerIdForUser(uid, role);
      return await syncDealerSalesOrdersToFirestore(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
        request.data ?? {},
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('syncDealerSalesOrdersFromZoho failed:', err);
      throw new HttpsError('internal', err?.message ?? 'Sales order sync failed.');
    }
  },
);

/** Dealer: load one own Zoho sales order detail. */
export const getDealerSalesOrderDetail = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    const salesOrderId = String(request.data?.salesOrderId ?? '').trim();
    try {
      return await getDealerSalesOrderDetailRecord(uid, role, salesOrderId);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load sales order.');
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
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES, { allowViewOnly: true });
    return listDealers(request.data ?? {}, { role, uid });
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
    const role = await requireActiveUser(uid, DEALER_INVOICE_ROLES, { allowViewOnly: true });
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
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    const csv = await exportDealersCsv(request.data ?? {}, { role, uid });
    return { csv };
  },
);

/** Dealer KPI stats — staff / super admin. */
export const getDealerStats = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    return getDealerStatsSummary({ role, uid });
  },
);

/** Dealer location facets — staff / super admin. */
export const getDealerLocations = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    return getDealerLocationsSummary({ role, uid });
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
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const id = String(request.data?.id ?? '').trim();
    if (!id) throw new HttpsError('invalid-argument', 'id is required.');
    const patch = request.data?.patch ?? {};
    try {
      const updated = await patchDealerRecord(id, patch);
      let salespersonBackfill = null;
      if ('assignedStaffUid' in patch && patch.assignedStaffUid) {
        salespersonBackfill = await backfillOpenSalesOrdersSalespersonForCustomerRecord(
          id,
          zohoSecrets(),
          zohoOrganizationId.value(),
        );
      }
      return { dealer: updated, salespersonBackfill };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update dealer.');
    }
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

/** Staff options for dealer assignment — ops users (requires ≥1 Zoho salesperson). */
export const listAssignableDealerStaff = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SYNC_ROLES);
    const data = await listAssignableStaffOptions();
    return { data };
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

/** Public — send WhatsApp OTP via Wati for first-time signup or password reset. */
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
    const purposeRaw = String(request.data?.purpose ?? 'signup').trim().toLowerCase();
    const purpose = purposeRaw === 'reset' ? 'reset' : 'signup';
    if (!dealerId) {
      throw new HttpsError('invalid-argument', 'Select which dealer account to use.');
    }
    try {
      return await dispatchDealerLoginOtp(
        phone,
        dealerId,
        watiToken.value(),
        watiEndpoint.value(),
        purpose,
      );
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

/** Public — set a new password after OTP verification for an existing dealer portal. */
export const completeDealerPasswordReset = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const phone = parseDealerPhoneInput(request.data?.phone);
    const setupToken = String(request.data?.setupToken ?? '').trim();
    const password = String(request.data?.password ?? '');
    if (!setupToken) {
      throw new HttpsError('invalid-argument', 'Verification session is missing.');
    }
    try {
      return await finalizeDealerPasswordReset(phone, setupToken, password);
    } catch (err) {
      dealerOtpError(err, 'Password reset failed.');
    }
  },
);

/** Super admin — set Auth password for a managed portal user (dealer support). */
export const setManagedUserPassword = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    const targetUid = String(request.data?.uid ?? '').trim();
    const password = String(request.data?.password ?? '');
    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'User id is required.');
    }
    if (targetUid === request.auth?.uid) {
      throw new HttpsError('failed-precondition', 'Use a different flow to change your own password.');
    }
    try {
      return await updateManagedUserPassword(targetUid, password);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update password.');
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

/** Raise a Warranty & Support complaint from a logistics booking (all portal roles). */
export const raiseLogisticsIssueTicketFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    try {
      return await raiseLogisticsIssueTicketHandler(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not raise issue ticket.');
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

export const submitDealerOrder = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      return await submitDealerOrderRecord(
        uid,
        role,
        request.data ?? {},
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not submit order.');
    }
  },
);

export const createStaffSalesOrder = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await createStaffSalesOrderRecord(
        uid,
        role,
        request.data ?? {},
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not create sales order.');
    }
  },
);

/** Pending last-logistics freight Diff that will apply on the next freight SO. */
export const getPendingFreightDiff = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(
      uid,
      new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']),
    );
    try {
      let zohoCustomerId = String(request.data?.zohoCustomerId ?? '').trim();
      if (!zohoCustomerId && (role === 'dealer' || role === 'dealer_staff')) {
        zohoCustomerId = String(await resolveZohoCustomerIdForUser(uid, role) || '').trim();
      }
      if (!zohoCustomerId) {
        throw new HttpsError('invalid-argument', 'Dealer (Zoho customer) is required.');
      }
      return await getPendingFreightDiffPreview(getFirestore(), zohoCustomerId);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load freight adjustment.');
    }
  },
);

export const listDealerShippingAddresses = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      return await listAddressesForUserRecord(
        uid,
        role,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load shipping addresses.');
    }
  },
);

export const addDealerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      const address = await addAddressForUserRecord(
        uid,
        role,
        zohoSecrets(),
        zohoOrganizationId.value(),
        request.data?.address ?? {},
      );
      return { address };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not add shipping address.');
    }
  },
);

export const updateDealerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      const address = await updateAddressForUserRecord(
        uid,
        role,
        zohoSecrets(),
        zohoOrganizationId.value(),
        {
          addressId: request.data?.addressId ?? null,
          kind: request.data?.kind ?? null,
          address: request.data?.address ?? {},
        },
      );
      return { address };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update shipping address.');
    }
  },
);

export const deleteDealerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff']));
    try {
      return await deleteAddressForUserRecord(
        uid,
        role,
        zohoSecrets(),
        zohoOrganizationId.value(),
        request.data?.addressId,
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete shipping address.');
    }
  },
);

export const listCustomerShippingAddresses = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, new Set(['staff', 'super_admin']), { allowViewOnly: true });
    try {
      const customerId = String(request.data?.customerId ?? '').trim();
      if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.');
      return await listContactAddressesForCustomerRecord(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not load shipping addresses.');
    }
  },
);

export const addCustomerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      const customerId = String(request.data?.customerId ?? '').trim();
      if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.');
      const address = await addContactAddressRecord(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
        request.data?.address ?? {},
      );
      return { address };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not add shipping address.');
    }
  },
);

export const updateCustomerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      const customerId = String(request.data?.customerId ?? '').trim();
      if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.');
      const address = await updateContactAddressRecord(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
        {
          addressId: request.data?.addressId ?? null,
          kind: request.data?.kind ?? null,
          address: request.data?.address ?? {},
        },
      );
      return { address };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update shipping address.');
    }
  },
);

export const deleteCustomerShippingAddress = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      const customerId = String(request.data?.customerId ?? '').trim();
      if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.');
      return await deleteContactAddressRecord(
        zohoSecrets(),
        zohoOrganizationId.value(),
        customerId,
        request.data?.addressId,
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not delete shipping address.');
    }
  },
);

export const confirmZohoSalesOrder = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await confirmMirroredSalesOrderRecord(
        uid,
        role,
        request.data?.salesOrderId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not confirm sales order.');
    }
  },
);

export const voidZohoSalesOrder = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await voidSalesOrderWithWorkflowRecord(
        uid,
        role,
        request.data?.salesOrderId,
        request.data?.reason,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not void sales order.');
    }
  },
);

export const deleteDraftSalesOrder = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(
      uid,
      new Set(['staff', 'super_admin', 'dealer', 'dealer_staff']),
    );
    try {
      return await deleteDraftSalesOrderRecord(
        uid,
        role,
        request.data?.salesOrderId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Preserve structured errors if instanceof fails across bundles.
      const code = typeof err?.code === 'string' ? err.code : '';
      if (
        code
        && [
          'invalid-argument',
          'failed-precondition',
          'permission-denied',
          'not-found',
          'unauthenticated',
          'resource-exhausted',
        ].includes(code)
      ) {
        throw new HttpsError(code, err?.message ?? 'Could not delete sales order.');
      }
      console.error('deleteDraftSalesOrder failed:', err?.message || err);
      throw new HttpsError('internal', err?.message ?? 'Could not delete sales order.');
    }
  },
);

export const updateDraftSalesOrderLines = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await updateDraftSalesOrderLinesRecord(
        uid,
        role,
        request.data ?? {},
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update sales order lines.');
    }
  },
);

export const updateDraftSalesOrderShipping = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await updateDraftSalesOrderShippingRecord(
        uid,
        role,
        request.data ?? {},
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update shipping address.');
    }
  },
);

export const markSalesOrderReadyForPayment = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['staff', 'super_admin']));
    try {
      return await markSalesOrderReadyForPaymentRecord(uid, role, request.data?.salesOrderId);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not mark sales order ready for payment.');
    }
  },
);

export const uploadSalesOrderPaymentScreenshotFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']));
    try {
      return await uploadSalesOrderPaymentScreenshotRecord(uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not upload payment screenshot.');
    }
  },
);

export const submitSalesOrderPayment = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, new Set(['dealer', 'dealer_staff', 'staff', 'super_admin']));
    try {
      return await submitSalesOrderPaymentRecord(uid, role, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not submit payment proof.');
    }
  },
);

export const verifySalesOrderPayment = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SUPER_ADMIN_ROLES);
    try {
      return await verifySalesOrderPaymentRecord(
        uid,
        role,
        request.data?.salesOrderId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not verify payment.');
    }
  },
);

/** Manually mark SO invoiced after it was processed in Zoho outside YesOne. */
export const markSalesOrderInvoicedManually = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    try {
      return await markSalesOrderInvoicedManuallyRecord(
        uid,
        role,
        request.data?.salesOrderId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not mark sales order as invoiced.');
    }
  },
);

export const repairSalesOrderInvoicingMismatch = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    try {
      return await repairSalesOrderInvoicingMismatchRecord(
        uid,
        role,
        request.data?.salesOrderId,
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not repair sales order workflow.');
    }
  },
);

/** Copy dealer assigned staff → Zoho salesperson onto a sales order. */
export const applySalesOrderSalespersonFromDealer = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    try {
      return await applySalesOrderSalespersonFromDealerRecord(
        uid,
        role,
        request.data?.salesOrderId,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not apply salesperson.');
    }
  },
);

/** Apply a portal staff member's Zoho salesperson onto a sales order. */
export const applySalesOrderSalespersonFromStaff = onCall(
  {
    region: 'asia-south1',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async request => {
    const uid = request.auth?.uid;
    const role = await requireActiveUser(uid, SYNC_ROLES);
    try {
      return await applySalesOrderSalespersonFromStaffRecord(
        uid,
        role,
        request.data?.salesOrderId,
        request.data?.staffUid,
        zohoSecrets(),
        zohoOrganizationId.value(),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not apply salesperson.');
    }
  },
);

/** One-shot: delete all legacy portal dealerOrders docs (does not touch Zoho). */
export const purgeDealerOrders = onCall(
  { region: 'asia-south1', timeoutSeconds: 540, memory: '512MiB' },
  async request => {
    const uid = request.auth?.uid;
    await requireActiveUser(uid, SUPER_ADMIN_ROLES);
    try {
      return await purgeAllDealerOrdersRecord(uid);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not purge portal orders.');
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
 * Public ST Courier tracking page (replaces dead erpstcourier AWB URL).
 * Hosting rewrite: GET /track/st-courier?awb=XXXXXXXXXXX
 */
export const trackStCourierShipmentHttp = onRequest(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }
    try {
      const awb = String(req.query?.awb ?? req.query?.keyword ?? '').trim();
      const result = await fetchStCourierTrack(awb);
      res.set('Cache-Control', 'no-store');
      res.status(result.ok ? 200 : 404).type('html').send(renderStCourierTrackHtml(result));
    } catch (err) {
      console.error('trackStCourierShipmentHttp failed:', err);
      res.status(500).type('html').send(
        '<!doctype html><title>Track unavailable</title><p>Could not fetch ST Courier status right now.</p>',
      );
    }
  },
);

/** Authenticated ST Courier tracking JSON for in-app track dialog. */
export const trackStCourierShipmentFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const awb = String(request.data?.awb ?? request.data?.trackingNo ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    try {
      const result = await fetchStCourierTrack(awb);
      if (bookingId && result) {
        try {
          await persistStCourierTrackOnBooking(getFirestore(), bookingId, result, {
            updatePipelineStatus: true,
          });
        } catch (persistErr) {
          console.warn(
            'trackStCourierShipmentFn: persist failed for',
            bookingId,
            persistErr?.message || persistErr,
          );
        }
      }
      return result;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch ST Courier shipment status.',
      );
    }
  },
);

/**
 * Lookup ST Courier delivery-office Communication for a destination pincode
 * (scrapes https://stcourier.com/pincode-search — first result row).
 */
export const lookupStCourierDeliveryOfficeFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 45,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const pincode = String(request.data?.pincode ?? '').trim();
    try {
      return await fetchStCourierDeliveryOffice(pincode);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch ST Courier delivery office.',
      );
    }
  },
);

/**
 * On new ST logistics booking: fetch destination delivery office once and persist.
 * Skips when already filled by the client at create time.
 */
export const fillStCourierDeliveryOfficeOnCreate = onDocumentCreated(
  {
    document: 'logisticsBookings/{bookingId}',
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async event => {
    const bookingId = event.params.bookingId;
    try {
      const result = await fillCourierDeliveryOfficeOnBooking(getFirestore(), bookingId);
      if (result.updated) {
        console.log(
          `fillStCourierDeliveryOfficeOnCreate: ${bookingId} pin=${result.pincode}`,
        );
      }
    } catch (err) {
      console.warn(
        'fillStCourierDeliveryOfficeOnCreate failed',
        bookingId,
        err?.message || err,
      );
    }
  },
);

/**
 * When a Delhivery booking is confirmed, gets an LRN, or is marked delivered:
 * prefetch waybill + shipping labels (and POD/COD after delivery) into Storage.
 */
export const prefetchDelhiveryDocumentsOnBookingWrite = onDocumentWritten(
  {
    document: 'logisticsBookings/{bookingId}',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async event => {
    const after = event.data?.after?.data();
    if (!after) return;
    const before = event.data?.before?.exists
      ? (event.data.before.data() || {})
      : null;
    const bookingId = event.params.bookingId;
    const trigger = shouldPrefetchDelhiveryDocumentsOnWrite(before, after);
    if (!trigger) return;
    try {
      const result = await prefetchDelhiveryDocumentsForBooking(
        getFirestore(),
        bookingId,
        { includePodCod: trigger.includePodCod },
      );
      console.log(
        `prefetchDelhiveryDocumentsOnBookingWrite: ${bookingId} reason=${trigger.reason}`,
        result.prefetchStatus || result.reason || result.skipped,
      );
    } catch (err) {
      console.warn(
        'prefetchDelhiveryDocumentsOnBookingWrite failed',
        bookingId,
        trigger.reason,
        err?.message || err,
      );
    }
  },
);

/**
 * Hourly: fetch ST Courier tracking for all non-delivered ST logistics bookings,
 * persist courierTrack (+ history) on each booking, and advance status when delivered.
 */
export const syncStCourierTrackingScheduled = onSchedule(
  {
    schedule: '0 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const summary = await syncStCourierTrackingForBookings(getFirestore(), {
      includeDelivered: false,
      includeCancelled: false,
      concurrency: 2,
      delayMs: 350,
      onProgress: (event) => {
        if (event.type === 'error' || event.type === 'write_error') {
          console.warn(
            `syncStCourierTracking: ${event.type} id=${event.id} awb=${event.awb}: ${event.error}`,
          );
        }
      },
    });
    console.log(
      `syncStCourierTracking: scanned=${summary.scanned}, targeted=${summary.targeted}, `
      + `ok=${summary.fetchedOk}, fail=${summary.fetchedFail}, updated=${summary.updated}, `
      + `statusAdvanced=${summary.statusAdvanced}, errors=${summary.errors.length}`,
    );
  },
);

/**
 * Hosting rewrite: GET /track/trackon?awb=XXXXXXXX
 */
export const trackTrackonShipmentHttp = onRequest(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }
    try {
      const awb = String(req.query?.awb ?? req.query?.keyword ?? '').trim();
      const result = await fetchTrackonTrack(awb);
      res.set('Cache-Control', 'no-store');
      res.status(result.ok ? 200 : 404).type('html').send(renderTrackonTrackHtml(result));
    } catch (err) {
      console.error('trackTrackonShipmentHttp failed:', err);
      res.status(500).type('html').send(
        '<!doctype html><title>Track unavailable</title><p>Could not fetch Trackon status right now.</p>',
      );
    }
  },
);

/** Authenticated Trackon tracking JSON for in-app track panel. */
export const trackTrackonShipmentFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const awb = String(request.data?.awb ?? request.data?.trackingNo ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    try {
      const result = await fetchTrackonTrack(awb);
      if (bookingId && result) {
        try {
          await persistTrackonTrackOnBooking(getFirestore(), bookingId, result, {
            updatePipelineStatus: true,
          });
        } catch (persistErr) {
          console.warn(
            'trackTrackonShipmentFn: persist failed for',
            bookingId,
            persistErr?.message || persistErr,
          );
        }
      }
      return result;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch Trackon shipment status.',
      );
    }
  },
);

/**
 * Hourly: sync open Trackon logistics bookings (air + surface) from trackon.in,
 * persist courierTrack (+ history), and advance status when delivered.
 */
export const syncTrackonTrackingScheduled = onSchedule(
  {
    schedule: '5 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const summary = await syncTrackonTrackingForBookings(getFirestore(), {
      includeDelivered: false,
      includeCancelled: false,
      concurrency: 2,
      delayMs: 350,
      onProgress: (event) => {
        if (event.type === 'error' || event.type === 'write_error') {
          console.warn(
            `syncTrackonTracking: ${event.type} id=${event.id} awb=${event.awb}: ${event.error}`,
          );
        }
      },
    });
    console.log(
      `syncTrackonTracking: scanned=${summary.scanned}, targeted=${summary.targeted}, `
      + `ok=${summary.fetchedOk}, fail=${summary.fetchedFail}, updated=${summary.updated}, `
      + `statusAdvanced=${summary.statusAdvanced}, errors=${summary.errors.length}`,
    );
  },
);

/** Save Delhivery B2B connection settings (password write-only via Admin SDK). */
export const saveDelhiveryB2bCredentialsFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      const config = await saveDelhiveryB2bConfig(getFirestore(), {
        username: request.data?.username,
        password: request.data?.password,
        env: request.data?.env,
        pickupLocationBySite: request.data?.pickupLocationBySite,
        updatedBy: request.auth?.uid ?? null,
      });
      return { ok: true, config };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not save Delhivery B2B credentials.',
      );
    }
  },
);

/** Public (non-secret) Delhivery B2B connection status for Logistics Settings. */
export const getDelhiveryB2bConfigFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES, { allowViewOnly: true });
    try {
      return await loadDelhiveryB2bPublicConfig(getFirestore());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not load Delhivery B2B config.',
      );
    }
  },
);

/** Login to Delhivery B2B and report connection status. */
export const testDelhiveryB2bConnectionFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES);
    try {
      return await testDelhiveryB2bConnection(getFirestore());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not test Delhivery B2B connection.',
      );
    }
  },
);

/** Create a Delhivery B2B LR via LTL multipart POST /manifest (then poll job_id). */
export const bookDelhiveryShipmentFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '256MiB',
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES);
    const db = getFirestore();
    try {
      const site = String(request.data?.shipFromSite ?? 'head_office').trim();
      const pickupOverride = String(request.data?.pickupLocationName ?? '').trim();
      const pickupLocationName = pickupOverride
        || await resolveDelhiveryPickupLocationName(db, site);
      // Shipper phone/GSTIN on LR print come from the registered warehouse profile.
      await syncDelhiveryWarehouseForSite(db, site, pickupLocationName);
      const boxes = Array.isArray(request.data?.boxes) ? request.data.boxes : [];
      const invoiceFields = await resolveInvoiceFieldsForDelhiveryBook(db, {
        invoiceNumber: request.data?.invoiceNumber,
        invoiceValueInr: request.data?.invoiceValueInr,
        invoiceId: request.data?.invoiceId,
        zohoCustomerId: request.data?.zohoCustomerId,
      }, {
        syncInvoice: async invoiceId => {
          await syncSingleInvoiceFromZoho(
            zohoSecrets(),
            zohoOrganizationId.value(),
            invoiceId,
            {
              skipPdfs: true,
              skipImages: true,
              source: 'delhivery-book',
            },
          );
        },
      });
      const clubbedInput = Array.isArray(request.data?.invoices) ? request.data.invoices : [];
      const clubbedInvoices = [];
      for (const row of clubbedInput) {
        if (!row || typeof row !== 'object') continue;
        const invoiceId = String(row.invoiceId ?? '').trim();
        const fields = invoiceId && invoiceId === String(request.data?.invoiceId ?? '').trim()
          ? invoiceFields
          : await resolveInvoiceFieldsForDelhiveryBook(db, {
            invoiceNumber: row.invoiceNumber,
            invoiceValueInr: row.invoiceValueInr,
            invoiceId,
            zohoCustomerId: request.data?.zohoCustomerId,
          }, {
            syncInvoice: async id => {
              await syncSingleInvoiceFromZoho(
                zohoSecrets(),
                zohoOrganizationId.value(),
                id,
                {
                  skipPdfs: true,
                  skipImages: true,
                  source: 'delhivery-book',
                },
              );
            },
          });
        clubbedInvoices.push({
          invoiceId: invoiceId || null,
          invoiceNumber: fields.invoiceNumber,
          invoiceValueInr: fields.invoiceValueInr,
        });
      }
      const clubbedSum = clubbedInvoices.reduce(
        (sum, row) => sum + (Number(row.invoiceValueInr) || 0),
        0,
      );
      const result = await bookDelhiveryB2bShipment(db, {
        pickupLocationName,
        orderId: String(request.data?.orderId ?? '').trim() || `YW-${Date.now()}`,
        consignee: request.data?.consignee || {},
        returnAddress: request.data?.returnAddress || null,
        billingAddress: request.data?.billingAddress || null,
        boxes,
        invoiceId: request.data?.invoiceId,
        zohoCustomerId: request.data?.zohoCustomerId,
        invoiceNumber: invoiceFields.invoiceNumber,
        invoiceValueInr: clubbedSum > 0 ? clubbedSum : invoiceFields.invoiceValueInr,
        invoiceDate: request.data?.invoiceDate,
        productsDesc: request.data?.productsDesc,
        hsnCode: request.data?.hsnCode,
        sellerGstin: request.data?.sellerGstin,
        paymentMode: request.data?.paymentMode,
        shippingMode: request.data?.shippingMode,
        freightBillingMode: request.data?.freightBillingMode,
        ...(clubbedInvoices.length ? { invoices: clubbedInvoices } : {}),
      });

      // Master AWB from label URLs (soft) — usually available once LR is manifested.
      let masterAwb = null;
      try {
        const resolved = await resolveDelhiveryMasterAwbFromLrn(db, result.lrn);
        masterAwb = resolved.masterAwb || null;
      } catch {
        masterAwb = null;
      }

      // First-mile pickup after LR — never fail the book if pickup fails.
      // Soft-OK when warehouse already has an open pickup (pr_exist / 669).
      let pickup;
      try {
        const created = await createDelhiveryPickupRequest(db, {
          shipFromSite: site,
          pickupLocationName,
          boxes,
        });
        pickup = {
          ok: true,
          alreadyExisted: Boolean(created.alreadyExisted),
          pickupId: created.pickupId || null,
          pickupLocationName: created.pickupLocationName || pickupLocationName,
          pickupDate: created.pickupDate || null,
          pickupTime: created.pickupTime || null,
          expectedPackageCount: created.expectedPackageCount ?? null,
          message: created.message || null,
          requestedAt: new Date().toISOString(),
        };
      } catch (pickupErr) {
        pickup = {
          ok: false,
          alreadyExisted: false,
          pickupId: null,
          pickupLocationName,
          pickupDate: null,
          pickupTime: null,
          expectedPackageCount: null,
          message: pickupErr instanceof HttpsError
            ? pickupErr.message
            : (pickupErr?.message || 'Pickup request failed.'),
          requestedAt: new Date().toISOString(),
        };
      }

      return { ...result, masterAwb, pickup };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'failed-precondition',
        err?.message ?? 'Could not book Delhivery shipment.',
      );
    }
  },
);

/** Create (or attach to existing) Delhivery first-mile pickup request. */
export const createDelhiveryPickupRequestFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES);
    const db = getFirestore();
    try {
      const created = await createDelhiveryPickupRequest(db, {
        shipFromSite: String(request.data?.shipFromSite ?? 'cochin').trim() || 'cochin',
        pickupLocationName: String(request.data?.pickupLocationName ?? '').trim() || undefined,
        expectedPackageCount: request.data?.expectedPackageCount,
        boxes: Array.isArray(request.data?.boxes) ? request.data.boxes : undefined,
        pickupDate: request.data?.pickupDate,
        pickupTime: request.data?.pickupTime,
      });
      return {
        ok: true,
        alreadyExisted: Boolean(created.alreadyExisted),
        pickupId: created.pickupId || null,
        pickupLocationName: created.pickupLocationName || null,
        pickupDate: created.pickupDate || null,
        pickupTime: created.pickupTime || null,
        expectedPackageCount: created.expectedPackageCount ?? null,
        message: created.message || null,
        requestedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'failed-precondition',
        err?.message ?? 'Could not create Delhivery pickup request.',
      );
    }
  },
);

/** Cancel a Delhivery B2B LR via DELETE /lrn/cancel/{lrn}. */
export const cancelDelhiveryShipmentFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES);
    const lrn = String(request.data?.lrn ?? request.data?.awb ?? '').trim();
    try {
      return await cancelDelhiveryB2bShipment(getFirestore(), lrn);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'failed-precondition',
        err?.message ?? 'Could not cancel Delhivery shipment.',
      );
    }
  },
);

/** Pincode serviceability — GET /pincode-service/{pincode}. */
export const checkDelhiveryPincodeServiceabilityFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 45, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    try {
      return await checkDelhiveryPincodeServiceability(getFirestore(), {
        pincode: request.data?.pincode,
        weightG: request.data?.weightG,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not check Delhivery serviceability.');
    }
  },
);

/** Expected TAT — GET /tat/estimate. */
export const fetchDelhiveryTatFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 45, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    try {
      return await fetchDelhiveryTat(getFirestore(), {
        originPin: request.data?.originPin,
        destinationPin: request.data?.destinationPin,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not fetch Delhivery TAT.');
    }
  },
);

/**
 * Combined lane quote: serviceability + TAT + freight estimate.
 * Use from SO / invoice / Book Courier when Delhivery is selected.
 */
export const quoteDelhiveryLaneFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    try {
      return await quoteDelhiveryLane(getFirestore(), {
        originPin: request.data?.originPin,
        destinationPin: request.data?.destinationPin,
        weightG: request.data?.weightG,
        invAmount: request.data?.invAmount,
        dimensions: request.data?.dimensions,
        freightBillingMode: request.data?.freightBillingMode,
        includeEstimate: request.data?.includeEstimate,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not quote Delhivery lane.');
    }
  },
);

/** Freight charges breakup for existing LRNs — GET /lrn/freight-breakup. */
export const fetchDelhiveryFreightChargesFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const lrns = request.data?.lrns ?? request.data?.lrn ?? request.data?.awb;
    try {
      return await fetchDelhiveryFreightCharges(getFirestore(), lrns);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not fetch Delhivery freight charges.');
    }
  },
);

/**
 * Hosting rewrite: GET /track/delhivery?awb=XXXXXXXX
 */
export const trackDelhiveryShipmentHttp = onRequest(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }
    try {
      const awb = String(req.query?.awb ?? req.query?.lrn ?? req.query?.keyword ?? '').trim();
      const masterAwb = String(req.query?.masterAwb ?? req.query?.mwb ?? req.query?.waybill ?? '').trim();
      const result = await fetchDelhiveryTrack(getFirestore(), awb, {
        alternateIds: masterAwb ? [masterAwb] : [],
      });
      res.set('Cache-Control', 'no-store');
      res.status(result.ok ? 200 : 404).type('html').send(renderDelhiveryTrackHtml(result));
    } catch (err) {
      console.error('trackDelhiveryShipmentHttp failed:', err);
      res.status(500).type('html').send(
        '<!doctype html><title>Track unavailable</title><p>Could not fetch Delhivery status right now.</p>',
      );
    }
  },
);

/** Authenticated Delhivery tracking JSON for in-app track panel. */
export const trackDelhiveryShipmentFn = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const awb = String(request.data?.awb ?? request.data?.trackingNo ?? request.data?.lrn ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const explicitMaster = String(
      request.data?.masterAwb ?? request.data?.waybill ?? request.data?.mwb ?? '',
    ).trim();
    try {
      /** @type {string[]} */
      let alternateIds = explicitMaster ? [explicitMaster] : [];
      if (bookingId) {
        try {
          const snap = await getFirestore().collection('logisticsBookings').doc(bookingId).get();
          if (snap.exists) {
            const data = snap.data() || {};
            alternateIds = [
              ...alternateIds,
              String(data.trackingNo || ''),
              String(data.masterAwb || ''),
              String(data.delhiveryMasterAwb || ''),
              String(data.courierTrack?.masterAwb || ''),
              String(data.consignmentNo || ''),
            ];
          }
        } catch {
          // Ignore booking lookup failures; still try primary AWB.
        }
      }
      const result = await fetchDelhiveryTrack(getFirestore(), awb, { alternateIds });
      if (bookingId && result) {
        try {
          await persistDelhiveryTrackOnBooking(getFirestore(), bookingId, result, {
            updatePipelineStatus: true,
            // Refresh button: re-detect FOD/BTC from live freight vs estimate.
            forceBillingModeRefresh: true,
          });
        } catch (persistErr) {
          console.warn(
            'trackDelhiveryShipmentFn: persist failed for',
            bookingId,
            persistErr?.message || persistErr,
          );
        }
      }
      return result;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch Delhivery shipment status.',
      );
    }
  },
);

/** Prefetch Delhivery waybill, labels, and delivery docs into Storage + Firestore cache. */
export const prefetchDelhiveryDocumentsFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 540, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const bookingId = String(request.data?.bookingId ?? '').trim();
    if (!bookingId) {
      throw new HttpsError('invalid-argument', 'bookingId is required.');
    }
    const includePodCod = request.data?.includePodCod === true;
    const force = request.data?.force === true;
    try {
      return await prefetchDelhiveryDocumentsForBooking(getFirestore(), bookingId, {
        includePodCod,
        force,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not prefetch Delhivery documents.');
    }
  },
);

/** List Delhivery-native docs available now for an LR (skips stage-gated missing ones). */
export const listDelhiveryBookingDocumentsFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    try {
      return await listDelhiveryBookingDocuments(getFirestore(), request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not list Delhivery documents.');
    }
  },
);

/** Fresh POD image URLs for an LR (caches on booking when bookingId is sent). */
export const fetchDelhiveryPodFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 90, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const lrn = String(request.data?.lrn ?? request.data?.awb ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    try {
      return await ensureDelhiveryPod(getFirestore(), { lrn, bookingId });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not fetch Delhivery POD.');
    }
  },
);

/** Download POD/COD image bytes (caches on booking when bookingId is sent). */
export const fetchDelhiveryDocumentImageFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 90, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const lrn = String(request.data?.lrn ?? request.data?.awb ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const docType = String(request.data?.docType ?? 'POD').trim().toUpperCase() === 'COD'
      ? 'COD'
      : 'POD';
    try {
      return await ensureDelhiveryDocumentImage(getFirestore(), { lrn, bookingId, docType });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not download Delhivery document.');
    }
  },
);

/** Official Delhivery LR copy PDF (caches on booking when bookingId is sent). */
export const fetchDelhiveryLrCopyFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 90, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const lrn = String(request.data?.lrn ?? request.data?.awb ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const lrCopyType = String(request.data?.lrCopyType ?? 'all').trim() || 'all';
    try {
      return await ensureDelhiveryLrCopy(getFirestore(), { lrn, bookingId, lrCopyType });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not download Delhivery LR copy.');
    }
  },
);

/** Official Delhivery shipping label images (caches on booking when bookingId is sent). */
export const fetchDelhiveryShippingLabelsFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 120, memory: '512MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, ALLOWED_ROLES, { allowViewOnly: true });
    const lrn = String(request.data?.lrn ?? request.data?.awb ?? '').trim();
    const bookingId = String(request.data?.bookingId ?? '').trim();
    const size = String(request.data?.size ?? 'a4').trim().toLowerCase() || 'a4';
    try {
      return await ensureDelhiveryShippingLabels(getFirestore(), { lrn, bookingId, size });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not download Delhivery shipping labels.',
      );
    }
  },
);

/**
 * Hourly: sync open Delhivery logistics bookings from B2B track API,
 * then pull freight-breakup for weight-captured LRs.
 */
export const syncDelhiveryTrackingScheduled = onSchedule(
  {
    schedule: '10 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const summary = await syncDelhiveryTrackingForBookings(getFirestore(), {
      includeDelivered: false,
      includeCancelled: false,
      concurrency: 2,
      delayMs: 350,
      onProgress: (event) => {
        if (event.type === 'error' || event.type === 'write_error') {
          console.warn(
            `syncDelhiveryTracking: ${event.type} id=${event.id} awb=${event.awb}: ${event.error}`,
          );
        }
      },
    });
    console.log(
      `syncDelhiveryTracking: scanned=${summary.scanned}, targeted=${summary.targeted}, `
      + `ok=${summary.fetchedOk}, fail=${summary.fetchedFail}, updated=${summary.updated}, `
      + `statusAdvanced=${summary.statusAdvanced}, errors=${summary.errors.length}`,
    );

    const freight = await syncDelhiveryFreightForBookings(getFirestore(), {
      includeDelivered: true,
      includeCancelled: false,
      force: false,
      concurrency: 2,
      delayMs: 350,
      onProgress: (event) => {
        if (event.type === 'error' || event.type === 'write_error') {
          console.warn(
            `syncDelhiveryFreight: ${event.type} id=${event.id} awb=${event.awb}: ${event.error}`,
          );
        }
      },
    });
    console.log(
      `syncDelhiveryFreight: scanned=${freight.scanned}, targeted=${freight.targeted}, `
      + `ok=${freight.fetchedOk}, fail=${freight.fetchedFail}, updated=${freight.updated}, `
      + `errors=${freight.errors.length}`,
    );
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

/** Scrape Blue Dart published diesel fuel surcharge (Surface FS). Super admin. */
export const fetchBlueDartDieselFuelSurchargeFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES, { allowViewOnly: true });
    try {
      return await fetchBlueDartDieselFuelSurcharge();
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch Blue Dart diesel fuel surcharge.',
      );
    }
  },
);

/** Scrape Blue Dart published Domestic FS + CAF (Air / DP shared). Super admin. */
export const fetchBlueDartAirSurchargesFn = onCall(
  { region: 'asia-south1', timeoutSeconds: 60, memory: '256MiB' },
  async request => {
    await requireActiveUser(request.auth?.uid, SUPER_ADMIN_ROLES, { allowViewOnly: true });
    try {
      return await fetchBlueDartAirSurcharges();
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        err?.message ?? 'Could not fetch Blue Dart FS / CAF surcharges.',
      );
    }
  },
);

/**
 * Public salary share edit — token is the credential (no Auth).
 * Updates hrSalaryShares + hrSalaryMonths so admin HR stays in sync.
 */
export const updatePublicSalaryShare = onCall(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    try {
      return await updatePublicSalaryShareRecord(request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not update salary share.');
    }
  },
);

/**
 * Public salary share — switch visible month for the same staff (token is credential).
 */
export const switchPublicSalarySharePeriod = onCall(
  {
    region: 'asia-south1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async request => {
    try {
      return await switchPublicSalarySharePeriodRecord(request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err?.message ?? 'Could not switch salary month.');
    }
  },
);

/** Opens yesgatc.in/rc/verification inside this app (optional auto-login via shared secret). */
export const getGatcVerificationEmbedToken = onCall(
  {
    region: 'asia-south1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async request => {
    await requireActiveUser(request.auth?.uid, GATC_EMBED_ROLES, { allowViewOnly: true });
    try {
      return await fetchGatcVerificationEmbedSrc(yesweighEmbedSecret.value());
    } catch (err) {
      console.error('getGatcVerificationEmbedToken failed:', err);
      return { src: GATC_VERIFICATION_EMBED_URL, autoLogin: false };
    }
  },
);
