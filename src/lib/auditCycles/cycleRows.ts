import type { CatalogProduct } from '../../types/catalog';
import type { AuditCycleDoc, AuditCycleSite } from '../../types/audit-cycle';

export interface AuditCycleProductRow {
  productId: string;
  sku: string;
  name: string;
  zohoAtAudit: number;
  auditedQty: number;
  auditedAt: string | null;
  auditDiff: number;
  rate: number;
  diffValue: number;
}

export interface AuditCycleRowTotals {
  skuCount: number;
  auditedQty: number;
  zohoAtAudit: number;
  auditDiff: number;
  diffValue: number;
}

function productBelongsToCycle(product: CatalogProduct, cycle: AuditCycleDoc): boolean {
  const snap = product.auditSnapshot;
  if (!snap) return false;
  if (cycle.site === 'head_office') {
    return (
      snap.lastHeadOfficeAuditCycleId === cycle.id
      || (
        !snap.lastHeadOfficeAuditCycleId
        && snap.lastAuditCycleId === cycle.id
      )
    );
  }
  return (
    snap.lastCochinAuditCycleId === cycle.id
    || (
      !snap.lastCochinAuditCycleId
      && snap.lastAuditCycleId === cycle.id
    )
  );
}

function siteAuditedQty(product: CatalogProduct, site: AuditCycleSite): number {
  const snap = product.auditSnapshot;
  if (!snap) return 0;
  if (site === 'head_office') {
    return Number(snap.headOfficeQtyAtAudit ?? snap.physicalQtyAtAudit ?? 0);
  }
  return Number(snap.cochinQtyAtAudit ?? snap.physicalQtyAtAudit ?? 0);
}

/**
 * Rows for a cycle. Diff is vs Zoho at audit time (baseline), not current Zoho.
 */
export function buildAuditCycleProductRows(
  products: CatalogProduct[],
  cycle: AuditCycleDoc,
): AuditCycleProductRow[] {
  const rows: AuditCycleProductRow[] = [];

  for (const product of products) {
    if (!productBelongsToCycle(product, cycle)) continue;
    const snap = product.auditSnapshot!;
    const auditedQty = siteAuditedQty(product, cycle.site);
    const zohoAtAudit = Number(snap.zohoQtyAtAudit ?? 0);
    // Prefer locked baseline Diff when it matches full physical; else site qty − Zoho@audit.
    const fullPhysical = Number(snap.physicalQtyAtAudit ?? auditedQty);
    const auditDiff = Number.isFinite(Number(snap.baselineDifference))
      && fullPhysical === auditedQty
      ? Number(snap.baselineDifference)
      : auditedQty - zohoAtAudit;
    const rate = Number(product.rate ?? 0);
    const auditedAt = snap.lastPhysicalAuditedAt ?? snap.lastAuditedAt ?? null;

    rows.push({
      productId: product.id,
      sku: product.sku?.trim() || '—',
      name: product.name?.trim() || '—',
      zohoAtAudit,
      auditedQty,
      auditedAt,
      auditDiff,
      rate,
      diffValue: auditDiff * rate,
    });
  }

  rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name));
  return rows;
}

export function summarizeAuditCycleRows(rows: AuditCycleProductRow[]): AuditCycleRowTotals {
  return rows.reduce<AuditCycleRowTotals>(
    (acc, row) => ({
      skuCount: acc.skuCount + 1,
      auditedQty: acc.auditedQty + row.auditedQty,
      zohoAtAudit: acc.zohoAtAudit + row.zohoAtAudit,
      auditDiff: acc.auditDiff + row.auditDiff,
      diffValue: acc.diffValue + row.diffValue,
    }),
    { skuCount: 0, auditedQty: 0, zohoAtAudit: 0, auditDiff: 0, diffValue: 0 },
  );
}
