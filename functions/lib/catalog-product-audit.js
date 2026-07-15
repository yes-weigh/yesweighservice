import { getFirestore } from 'firebase-admin/firestore';
import { getAccessToken, resolveOrganizationId, fetchProductDetail } from './zoho.js';

const YES_STORE_ITEMS = 'yesStoreItems';
const CATALOG_SITE_INVENTORY = 'catalogSiteInventory';
const PRODUCTS_COLLECTION = 'catalogProducts';

function readItemQuantity(item) {
  const qty = Number(item?.quantity ?? 0);
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
}

function readLinkMode(item) {
  return item?.catalogLinkMode === 'part' ? 'part' : 'unit';
}

function readUnitsPerProduct(item) {
  const value = Number(item?.unitsPerProduct ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function groupUsesBundleMode(items) {
  return items.some(item => readLinkMode(item) === 'part');
}

function computeHeadOfficeTotals(items) {
  const bundle = groupUsesBundleMode(items);

  if (!bundle) {
    const countedQty = items.reduce((sum, item) => sum + readItemQuantity(item), 0);
    return { mode: 'unit', countedQty, rawCountedQty: countedQty };
  }

  const parts = items.map(item => {
    const countedQty = readItemQuantity(item);
    const unitsPerProduct = readUnitsPerProduct(item);
    return Math.floor(countedQty / unitsPerProduct);
  });
  const countedQty = parts.length ? Math.min(...parts) : 0;
  const rawCountedQty = items.reduce((sum, item) => sum + readItemQuantity(item), 0);
  return { mode: 'bundle', countedQty, rawCountedQty };
}

function readCochinQuantity(data) {
  if (!data) return 0;
  const locations = Array.isArray(data.locations) ? data.locations : [];
  if (locations.length) {
    return locations.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity ?? 0))), 0);
  }
  return Math.max(0, Math.floor(Number(data.quantity ?? 0)));
}

async function listYesStoreItemsByCatalogProduct(catalogProductId) {
  const db = getFirestore();
  const snap = await db.collection(YES_STORE_ITEMS)
    .where('catalogProductId', '==', String(catalogProductId).trim())
    .limit(200)
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function readCochinInventory(catalogProductId) {
  const db = getFirestore();
  const docId = `${String(catalogProductId).trim()}_cochin`;
  const snap = await db.collection(CATALOG_SITE_INVENTORY).doc(docId).get();
  return snap.exists ? snap.data() : null;
}

function mapLatestLog(doc) {
  if (!doc?.exists) return null;
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    physicalQty: Number(data.physicalQty ?? 0),
    zohoQtyAtAudit: Number(data.zohoQtyAtAudit ?? 0),
    headOfficeQty: Number(data.headOfficeQty ?? 0),
    cochinQty: Number(data.cochinQty ?? 0),
  };
}

const DEFAULT_WAREHOUSE_COUNTED_BY_NAME = 'Diya';

function readItemCountedAt(item) {
  const countedAt = String(item?.countedAt ?? '').trim();
  if (countedAt) return countedAt;
  return String(item?.createdAt ?? item?.updatedAt ?? '').trim();
}

function readItemCountedByName(item) {
  const name = String(item?.countedByName ?? '').trim();
  return name || DEFAULT_WAREHOUSE_COUNTED_BY_NAME;
}

function resolveLegacyAuditor(items, cochinData) {
  let bestAt = '';
  let uid = null;
  let name = null;

  for (const item of items) {
    const at = readItemCountedAt(item);
    if (!at || at <= bestAt) continue;
    bestAt = at;
    uid = item.countedByUid ?? null;
    name = readItemCountedByName(item);
  }

  const cochinAt = String(cochinData?.updatedAt ?? '').trim();
  if (cochinAt && cochinAt > bestAt) {
    bestAt = cochinAt;
    uid = cochinData.updatedByUid ?? null;
    name = String(cochinData.updatedByName ?? '').trim() || null;
  }

  return {
    auditedAt: bestAt || new Date().toISOString(),
    uid,
    name,
  };
}

const PHYSICAL_TRIGGERS = new Set(['warehouse_count', 'cochin_inventory', 'manual', 'legacy_backfill']);

async function writeCatalogProductAuditEntry(productRef, entry) {
  const {
    auditedAt,
    auditedByUid,
    auditedByName,
    mode,
    headOfficeQty,
    cochinQty,
    physicalQty,
    rawPhysicalQty,
    zohoQtyAtAudit,
    baselineDifference,
    trigger,
    logId,
    auditCycleId,
    existingSnapshot,
  } = entry;

  const logRef = logId
    ? productRef.collection('auditLogs').doc(logId)
    : productRef.collection('auditLogs').doc();

  const isPhysical = PHYSICAL_TRIGGERS.has(trigger);
  const log = {
    id: logRef.id,
    catalogProductId: productRef.id,
    auditedAt,
    auditedByUid: auditedByUid ?? null,
    auditedByName: auditedByName ?? null,
    mode,
    headOfficeQty,
    cochinQty,
    physicalQty,
    rawPhysicalQty: rawPhysicalQty ?? null,
    zohoQtyAtAudit,
    baselineDifference,
    trigger,
    auditCycleId: auditCycleId ?? null,
  };

  const prior = existingSnapshot && typeof existingSnapshot === 'object' ? existingSnapshot : {};
  const snapshot = {
    lastAuditLogId: logRef.id,
    lastAuditedAt: isPhysical ? auditedAt : (prior.lastAuditedAt ?? auditedAt),
    lastAuditedByUid: isPhysical ? (auditedByUid ?? null) : (prior.lastAuditedByUid ?? null),
    lastAuditedByName: isPhysical ? (auditedByName ?? null) : (prior.lastAuditedByName ?? null),
    baselineDifference,
    // Freeze physical on zoho_sync; only physical triggers rewrite counted qty.
    physicalQtyAtAudit: isPhysical
      ? physicalQty
      : Number(prior.physicalQtyAtAudit ?? physicalQty),
    zohoQtyAtAudit,
    mode,
    headOfficeQtyAtAudit: isPhysical
      ? headOfficeQty
      : Number(prior.headOfficeQtyAtAudit ?? headOfficeQty),
    cochinQtyAtAudit: isPhysical
      ? cochinQty
      : Number(prior.cochinQtyAtAudit ?? cochinQty),
    lastPhysicalAuditedAt: isPhysical
      ? auditedAt
      : (prior.lastPhysicalAuditedAt ?? prior.lastAuditedAt ?? null),
    lastPhysicalAuditedByUid: isPhysical
      ? (auditedByUid ?? null)
      : (prior.lastPhysicalAuditedByUid ?? prior.lastAuditedByUid ?? null),
    lastPhysicalAuditedByName: isPhysical
      ? (auditedByName ?? null)
      : (prior.lastPhysicalAuditedByName ?? prior.lastAuditedByName ?? null),
    lastAuditCycleId: isPhysical
      ? (auditCycleId ?? prior.lastAuditCycleId ?? null)
      : (prior.lastAuditCycleId ?? null),
  };

  await logRef.set(log);
  await productRef.set({ auditSnapshot: snapshot }, { merge: true });

  return { log, snapshot };
}

/**
 * When Zoho stock changes on sync, keep frozen physical count.
 * Diff in the log = frozenPhysical − nextZoho. Snapshot lastPhysical* unchanged.
 */
export function buildZohoSyncAuditAdjustment(existingSnapshot, previousZohoQty, nextZohoQty, auditedAt) {
  if (!existingSnapshot || existingSnapshot.physicalQtyAtAudit == null) return null;

  const prevZoho = Number(previousZohoQty);
  const nextZoho = Number(nextZohoQty);
  if (!Number.isFinite(prevZoho) || !Number.isFinite(nextZoho)) return null;
  if (prevZoho === nextZoho) return null;

  const physicalQty = Number(existingSnapshot.physicalQtyAtAudit);
  const baselineDifference = physicalQty - nextZoho;
  const mode = existingSnapshot.mode === 'bundle' ? 'bundle' : 'unit';
  const headOfficeQty = Number(existingSnapshot.headOfficeQtyAtAudit ?? 0);
  const cochinQty = Number(existingSnapshot.cochinQtyAtAudit ?? 0);
  const at = auditedAt || new Date().toISOString();

  return {
    auditedAt: at,
    auditedByUid: null,
    auditedByName: 'Zoho sync',
    mode,
    headOfficeQty,
    cochinQty,
    physicalQty,
    rawPhysicalQty: null,
    zohoQtyAtAudit: nextZoho,
    baselineDifference,
    trigger: 'zoho_sync',
    existingSnapshot,
  };
}

export async function writeZohoSyncAuditEntry(productRef, existingSnapshot, previousZohoQty, nextZohoQty, auditedAt) {
  const entry = buildZohoSyncAuditAdjustment(
    existingSnapshot,
    previousZohoQty,
    nextZohoQty,
    auditedAt,
  );
  if (!entry) return null;
  return writeCatalogProductAuditEntry(productRef, {
    ...entry,
    existingSnapshot,
  });
}

async function collectAuditCandidateProductIds() {
  const db = getFirestore();
  const ids = new Set();

  const itemsSnap = await db.collection(YES_STORE_ITEMS).get();
  for (const doc of itemsSnap.docs) {
    const id = String(doc.data()?.catalogProductId ?? '').trim();
    if (id) ids.add(id);
  }

  const siteSnap = await db.collection(CATALOG_SITE_INVENTORY).get();
  for (const doc of siteSnap.docs) {
    if (!doc.id.endsWith('_cochin')) continue;
    ids.add(doc.id.slice(0, -'_cochin'.length));
  }

  return [...ids];
}

/**
 * One-time migration: turn existing warehouse bin counts + Cochin site stock into
 * auditLogs + auditSnapshot so the drift-adjusted display works after deploy.
 * Uses cached catalogProducts.stock as zohoQtyAtAudit (what the app showed).
 */
export async function backfillLegacyCatalogProductAudits(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const onlyMissing = options.onlyMissing !== false;

  const db = getFirestore();
  const productIds = await collectAuditCandidateProductIds();

  const itemsByProduct = new Map();
  const itemsSnap = await db.collection(YES_STORE_ITEMS).get();
  for (const doc of itemsSnap.docs) {
    const data = doc.data() ?? {};
    const id = String(data.catalogProductId ?? '').trim();
    if (!id) continue;
    const list = itemsByProduct.get(id) ?? [];
    list.push({ id: doc.id, ...data });
    itemsByProduct.set(id, list);
  }

  const cochinByProduct = new Map();
  const siteSnap = await db.collection(CATALOG_SITE_INVENTORY).get();
  for (const doc of siteSnap.docs) {
    if (!doc.id.endsWith('_cochin')) continue;
    cochinByProduct.set(doc.id.slice(0, -'_cochin'.length), doc.data() ?? {});
  }

  const summary = {
    dryRun,
    candidates: productIds.length,
    created: 0,
    skippedHasSnapshot: 0,
    skippedNoProduct: 0,
    skippedNoData: 0,
    errors: [],
    samples: [],
  };

  for (const productId of productIds) {
    try {
      const productRef = db.collection(PRODUCTS_COLLECTION).doc(productId);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        summary.skippedNoProduct += 1;
        continue;
      }

      const productData = productSnap.data() ?? {};
      if (onlyMissing && productData.auditSnapshot) {
        summary.skippedHasSnapshot += 1;
        continue;
      }

      const items = itemsByProduct.get(productId) ?? [];
      const cochinData = cochinByProduct.get(productId) ?? null;
      if (!items.length && !cochinData) {
        summary.skippedNoData += 1;
        continue;
      }

      const headOffice = computeHeadOfficeTotals(items);
      const cochinQty = readCochinQuantity(cochinData);
      const physicalQty = headOffice.countedQty + cochinQty;
      const zohoQtyAtAudit = Number(productData.stock ?? 0);
      const baselineDifference = physicalQty - zohoQtyAtAudit;
      const auditor = resolveLegacyAuditor(items, cochinData);

      const entry = {
        auditedAt: auditor.auditedAt,
        auditedByUid: auditor.uid,
        auditedByName: auditor.name,
        mode: headOffice.mode,
        headOfficeQty: headOffice.countedQty,
        cochinQty,
        physicalQty,
        rawPhysicalQty: headOffice.mode === 'bundle' ? headOffice.rawCountedQty : null,
        zohoQtyAtAudit,
        baselineDifference,
        trigger: 'legacy_backfill',
      };

      if (dryRun) {
        summary.created += 1;
        if (summary.samples.length < 5) {
          summary.samples.push({
            productId,
            physicalQty,
            zohoQtyAtAudit,
            baselineDifference,
            auditedAt: entry.auditedAt,
          });
        }
        continue;
      }

      await writeCatalogProductAuditEntry(productRef, entry);
      summary.created += 1;
      if (summary.samples.length < 5) {
        summary.samples.push({
          productId,
          physicalQty,
          zohoQtyAtAudit,
          baselineDifference,
          auditedAt: entry.auditedAt,
        });
      }
    } catch (err) {
      summary.errors.push({
        productId,
        message: err?.message ?? String(err),
      });
    }
  }

  return summary;
}

export async function recordCatalogProductAudit(
  secrets,
  configuredOrgId,
  catalogProductId,
  options = {},
) {
  const id = String(catalogProductId ?? '').trim();
  if (!id) throw new Error('catalogProductId is required.');

  const trigger = options.trigger ?? 'manual';
  const editor = options.editor ?? {};

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const zohoDetail = await fetchProductDetail(accessToken, organizationId, id);
  const zohoQtyAtAudit = Number(zohoDetail.stock ?? 0);

  const [items, cochinData] = await Promise.all([
    listYesStoreItemsByCatalogProduct(id),
    readCochinInventory(id),
  ]);

  const headOffice = computeHeadOfficeTotals(items);
  const cochinQty = readCochinQuantity(cochinData);
  const physicalQty = headOffice.countedQty + cochinQty;
  const baselineDifference = physicalQty - zohoQtyAtAudit;
  const now = new Date().toISOString();

  const db = getFirestore();
  const productRef = db.collection(PRODUCTS_COLLECTION).doc(id);

  let resolvedCycleId = options.auditCycleId
    ? String(options.auditCycleId).trim() || null
    : null;

  // Physical site counts require an open cycle for that site (manual may omit).
  if (trigger === 'warehouse_count' || trigger === 'cochin_inventory') {
    const site = trigger === 'warehouse_count' ? 'head_office' : 'cochin';
    const openSnap = await db.collection('auditCycles')
      .where('status', '==', 'open')
      .limit(10)
      .get();
    const openDoc = openSnap.docs.find(d => d.data()?.site === site);
    if (!openDoc) {
      const err = new Error(
        `No open audit cycle for ${site === 'head_office' ? 'Head Office' : 'Cochin'}. Counting is locked.`,
      );
      err.code = 'failed-precondition';
      throw err;
    }
    const openCycleId = openDoc.id;
    if (resolvedCycleId && resolvedCycleId !== openCycleId) {
      const err = new Error('auditCycleId does not match the open cycle for this site.');
      err.code = 'failed-precondition';
      throw err;
    }
    resolvedCycleId = openCycleId;
  }

  const productSnap = await productRef.get();
  const existingSnapshot = productSnap.exists
    ? (productSnap.data()?.auditSnapshot ?? null)
    : null;

  const latestSnap = await productRef.collection('auditLogs')
    .orderBy('auditedAt', 'desc')
    .limit(1)
    .get();
  const latest = mapLatestLog(latestSnap.docs[0]);
  const latestCycleId = latestSnap.docs[0]
    ? (latestSnap.docs[0].data()?.auditCycleId ?? null)
    : null;
  if (
    latest
    && latest.physicalQty === physicalQty
    && latest.zohoQtyAtAudit === zohoQtyAtAudit
    && latest.headOfficeQty === headOffice.countedQty
    && latest.cochinQty === cochinQty
    && (latestCycleId ?? null) === (resolvedCycleId ?? null)
  ) {
    const existing = latestSnap.docs[0].data() ?? {};
    return {
      skipped: true,
      log: { id: latestSnap.docs[0].id, catalogProductId: id, ...existing },
      snapshot: existingSnapshot,
    };
  }

  const logRef = productRef.collection('auditLogs').doc();
  const result = await writeCatalogProductAuditEntry(productRef, {
    auditedAt: now,
    auditedByUid: editor.uid ?? null,
    auditedByName: editor.displayName ?? null,
    mode: headOffice.mode,
    headOfficeQty: headOffice.countedQty,
    cochinQty,
    physicalQty,
    rawPhysicalQty: headOffice.mode === 'bundle' ? headOffice.rawCountedQty : null,
    zohoQtyAtAudit,
    baselineDifference,
    trigger,
    logId: logRef.id,
    auditCycleId: resolvedCycleId,
    existingSnapshot,
  });

  return { skipped: false, log: result.log, snapshot: result.snapshot };
}

export async function listCatalogProductAuditLogs(catalogProductId, max = 20) {
  const id = String(catalogProductId ?? '').trim();
  if (!id) throw new Error('catalogProductId is required.');

  const snap = await getFirestore()
    .collection(PRODUCTS_COLLECTION)
    .doc(id)
    .collection('auditLogs')
    .orderBy('auditedAt', 'desc')
    .limit(Math.min(Math.max(max, 1), 50))
    .get();

  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
