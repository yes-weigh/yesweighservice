import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import {
  readItemAuditedAt,
  readItemAuditedByName,
  readItemAuditedByUid,
  resolveAuditorDisplayName,
} from '../../lib/yesStore/inventoryAudit';
import { updateInventoryAuditCount } from '../../lib/yesStore/data';
import { readItemQuantity, type YesStoreItemDoc } from '../../types/yes-store';

export interface InventoryAuditQtyEditorProps {
  item: YesStoreItemDoc;
  auditorNamesByUid?: Map<string, string>;
  compact?: boolean;
  onSaved?: (item: YesStoreItemDoc) => void;
}

export const InventoryAuditQtyEditor: React.FC<InventoryAuditQtyEditorProps> = ({
  item,
  auditorNamesByUid,
  compact = false,
  onSaved,
}) => {
  const { user } = useAuth();
  const quantity = readItemQuantity(item);
  const [value, setValue] = useState(String(quantity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedItem, setSavedItem] = useState(item);

  useEffect(() => {
    setSavedItem(item);
    setValue(String(readItemQuantity(item)));
  }, [item]);

  const parsed = Math.floor(Number(value));
  const valid = Number.isFinite(parsed) && parsed >= 1;
  const changed = valid && parsed !== readItemQuantity(savedItem);

  const auditedAt = readItemAuditedAt(savedItem);
  const auditedBy = resolveAuditorDisplayName(
    readItemAuditedByName(savedItem),
    readItemAuditedByUid(savedItem),
    auditorNamesByUid,
  );

  const handleSave = async () => {
    if (!user || !valid || !changed) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateInventoryAuditCount(item.id, parsed, {
        uid: user.uid,
        displayName: user.displayName,
      });
      setSavedItem(updated);
      onSaved?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`catalog-inventory-audit-qty-editor${
        compact ? ' catalog-inventory-audit-qty-editor--compact' : ''
      }`}
    >
      <label className="catalog-inventory-audit-qty-editor__field">
        <span className="catalog-inventory-audit-qty-editor__label">Counted qty</span>
        <div className="catalog-inventory-audit-qty-editor__controls">
          <input
            type="number"
            min={1}
            step={1}
            value={value}
            disabled={saving}
            onChange={event => setValue(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!changed || saving || !valid}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save count'}
          </button>
        </div>
      </label>

      {error && <p className="catalog-inventory-audit-qty-editor__error">{error}</p>}

      <p className="catalog-inventory-audit-qty-editor__meta text-muted">
        Last audited: <strong>{formatAuditDateTime(auditedAt)}</strong>
        {' · '}
        By: <strong>{auditedBy}</strong>
      </p>
    </div>
  );
};
