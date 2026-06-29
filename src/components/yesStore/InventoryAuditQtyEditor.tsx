import React from 'react';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import {
  readItemCountedAt,
  readItemCountedByName,
} from '../../lib/yesStore/inventoryAudit';
import { readItemQuantity, type YesStoreItemDoc } from '../../types/yes-store';

export interface InventoryAuditQtyEditorProps {
  item: YesStoreItemDoc;
  compact?: boolean;
}

/** Read-only counted qty for admin audit views. Warehouse staff update counts in YesStore. */
export const InventoryAuditQtyEditor: React.FC<InventoryAuditQtyEditorProps> = ({
  item,
  compact = false,
}) => {
  const quantity = readItemQuantity(item);
  const auditedAt = readItemCountedAt(item);
  const auditedBy = readItemCountedByName(item);

  return (
    <div
      className={`catalog-inventory-audit-qty-editor catalog-inventory-audit-qty-editor--readonly${
        compact ? ' catalog-inventory-audit-qty-editor--compact' : ''
      }`}
    >
      <div className="catalog-inventory-audit-qty-editor__field">
        <span className="catalog-inventory-audit-qty-editor__label">Counted qty</span>
        <span className="catalog-inventory-audit-qty-editor__value">{quantity}</span>
      </div>

      <p className="catalog-inventory-audit-qty-editor__meta text-muted">
        Last audited: <strong>{formatAuditDateTime(auditedAt)}</strong>
        {' · '}
        By: <strong>{auditedBy}</strong>
      </p>
    </div>
  );
};
