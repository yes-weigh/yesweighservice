import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, X } from 'lucide-react';
import type { CatalogProduct } from '../../types/catalog';
import {
  transferCatalogProductWarehouseStock,
  resolveCurrentZohoWarehouse,
  warehouseStockForName,
  ZOHO_PRIMARY_WAREHOUSES,
  type PrimaryWarehouseName,
} from '../../lib/catalogWarehouseTransfer';
import { formatStockQuantity } from '../../lib/catalog';

type Props = {
  product: CatalogProduct;
  auditedLocationLabel?: string | null;
  onClose: () => void;
  onTransferred: (result: {
    warehouses: CatalogProduct['warehouses'];
    stock: number;
  }) => void;
};

export const WarehouseLocationTransferDialog: React.FC<Props> = ({
  product,
  auditedLocationLabel = null,
  onClose,
  onTransferred,
}) => {
  const current = useMemo(
    () => resolveCurrentZohoWarehouse(product.warehouses),
    [product.warehouses],
  );
  const [selected, setSelected] = useState<PrimaryWarehouseName | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => ZOHO_PRIMARY_WAREHOUSES.map(name => ({
      name,
      stock: warehouseStockForName(product.warehouses, name),
      isCurrent: current === name,
    })),
    [product.warehouses, current],
  );

  const moveQty = useMemo(() => {
    if (!selected || !current || selected === current) return 0;
    return warehouseStockForName(product.warehouses, current);
  }, [selected, current, product.warehouses]);

  const handleConfirm = async () => {
    if (!selected || !current || selected === current || moveQty <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transferCatalogProductWarehouseStock(
        product.id,
        selected,
        moveQty,
      );
      onTransferred({
        warehouses: result.warehouses,
        stock: result.stock,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Zoho location.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="warehouse-location-dialog__backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="warehouse-location-dialog panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warehouse-location-dialog-title"
      >
        <header className="warehouse-location-dialog__header">
          <div className="warehouse-location-dialog__heading">
            <MapPin size={18} aria-hidden />
            <div>
              <h2 id="warehouse-location-dialog-title">Update Zoho location</h2>
              <p className="warehouse-location-dialog__sub">
                {product.sku ? `${product.sku} · ` : ''}{product.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        {auditedLocationLabel ? (
          <p className="warehouse-location-dialog__audit-note">
            Audited location stays <strong>{auditedLocationLabel}</strong> — this only
            corrects Zoho warehouse stock.
          </p>
        ) : (
          <p className="warehouse-location-dialog__audit-note">
            Audit records and logs are not changed. Only Zoho warehouse stock moves.
          </p>
        )}

        <p className="warehouse-location-dialog__label">Current Zoho location</p>
        <ul className="warehouse-location-dialog__list">
          {rows.map(row => (
            <li key={row.name}>
              <button
                type="button"
                className={[
                  'warehouse-location-dialog__option',
                  row.isCurrent ? 'is-current' : '',
                  selected === row.name ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                disabled={row.isCurrent || busy}
                onClick={() => setSelected(row.name)}
              >
                <span className="warehouse-location-dialog__option-name">
                  {row.name}
                  {row.isCurrent ? ' · current' : ''}
                </span>
                <span className="warehouse-location-dialog__option-stock">
                  {formatStockQuantity(row.stock, product.unit)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="warehouse-location-dialog__hint">
          Tap the destination warehouse, then confirm.
        </p>

        {error && (
          <p className="warehouse-location-dialog__error" role="alert">{error}</p>
        )}

        <footer className="warehouse-location-dialog__actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || selected === current || moveQty <= 0 || busy}
            onClick={() => void handleConfirm()}
          >
            {busy
              ? 'Updating…'
              : selected && moveQty > 0
                ? `Move ${formatStockQuantity(moveQty, product.unit)} to ${selected}`
                : 'Confirm'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};
