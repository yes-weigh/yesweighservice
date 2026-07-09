import type { CatalogProductAuditSnapshot } from '../../types/catalog-product-audit';

export interface AdjustedAuditDisplay {
  hasAuditSnapshot: boolean;
  /**
   * Audited qty after Zoho movement:
   * lastCountedPhysical + (currentZoho − zohoAtLastAudit) = currentZoho + locked Diff.
   */
  displayAuditedQty: number | null;
  /** Locked Diff from last physical audit (unchanged by Zoho sync). */
  displayDifference: number | null;
  physicalQtyAtAudit: number | null;
  zohoQtyAtAudit: number | null;
  lastAuditedAt: string | null;
  lastAuditedByName: string | null;
  baselineDifference: number | null;
  /** Live physical count from bins/sites. */
  livePhysicalQty: number | null;
}

/**
 * Summary Audited tracks Zoho using the locked audit Diff.
 * Live location totals remain available for location-card adjustments.
 * Original physical audit rows stay in history; Zoho sync also appends history entries.
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
