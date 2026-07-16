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
  /** Locked Diff at last physical audit. Live Audited = current Zoho + this Diff. */
  baselineDifference: number;
  /** Audited qty after last write (moves with Zoho sync to keep Diff locked). */
  physicalQtyAtAudit: number;
  zohoQtyAtAudit: number;
  mode: 'unit' | 'bundle';
  headOfficeQtyAtAudit: number;
  cochinQtyAtAudit: number;
  /** Last physical count (excludes zoho_sync). */
  lastPhysicalAuditedAt?: string | null;
  lastPhysicalAuditedByUid?: string | null;
  lastPhysicalAuditedByName?: string | null;
  /** Cycle id of the last physical count (any site). */
  lastAuditCycleId?: string | null;
  /** Last Head Office physical count cycle. */
  lastHeadOfficeAuditCycleId?: string | null;
  /** Last Cochin physical count cycle. */
  lastCochinAuditCycleId?: string | null;
}

export type CatalogStockMovementType =
  | 'invoice'
  | 'bill'
  | 'creditnote'
  | 'adjustment'
  | 'moveorder'
  | 'salesreturn'
  | 'package'
  | 'purchasereceive'
  | 'transferorder'
  | 'putaway';

export interface CatalogStockMovement {
  type: CatalogStockMovementType;
  typeLabel: string;
  documentId: string;
  documentNumber: string;
  date: string;
  createdTime: string;
  createdAt: string | null;
  status: string;
  customerOrVendor: string | null;
  quantity: number;
  /** Signed stock change (invoices negative). */
  qtyDelta: number;
  reference: string | null;
  itemPrice?: number | null;
  itemTotal?: number | null;
  /** Running stock after this movement (oldest→newest from listed txns only). */
  runningStock?: number | null;
}

export interface CatalogProductStockMovementsResult {
  catalogProductId: string;
  lifetime?: boolean;
  until: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  lookbackDays: number | null;
  movementCount: number;
  netDelta: number;
  currentStock?: number | null;
  /**
   * Zoho book stock minus sum of listed transactions.
   * Non-zero means stock is not fully explained by docs — investigate.
   */
  unexplainedGap?: number | null;
  /** @deprecated use unexplainedGap */
  openingStock?: number | null;
  fetchedAt?: string;
  movements: CatalogStockMovement[];
}
