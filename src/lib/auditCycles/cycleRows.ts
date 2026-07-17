import type { CatalogProduct } from '../../types/catalog';
import type { AuditCycleDoc, AuditCycleSite } from '../../types/audit-cycle';
import {
  CATALOG_INVENTORY_SITE_CONFIG,
} from '../catalogInventorySites';

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

/** AGM shortage row — only negative Diff (audited &lt; Zoho). */
export interface AgmShortageRow extends AuditCycleProductRow {
  counted: boolean;
}

export interface AgmShortageTotals extends AuditCycleRowTotals {
  /** SKUs with Zoho stock but no physical count in this cycle. */
  uncountedSkuCount: number;
  /** Sum of units short (−auditDiff). */
  unitsShort: number;
  /** Absolute shortage value (−diffValue). */
  shortageValue: number;
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

function siteZohoQty(product: CatalogProduct, site: AuditCycleSite): number {
  const warehouseName = CATALOG_INVENTORY_SITE_CONFIG[site].warehouseName;
  const target = warehouseName.trim().toLowerCase();
  const warehouses = product.warehouses ?? [];
  const match = warehouses.find(w => w.warehouseName.trim().toLowerCase() === target);
  if (match) return Number(match.stock ?? 0);
  // Stock attributed to another warehouse — not on this site's books.
  if (warehouses.length > 0) return 0;
  // No warehouse split from Zoho — fall back to org book stock.
  return Number(product.stock ?? 0);
}

/** Unique catalog SKUs with Zoho stock &gt; 0 on any of the given sites. */
export function countZohoStockItems(
  products: CatalogProduct[],
  sites: AuditCycleSite[],
): number {
  let count = 0;
  for (const product of products) {
    if (sites.some(site => siteZohoQty(product, site) > 0)) count += 1;
  }
  return count;
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

/**
 * AGM shortage rows for a cycle.
 * - Zoho = site warehouse stock (org stock fallback).
 * - Uncounted SKUs with Zoho stock → audited = 0.
 * - Only negative Diff (audited &lt; Zoho); overs and matches omitted.
 * Sorted by largest shortage value first.
 */
export function buildAgmShortageRows(
  products: CatalogProduct[],
  cycle: AuditCycleDoc,
): AgmShortageRow[] {
  const rows: AgmShortageRow[] = [];

  for (const product of products) {
    const zohoQty = siteZohoQty(product, cycle.site);
    if (!(zohoQty > 0)) continue;

    const counted = productBelongsToCycle(product, cycle);
    const auditedQty = counted ? siteAuditedQty(product, cycle.site) : 0;
    const auditDiff = auditedQty - zohoQty;
    if (!(auditDiff < 0)) continue;

    const rate = Number(product.rate ?? 0);
    const snap = product.auditSnapshot;
    const auditedAt = counted
      ? (snap?.lastPhysicalAuditedAt ?? snap?.lastAuditedAt ?? null)
      : null;

    rows.push({
      productId: product.id,
      sku: product.sku?.trim() || '—',
      name: product.name?.trim() || '—',
      zohoAtAudit: zohoQty,
      auditedQty,
      auditedAt,
      auditDiff,
      rate,
      diffValue: auditDiff * rate,
      counted,
    });
  }

  rows.sort((a, b) => {
    const valueCmp = a.diffValue - b.diffValue; // more negative first
    if (valueCmp !== 0) return valueCmp;
    return a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name);
  });
  return rows;
}

export function summarizeAgmShortageRows(rows: AgmShortageRow[]): AgmShortageTotals {
  const base = summarizeAuditCycleRows(rows);
  return {
    ...base,
    uncountedSkuCount: rows.reduce((n, row) => n + (row.counted ? 0 : 1), 0),
    unitsShort: -base.auditDiff,
    shortageValue: -base.diffValue,
  };
}

/**
 * Stock-confirmed rows for a cycle.
 * - Only physically counted SKUs in this cycle.
 * - Diff ≥ 0 (audited covers Zoho — match or over).
 * Sorted by confirmed stock value (audited × rate) descending.
 */
export function buildAgmConfirmedRows(
  products: CatalogProduct[],
  cycle: AuditCycleDoc,
): AgmShortageRow[] {
  const rows: AgmShortageRow[] = [];

  for (const product of products) {
    if (!productBelongsToCycle(product, cycle)) continue;

    const zohoQty = siteZohoQty(product, cycle.site);
    const auditedQty = siteAuditedQty(product, cycle.site);
    if (!(auditedQty > 0) && !(zohoQty > 0)) continue;

    const auditDiff = auditedQty - zohoQty;
    if (!(auditDiff >= 0)) continue;

    const rate = Number(product.rate ?? 0);
    const snap = product.auditSnapshot;
    const auditedAt = snap?.lastPhysicalAuditedAt ?? snap?.lastAuditedAt ?? null;

    rows.push({
      productId: product.id,
      sku: product.sku?.trim() || '—',
      name: product.name?.trim() || '—',
      zohoAtAudit: zohoQty,
      auditedQty,
      auditedAt,
      auditDiff,
      rate,
      diffValue: auditDiff * rate,
      counted: true,
    });
  }

  rows.sort((a, b) => {
    const valueCmp = (b.auditedQty * b.rate) - (a.auditedQty * a.rate);
    if (valueCmp !== 0) return valueCmp;
    return a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name);
  });
  return rows;
}

/** Confirmed stock book value = sum(audited × rate). */
export function confirmedStockValue(rows: AgmShortageRow[]): number {
  return rows.reduce((sum, row) => sum + row.auditedQty * row.rate, 0);
}
