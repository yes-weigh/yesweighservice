import { isSoftwareKeysLedgerStockProduct } from '../softwareKeysLedgerStock';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogProductAuditSnapshot } from '../../types/catalog-product-audit';

/**
 * Quantity for catalog grid/list stock pills.
 * Audited = last physical adjusted with Zoho (snapshot.physicalQtyAtAudit).
 * Returns 0 when the product has never been audited.
 */
export function catalogGridAuditedStockQty(
  snapshot: CatalogProductAuditSnapshot | null | undefined,
): number {
  if (!snapshot) return 0;
  const qty = Number(snapshot.physicalQtyAtAudit);
  return Number.isFinite(qty) ? qty : 0;
}

/** Software Keys + HSN 997331 — grid qty uses ledger closing stock. */
export function catalogGridStockUsesLedger(product: CatalogProduct): boolean {
  return isSoftwareKeysLedgerStockProduct(product);
}

/**
 * Grid stock qty: ledger closing for Software Keys 997331; otherwise audited stock.
 */
export function catalogGridStockQty(product: CatalogProduct): number {
  if (catalogGridStockUsesLedger(product)) {
    const qty = Number(product.ledgerClosingStock);
    return Number.isFinite(qty) ? qty : 0;
  }
  return catalogGridAuditedStockQty(product.auditSnapshot);
}

export interface AdjustedAuditDisplay {
  hasAuditSnapshot: boolean;
  /**
   * Audited stock that tracks Zoho while Diff stays locked:
   * currentZoho + baselineDifference.
   */
  displayAuditedQty: number | null;
  /**
   * Locked Diff from the last physical count (baselineDifference).
   * Does not move when Zoho stock changes between counts.
   */
  displayDifference: number | null;
  physicalQtyAtAudit: number | null;
  zohoQtyAtAudit: number | null;
  /** Last physical count time (not Zoho sync). */
  lastAuditedAt: string | null;
  lastAuditedByName: string | null;
  /** Diff recorded at last physical audit (locked). */
  baselineDifference: number | null;
  /** Live physical count from bins/sites. */
  livePhysicalQty: number | null;
  lastAuditCycleId: string | null;
}

/**
 * Diff stays locked at the last physical count.
 * Audited moves with current Zoho: Audited = Zoho + locked Diff.
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
      lastAuditCycleId: null,
    };
  }

  const baselineDifference = Number(snapshot.baselineDifference);
  const lockedDiff = Number.isFinite(baselineDifference)
    ? baselineDifference
    : Number(snapshot.physicalQtyAtAudit ?? 0) - Number(snapshot.zohoQtyAtAudit ?? 0);
  const displayAuditedQty = currentZohoQty + lockedDiff;
  const lastPhysicalAt = snapshot.lastPhysicalAuditedAt ?? snapshot.lastAuditedAt;
  const lastPhysicalBy = snapshot.lastPhysicalAuditedByName ?? snapshot.lastAuditedByName;

  return {
    hasAuditSnapshot: true,
    displayAuditedQty,
    displayDifference: lockedDiff,
    physicalQtyAtAudit: displayAuditedQty,
    zohoQtyAtAudit: snapshot.zohoQtyAtAudit,
    lastAuditedAt: lastPhysicalAt,
    lastAuditedByName: lastPhysicalBy,
    baselineDifference: lockedDiff,
    livePhysicalQty,
    lastAuditCycleId: snapshot.lastAuditCycleId ?? null,
  };
}
