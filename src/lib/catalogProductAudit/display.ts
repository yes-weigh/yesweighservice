import { isSoftwareKeysLedgerStockProduct } from '../softwareKeysLedgerStock';
import type { CatalogProduct } from '../../types/catalog';
import type { CatalogProductAuditSnapshot } from '../../types/catalog-product-audit';

/**
 * Sales keep Diff. Zoho inbound toward Audited consumes Diff (Audit stays).
 * Zoho -145 → 28 with Diff +173 → Diff 0, Audited 28.
 */
export function nextAuditDiffAfterZohoChange(
  previousZohoQty: number,
  nextZohoQty: number,
  lockedDiff: number,
): number {
  const prev = Number(previousZohoQty);
  const next = Number(nextZohoQty);
  const diff = Number(lockedDiff);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || !Number.isFinite(diff)) return diff;
  const delta = next - prev;
  if (delta > 0 && diff > 0) return Math.max(0, diff - delta);
  if (delta < 0 && diff < 0) return Math.min(0, diff - delta);
  return diff;
}

/**
 * Warehouse bins at last physical count (HO + Cochin). Does not follow Zoho.
 */
export function catalogActualWarehouseQty(
  snapshot: CatalogProductAuditSnapshot | null | undefined,
): number | null {
  if (!snapshot) return null;
  const ho = Number(snapshot.headOfficeQtyAtAudit ?? 0);
  const co = Number(snapshot.cochinQtyAtAudit ?? 0);
  if (!Number.isFinite(ho) && !Number.isFinite(co)) return null;
  return (Number.isFinite(ho) ? ho : 0) + (Number.isFinite(co) ? co : 0);
}

/**
 * Quantity for catalog grid/list stock pills.
 * Audited = Zoho + remaining Diff (same as the product detail Audited column).
 * Returns 0 when the product has never been audited.
 */
export function catalogGridAuditedStockQty(
  snapshot: CatalogProductAuditSnapshot | null | undefined,
  currentZohoQty?: number | null,
): number {
  if (!snapshot) return 0;
  if (currentZohoQty != null && Number.isFinite(currentZohoQty)) {
    const adjusted = resolveAdjustedAuditDisplay({
      currentZohoQty,
      snapshot,
      livePhysicalQty: null,
    });
    if (adjusted.displayAuditedQty != null && Number.isFinite(adjusted.displayAuditedQty)) {
      return adjusted.displayAuditedQty;
    }
  }
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
  return catalogGridAuditedStockQty(product.auditSnapshot, product.stock);
}

export interface AdjustedAuditDisplay {
  hasAuditSnapshot: boolean;
  /**
   * Audited stock: follows Zoho on sales; stays put when Zoho inbound
   * consumes pending Diff (currentZoho + live Diff).
   */
  displayAuditedQty: number | null;
  /**
   * Diff from last physical, reduced when Zoho inbound catches up to Audited.
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
 * Sales: Diff stays locked, Audited = Zoho + Diff.
 * Zoho inbound that closes the gap: Diff shrinks, Audited stays.
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
  const prevZoho = Number(snapshot.zohoQtyAtAudit);
  const liveDiff = Number.isFinite(prevZoho)
    ? nextAuditDiffAfterZohoChange(prevZoho, currentZohoQty, lockedDiff)
    : lockedDiff;
  const displayAuditedQty = currentZohoQty + liveDiff;
  const lastPhysicalAt = snapshot.lastPhysicalAuditedAt ?? snapshot.lastAuditedAt;
  const lastPhysicalBy = snapshot.lastPhysicalAuditedByName ?? snapshot.lastAuditedByName;

  return {
    hasAuditSnapshot: true,
    displayAuditedQty,
    displayDifference: liveDiff,
    physicalQtyAtAudit: displayAuditedQty,
    zohoQtyAtAudit: snapshot.zohoQtyAtAudit,
    lastAuditedAt: lastPhysicalAt,
    lastAuditedByName: lastPhysicalBy,
    baselineDifference: liveDiff,
    livePhysicalQty,
    lastAuditCycleId: snapshot.lastAuditCycleId ?? null,
  };
}
