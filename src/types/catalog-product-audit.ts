export type CatalogProductAuditTrigger =
  | 'warehouse_count'
  | 'cochin_inventory'
  | 'manual'
  | 'legacy_backfill'
  | 'zoho_sync';

export interface CatalogProductAuditLog {
  id: string;
  catalogProductId: string;
  auditedAt: string;
  auditedByUid: string | null;
  auditedByName: string | null;
  mode: 'unit' | 'bundle';
  /** Head office warehouse bin total (complete units in bundle mode). */
  headOfficeQty: number;
  /** Cochin warehouse site total. */
  cochinQty: number;
  /** Combined physical / adjusted audited qty at this entry. */
  physicalQty: number;
  /** Sum of raw part pieces when bundle mode. */
  rawPhysicalQty: number | null;
  /** Zoho stock at this entry. */
  zohoQtyAtAudit: number;
  /** physicalQty - zohoQtyAtAudit — locked Diff until the next physical audit. */
  baselineDifference: number;
  trigger: CatalogProductAuditTrigger;
}

export interface CatalogProductAuditSnapshot {
  lastAuditLogId: string;
  lastAuditedAt: string;
  lastAuditedByUid: string | null;
  lastAuditedByName: string | null;
  /** Locked variance from last physical audit. */
  baselineDifference: number;
  /** Last counted / Zoho-adjusted audited qty. */
  physicalQtyAtAudit: number;
  zohoQtyAtAudit: number;
  mode: 'unit' | 'bundle';
  headOfficeQtyAtAudit: number;
  cochinQtyAtAudit: number;
}
