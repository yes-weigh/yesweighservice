import React, { useState } from 'react';
import { Link2, X } from 'lucide-react';
import { CatalogProductLinkPicker } from './CatalogProductLinkPicker';
import { useAuth } from '../../context/AuthContext';
import { batchLinkYesStoreItemsToCatalog } from '../../lib/yesStore/data';
import { syncCatalogAuditImagesToZoho } from '../../lib/yesStore/syncAuditImages';
import { formatItemLocationShort, type YesStoreItemDoc } from '../../types/yes-store';
import type { CatalogProduct } from '../../types/catalog';

interface InventoryAuditBatchLinkModalProps {
  items: YesStoreItemDoc[];
  products: CatalogProduct[];
  catalogLoading?: boolean;
  onClose: () => void;
  onLinked: (catalogProductId: string) => void;
}

export const InventoryAuditBatchLinkModal: React.FC<InventoryAuditBatchLinkModalProps> = ({
  items,
  products,
  catalogLoading = false,
  onClose,
  onLinked,
}) => {
  const { user } = useAuth();
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const handleLink = async () => {
    if (!selectedProduct || !user || !items.length) return;
    setLinking(true);
    setError('');
      try {
        await batchLinkYesStoreItemsToCatalog(
          items.map(item => item.id),
          selectedProduct,
          user.uid,
          { linkedByName: user.displayName, mode: 'unit' },
        );
        // Photo sync is slow — finish linking immediately and sync in background.
        void syncCatalogAuditImagesToZoho(selectedProduct.id).catch(err => {
          console.warn('Zoho audit photo sync failed after batch link:', err);
        });
        onLinked(selectedProduct.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not link selected items.');
      } finally {
        setLinking(false);
      }
  };

  return (
    <div className="spare-link-editor-backdrop" role="presentation" onClick={onClose}>
      <div
        className="inventory-audit-batch-link panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-audit-batch-link-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="inventory-audit-batch-link__header">
          <div>
            <p className="inventory-audit-batch-link__eyebrow">
              <Link2 size={14} aria-hidden />
              <span>Batch link</span>
            </p>
            <h2 id="inventory-audit-batch-link-title">
              Link {items.length} warehouse item{items.length === 1 ? '' : 's'} to Zoho
            </h2>
            <p className="text-muted text-sm">
              Selected bins will count as the same Zoho item at different locations (quantities are summed).
            </p>
          </div>
          <button type="button" className="spare-link-editor__close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <ul className="inventory-audit-batch-link__items">
          {items.map(item => (
            <li key={item.id}>
              {formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber)}
            </li>
          ))}
        </ul>

        <CatalogProductLinkPicker
          products={products}
          value={selectedProduct}
          onChange={setSelectedProduct}
          loading={catalogLoading}
          disabled={linking}
        />

        {error && <p className="inventory-audit-batch-link__error">{error}</p>}

        <footer className="inventory-audit-batch-link__actions">
          <button type="button" className="btn btn-secondary" disabled={linking} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selectedProduct || linking || catalogLoading}
            onClick={() => void handleLink()}
          >
            {linking ? 'Linking…' : `Link ${items.length} item${items.length === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  );
};
