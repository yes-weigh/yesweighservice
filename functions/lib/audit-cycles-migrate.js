import { getFirestore } from 'firebase-admin/firestore';

const PRODUCTS = 'catalogProducts';
const AUDIT_CYCLES = 'auditCycles';
const YES_STORE_ITEMS = 'yesStoreItems';
const SITE_INVENTORY = 'catalogSiteInventory';

function nowIso() {
  return new Date().toISOString();
}

async function ensureOpenInitialCycle(db, site, name, dryRun) {
  const openSnap = await db.collection(AUDIT_CYCLES)
    .where('status', '==', 'open')
    .limit(10)
    .get();
  const existing = openSnap.docs.find(d => d.data()?.site === site);
  if (existing) {
    return { id: existing.id, created: false, name: String(existing.data()?.name ?? name) };
  }

  if (dryRun) {
    return { id: null, created: true, name, dryRunPlaceholder: true };
  }

  const createdAt = nowIso();
  const ref = db.collection(AUDIT_CYCLES).doc();
  const doc = {
    id: ref.id,
    site,
    name,
    status: 'open',
    startsAt: null,
    endsAt: null,
    createdAt,
    createdByUid: null,
    createdByName: 'Migration',
    openedAt: createdAt,
    closedAt: null,
  };
  await ref.set(doc);
  return { id: ref.id, created: true, name };
}

async function collectHeadOfficeProductIds(db) {
  const ids = new Set();
  const itemsSnap = await db.collection(YES_STORE_ITEMS).get();
  for (const doc of itemsSnap.docs) {
    const id = String(doc.data()?.catalogProductId ?? '').trim();
    if (id) ids.add(id);
  }
  const siteSnap = await db.collection(SITE_INVENTORY).get();
  for (const doc of siteSnap.docs) {
    if (!doc.id.endsWith('_head_office')) continue;
    ids.add(doc.id.slice(0, -'_head_office'.length));
  }
  return ids;
}

async function collectCochinProductIds(db) {
  const ids = new Set();
  const siteSnap = await db.collection(SITE_INVENTORY).get();
  for (const doc of siteSnap.docs) {
    if (!doc.id.endsWith('_cochin')) continue;
    ids.add(doc.id.slice(0, -'_cochin'.length));
  }
  return ids;
}

/**
 * Create open Initial cycles (if missing) and stamp existing audit snapshots
 * so already-counted SKUs do not appear as "Needs count" for those cycles.
 *
 * Idempotent by default: only fills missing site cycle ids unless `force`.
 */
export async function migrateExistingAuditsIntoCycles(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const db = getFirestore();

  const summary = {
    dryRun,
    force,
    headOfficeCycle: null,
    cochinCycle: null,
    productsScanned: 0,
    stampedHeadOffice: 0,
    stampedCochin: 0,
    skippedAlreadyStamped: 0,
    skippedNoSnapshot: 0,
    skippedNoSiteEvidence: 0,
    errors: [],
    samples: [],
  };

  const hoCycle = await ensureOpenInitialCycle(db, 'head_office', 'HO Initial', dryRun);
  const cochinCycle = await ensureOpenInitialCycle(db, 'cochin', 'Cochin Initial', dryRun);
  summary.headOfficeCycle = hoCycle;
  summary.cochinCycle = cochinCycle;

  const hoCycleId = hoCycle.id;
  const cochinCycleId = cochinCycle.id;

  const [hoIds, cochinIds] = await Promise.all([
    collectHeadOfficeProductIds(db),
    collectCochinProductIds(db),
  ]);

  const candidateIds = new Set([...hoIds, ...cochinIds]);
  const productsSnap = await db.collection(PRODUCTS).get();
  for (const doc of productsSnap.docs) {
    if (doc.data()?.auditSnapshot) candidateIds.add(doc.id);
  }

  summary.productsScanned = candidateIds.size;

  let batch = db.batch();
  let batchCount = 0;
  const commitBatch = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const productId of candidateIds) {
    try {
      const productRef = db.collection(PRODUCTS).doc(productId);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        summary.skippedNoSnapshot += 1;
        continue;
      }

      const data = productSnap.data() ?? {};
      const snapshot = data.auditSnapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        summary.skippedNoSnapshot += 1;
        continue;
      }

      const hasHoEvidence = hoIds.has(productId)
        || Number(snapshot.headOfficeQtyAtAudit ?? 0) > 0;
      const hasCochinEvidence = cochinIds.has(productId)
        || Number(snapshot.cochinQtyAtAudit ?? 0) > 0;

      // Snapshot with no site inventory/bins: still migrate if it has a physical total.
      const hasOrphanSnapshot = !hasHoEvidence
        && !hasCochinEvidence
        && snapshot.physicalQtyAtAudit != null;

      if (!hasHoEvidence && !hasCochinEvidence && !hasOrphanSnapshot) {
        summary.skippedNoSiteEvidence += 1;
        continue;
      }

      const stampHo = hasHoEvidence || hasOrphanSnapshot;
      const stampCochin = hasCochinEvidence || hasOrphanSnapshot;

      const applyHo = stampHo && Boolean(hoCycleId) && (force
        ? snapshot.lastHeadOfficeAuditCycleId !== hoCycleId
        : !snapshot.lastHeadOfficeAuditCycleId);
      const applyCochin = stampCochin && Boolean(cochinCycleId) && (force
        ? snapshot.lastCochinAuditCycleId !== cochinCycleId
        : !snapshot.lastCochinAuditCycleId);

      // Dry-run with new cycles: still count what would be stamped.
      const wouldApplyHo = stampHo && (force
        ? snapshot.lastHeadOfficeAuditCycleId !== (hoCycleId || 'new')
        : !snapshot.lastHeadOfficeAuditCycleId);
      const wouldApplyCochin = stampCochin && (force
        ? snapshot.lastCochinAuditCycleId !== (cochinCycleId || 'new')
        : !snapshot.lastCochinAuditCycleId);

      if (dryRun) {
        if (!wouldApplyHo && !wouldApplyCochin) {
          summary.skippedAlreadyStamped += 1;
          continue;
        }
        if (wouldApplyHo) summary.stampedHeadOffice += 1;
        if (wouldApplyCochin) summary.stampedCochin += 1;
        if (summary.samples.length < 8) {
          summary.samples.push({
            productId,
            applyHo: wouldApplyHo,
            applyCochin: wouldApplyCochin,
          });
        }
        continue;
      }

      if (!applyHo && !applyCochin) {
        summary.skippedAlreadyStamped += 1;
        continue;
      }

      const patch = {
        ...snapshot,
        lastPhysicalAuditedAt: snapshot.lastPhysicalAuditedAt ?? snapshot.lastAuditedAt ?? null,
        lastPhysicalAuditedByUid: snapshot.lastPhysicalAuditedByUid ?? snapshot.lastAuditedByUid ?? null,
        lastPhysicalAuditedByName: snapshot.lastPhysicalAuditedByName ?? snapshot.lastAuditedByName ?? null,
      };

      if (applyHo) {
        patch.lastHeadOfficeAuditCycleId = hoCycleId;
        summary.stampedHeadOffice += 1;
      }
      if (applyCochin) {
        patch.lastCochinAuditCycleId = cochinCycleId;
        summary.stampedCochin += 1;
      }

      if (!patch.lastAuditCycleId || force) {
        patch.lastAuditCycleId = patch.lastHeadOfficeAuditCycleId
          ?? patch.lastCochinAuditCycleId
          ?? snapshot.lastAuditCycleId
          ?? null;
      }

      if (summary.samples.length < 8) {
        summary.samples.push({
          productId,
          applyHo,
          applyCochin,
          lastHeadOfficeAuditCycleId: patch.lastHeadOfficeAuditCycleId ?? null,
          lastCochinAuditCycleId: patch.lastCochinAuditCycleId ?? null,
        });
      }

      batch.set(productRef, { auditSnapshot: patch }, { merge: true });
      batchCount += 1;
      if (batchCount >= 400) await commitBatch();

      const latestLogSnap = await productRef.collection('auditLogs')
        .orderBy('auditedAt', 'desc')
        .limit(1)
        .get();
      if (!latestLogSnap.empty) {
        const logDoc = latestLogSnap.docs[0];
        const logData = logDoc.data() ?? {};
        if (force || !logData.auditCycleId) {
          const logCycleId = applyHo
            ? patch.lastHeadOfficeAuditCycleId
            : patch.lastCochinAuditCycleId;
          if (logCycleId) {
            batch.set(logDoc.ref, { auditCycleId: logCycleId }, { merge: true });
            batchCount += 1;
            if (batchCount >= 400) await commitBatch();
          }
        }
      }
    } catch (err) {
      summary.errors.push({
        productId,
        message: err?.message ?? String(err),
      });
    }
  }

  if (!dryRun) await commitBatch();
  return summary;
}
