import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../../firebase';
import type {
  CatalogProductAuditLog,
  CatalogProductAuditSnapshot,
  CatalogProductAuditTrigger,
  CatalogProductStockMovementsResult,
} from '../../types/catalog-product-audit';
import { getOpenAuditCycle } from '../auditCycles/data';
import { getItem } from '../yesStore/data';

const functions = getFunctions(app, 'asia-south1');

function mapAuditLog(id: string, data: Record<string, unknown>): CatalogProductAuditLog {
  return {
    id,
    catalogProductId: String(data.catalogProductId ?? ''),
    auditedAt: String(data.auditedAt ?? ''),
    auditedByUid: (data.auditedByUid as string | null) ?? null,
    auditedByName: (data.auditedByName as string | null) ?? null,
    mode: data.mode === 'bundle' ? 'bundle' : 'unit',
    headOfficeQty: Number(data.headOfficeQty ?? 0),
    cochinQty: Number(data.cochinQty ?? 0),
    physicalQty: Number(data.physicalQty ?? 0),
    rawPhysicalQty: data.rawPhysicalQty != null ? Number(data.rawPhysicalQty) : null,
    zohoQtyAtAudit: Number(data.zohoQtyAtAudit ?? 0),
    baselineDifference: Number(data.baselineDifference ?? 0),
    trigger: (data.trigger as CatalogProductAuditTrigger) ?? 'manual',
    auditCycleId: (data.auditCycleId as string | null) ?? null,
  };
}

export function mapAuditSnapshot(data: unknown): CatalogProductAuditSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (!row.lastAuditedAt || row.baselineDifference == null) return null;
  return {
    lastAuditLogId: String(row.lastAuditLogId ?? ''),
    lastAuditedAt: String(row.lastAuditedAt),
    lastAuditedByUid: (row.lastAuditedByUid as string | null) ?? null,
    lastAuditedByName: (row.lastAuditedByName as string | null) ?? null,
    baselineDifference: Number(row.baselineDifference),
    physicalQtyAtAudit: Number(row.physicalQtyAtAudit ?? 0),
    zohoQtyAtAudit: Number(row.zohoQtyAtAudit ?? 0),
    mode: row.mode === 'bundle' ? 'bundle' : 'unit',
    headOfficeQtyAtAudit: Number(row.headOfficeQtyAtAudit ?? 0),
    cochinQtyAtAudit: Number(row.cochinQtyAtAudit ?? 0),
    lastPhysicalAuditedAt: (row.lastPhysicalAuditedAt as string | null) ?? null,
    lastPhysicalAuditedByUid: (row.lastPhysicalAuditedByUid as string | null) ?? null,
    lastPhysicalAuditedByName: (row.lastPhysicalAuditedByName as string | null) ?? null,
    lastAuditCycleId: (row.lastAuditCycleId as string | null) ?? null,
    lastHeadOfficeAuditCycleId: (row.lastHeadOfficeAuditCycleId as string | null) ?? null,
    lastCochinAuditCycleId: (row.lastCochinAuditCycleId as string | null) ?? null,
  };
}

export async function fetchCatalogProductAuditLogs(
  catalogProductId: string,
  max = 50,
): Promise<CatalogProductAuditLog[]> {
  const snap = await getDocs(
    query(
      collection(db, 'catalogProducts', catalogProductId, 'auditLogs'),
      orderBy('auditedAt', 'desc'),
      limit(max),
    ),
  );
  return snap.docs.map(docSnap => mapAuditLog(docSnap.id, docSnap.data() as Record<string, unknown>));
}

export async function recordCatalogProductAudit(
  catalogProductId: string,
  trigger: CatalogProductAuditTrigger = 'manual',
  auditCycleId?: string | null,
): Promise<{ log: CatalogProductAuditLog; skipped: boolean }> {
  const callable = httpsCallable<
    {
      catalogProductId: string;
      trigger: CatalogProductAuditTrigger;
      auditCycleId?: string | null;
    },
    { log: CatalogProductAuditLog; skipped: boolean }
  >(functions, 'recordCatalogProductAudit', { timeout: 60_000 });

  const result = await callable({
    catalogProductId,
    trigger,
    auditCycleId: auditCycleId ?? null,
  });
  return result.data;
}

/** Record a product audit after a linked yesStore bin count changes. */
export async function recordCatalogProductAuditForYesStoreItem(
  itemId: string,
): Promise<{ log: CatalogProductAuditLog; skipped: boolean } | null> {
  const item = await getItem(itemId);
  const catalogProductId = item?.catalogProductId?.trim();
  if (!catalogProductId) return null;
  return refreshHeadOfficeAuditSnapshot(catalogProductId);
}

/**
 * Recompute frozen Audited stock from current linked bins (open HO cycle required).
 * Call after link/unlink/qty edits so long-running cycles stay accurate.
 */
export async function refreshHeadOfficeAuditSnapshot(
  catalogProductId: string,
): Promise<{ log: CatalogProductAuditLog; skipped: boolean } | null> {
  const id = String(catalogProductId ?? '').trim();
  if (!id) return null;
  const openCycle = await getOpenAuditCycle('head_office');
  if (!openCycle?.id) return null;
  return recordCatalogProductAudit(id, 'warehouse_count', openCycle.id);
}

/** Zoho invoices / bills / credit notes / adjustments with createdAt ≤ until. */
export async function fetchCatalogProductStockMovements(
  catalogProductId: string,
  until: string,
  options?: { forceRefresh?: boolean },
): Promise<CatalogProductStockMovementsResult> {
  const callable = httpsCallable<
    { catalogProductId: string; until: string; lifetime?: boolean; forceRefresh?: boolean },
    CatalogProductStockMovementsResult
  >(functions, 'getCatalogProductStockMovements', { timeout: 180_000 });

  const result = await callable({
    catalogProductId: String(catalogProductId ?? '').trim(),
    until: String(until ?? '').trim(),
    lifetime: false,
    forceRefresh: Boolean(options?.forceRefresh),
  });
  return result.data;
}

/** Lifetime Zoho stock ledger (Firestore cache unless forceRefresh). */
export async function fetchCatalogProductLifetimeStockMovements(
  catalogProductId: string,
  options?: { forceRefresh?: boolean },
): Promise<CatalogProductStockMovementsResult> {
  const callable = httpsCallable<
    { catalogProductId: string; lifetime: boolean; forceRefresh?: boolean },
    CatalogProductStockMovementsResult
  >(functions, 'getCatalogProductStockMovements', { timeout: 180_000 });

  const result = await callable({
    catalogProductId: String(catalogProductId ?? '').trim(),
    lifetime: true,
    forceRefresh: Boolean(options?.forceRefresh),
  });
  return result.data;
}
