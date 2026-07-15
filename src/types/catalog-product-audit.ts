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
  /** physicalQty - zohoQtyAtAudit at this entry. */
  baselineDifference: number;
  trigger: CatalogProductAuditTrigger;
  /** Open audit cycle when this physical count was recorded. */
  auditCycleId?: string | null;
}

export interface CatalogProductAuditSnapshot {
  lastAuditLogId: string;
  lastAuditedAt: string;
  lastAuditedByUid: string | null;
  lastAuditedByName: string | null;
  /** Diff at last physical audit (historical). Live Diff = physicalQtyAtAudit − current Zoho. */
  baselineDifference: number;
  /** Frozen physical count from last physical audit — does not move with Zoho sync. */
  physicalQtyAtAudit: number;
  zohoQtyAtAudit: number;
  mode: 'unit' | 'bundle';
  headOfficeQtyAtAudit: number;
  cochinQtyAtAudit: number;
  /** Last physical count (excludes zoho_sync). */
  lastPhysicalAuditedAt?: string | null;
  lastPhysicalAuditedByUid?: string | null;
  lastPhysicalAuditedByName?: string | null;
  /** Cycle id of the last physical count. */
  lastAuditCycleId?: string | null;
}
