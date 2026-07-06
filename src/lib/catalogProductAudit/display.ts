import type { CatalogProductAuditSnapshot } from '../../types/catalog-product-audit';

export interface AdjustedAuditDisplay {
  hasAuditSnapshot: boolean;
  displayAuditedQty: number | null;
  displayDifference: number | null;
  physicalQtyAtAudit: number | null;
  zohoQtyAtAudit: number | null;
  lastAuditedAt: string | null;
  lastAuditedByName: string | null;
  baselineDifference: number | null;
  /** Live physical count from bins/sites (before adjustment). */
  livePhysicalQty: number | null;
}

/**
 * When a prior audit exists, keep the recorded difference and shift the displayed
 * audited quantity as Zoho stock moves (invoices, purchases, sync).
 */
export function resolveAdjustedAuditDisplay(input: {
  currentZohoQty: number | null;
  snapshot: CatalogProductAuditSnapshot | null | undefined;
  livePhysicalQty: number | null;
}): AdjustedAuditDisplay {
  const { currentZohoQty, snapshot, livePhysicalQty } = input;

  if (!snapshot || currentZohoQty == null) {
    const displayAuditedQty = livePhysicalQty;
    const displayDifference =
      displayAuditedQty != null && currentZohoQty != null
        ? displayAuditedQty - currentZohoQty
        : null;
    return {
      hasAuditSnapshot: false,
      displayAuditedQty,
      displayDifference,
      physicalQtyAtAudit: null,
      zohoQtyAtAudit: null,
      lastAuditedAt: null,
      lastAuditedByName: null,
      baselineDifference: null,
      livePhysicalQty,
    };
  }

  const displayDifference = snapshot.baselineDifference;
  const displayAuditedQty = currentZohoQty + displayDifference;

  return {
    hasAuditSnapshot: true,
    displayAuditedQty,
    displayDifference,
    physicalQtyAtAudit: snapshot.physicalQtyAtAudit,
    zohoQtyAtAudit: snapshot.zohoQtyAtAudit,
    lastAuditedAt: snapshot.lastAuditedAt,
    lastAuditedByName: snapshot.lastAuditedByName,
    baselineDifference: snapshot.baselineDifference,
    livePhysicalQty,
  };
}
