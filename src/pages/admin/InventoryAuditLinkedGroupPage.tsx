import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { CatalogProductLinkPreview } from '../../components/yesStore/CatalogProductLinkPreview';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { fetchCatalog, formatStockQuantity } from '../../lib/catalog';
import {
  calculateGroupTotals,
  formatQtyDifference,
} from '../../lib/yesStore/inventoryAudit';
import { listItemsByCatalogProduct } from '../../lib/yesStore/data';
import type { CatalogProduct } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';

export const InventoryAuditLinkedGroupPage: React.FC = () => {
  const { catalogProductId } = useParams<{ catalogProductId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = user?.role === 'super_admin' ? '/super-admin/catalog' : '/catalog';

  const [items, setItems] = useState<YesStoreItemDoc[]>([]);
  const [catalogProduct, setCatalogProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!catalogProductId) return;
    setLoading(true);
    setError('');
    try {
      const [groupItems, catalog] = await Promise.all([
        listItemsByCatalogProduct(catalogProductId),
        fetchCatalog(),
      ]);
      if (!groupItems.length) {
        setError('No warehouse bins linked to this catalog item.');
        setItems([]);
        setCatalogProduct(null);
        return;
      }
      setItems(groupItems);
      setCatalogProduct(catalog.items.find(p => p.id === catalogProductId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load linked audit group.');
    } finally {
      setLoading(false);
    }
  }, [catalogProductId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => calculateGroupTotals(items, catalogProduct),
    [items, catalogProduct],
  );

  const productName =
    items[0]?.catalogProductName?.trim() ||
    catalogProduct?.name ||
    'Linked item';

  const handleBack = useCallback(() => {
    navigate(`${base}?section=inventory-audit`, { replace: false });
  }, [navigate, base]);

  useCatalogPageHeader({
    title: productName,
    showBack: true,
    onBack: handleBack,
  });

  if (user?.role !== 'super_admin') {
    return <Navigate to={base} replace />;
  }

  if (!catalogProductId) {
    return <Navigate to={`${base}?section=inventory-audit`} replace />;
  }

  if (loading && items.length === 0) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <FetchingLoader label="Loading linked item…" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Linked group not found.'}</span>
        </div>
        <Link to={`${base}?section=inventory-audit`} className="btn btn-secondary btn-sm">
          Back to inventory audit
        </Link>
      </div>
    );
  }

  const diffClass =
    totals.difference != null && totals.difference !== 0
      ? totals.difference > 0
        ? ' is-over'
        : ' is-under'
      : '';

  return (
    <div className="page-content fade-in catalog-inventory-audit-detail">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {catalogProduct && (
        <section className="catalog-inventory-audit-detail__link panel glass">
          <CatalogProductLinkPreview product={catalogProduct} />
        </section>
      )}

      <section className="catalog-inventory-audit-detail__hero panel glass">
        <div className="catalog-inventory-audit-detail__qty-compare catalog-inventory-audit-detail__qty-compare--hero">
          <div className="catalog-inventory-audit-detail__qty-compare-item">
            <span className="catalog-inventory-audit-detail__qty-compare-label">Zoho qty</span>
            <strong>
              {catalogProduct
                ? formatStockQuantity(catalogProduct.stock, catalogProduct.unit)
                : totals.zohoQty ?? '—'}
            </strong>
          </div>
          <div className="catalog-inventory-audit-detail__qty-compare-item">
            <span className="catalog-inventory-audit-detail__qty-compare-label">
              {totals.mode === 'bundle' ? 'Complete units' : 'Total counted'}
            </span>
            <strong>{totals.countedQty}</strong>
          </div>
          <div className="catalog-inventory-audit-detail__qty-compare-item">
            <span className="catalog-inventory-audit-detail__qty-compare-label">Difference</span>
            <strong className={`catalog-inventory-audit-detail__qty-compare-diff${diffClass}`}>
              {totals.difference != null ? formatQtyDifference(totals.difference) : '—'}
            </strong>
          </div>
        </div>

        {totals.mode === 'bundle' && (
          <p className="catalog-inventory-audit-detail__bundle-note text-muted">
            Kit mode: complete units are the minimum whole sets that can be built from all parts.
            {totals.rawCountedQty > 0 && ` (${totals.rawCountedQty} part pieces counted in total.)`}
          </p>
        )}
      </section>

      <section className="catalog-inventory-audit-group-locations panel glass">
        <h2 className="catalog-inventory-audit-group-locations__title">
          Warehouse locations ({items.length})
        </h2>

        <div className="catalog-inventory-audit-group-locations__list">
          {totals.parts.map(part => (
            <article key={part.itemId} className="catalog-inventory-audit-group-locations__card">
              <div className="catalog-inventory-audit-group-locations__card-head">
                <div>
                  <strong>{part.partLabel}</strong>
                  <span className="text-muted catalog-inventory-audit-group-locations__location">
                    {part.location}
                  </span>
                </div>
                <Link
                  to={`${base}/inventory-audit/${part.itemId}`}
                  className="btn btn-secondary btn-sm catalog-inventory-audit-group-locations__edit"
                >
                  <ExternalLink size={14} aria-hidden />
                  Edit link
                </Link>
              </div>

              <div className="catalog-inventory-audit-group-locations__stats">
                <span>Counted: <strong>{part.countedQty}</strong></span>
                {totals.mode === 'bundle' && (
                  <>
                    <span>Per unit: <strong>{part.unitsPerProduct}</strong></span>
                    <span>Complete sets: <strong>{part.completeUnits}</strong></span>
                    <span>Leftover: <strong>{part.remainderQty}</strong></span>
                  </>
                )}
              </div>

              <div className="catalog-inventory-audit-detail__photos catalog-inventory-audit-group-locations__photos">
                {[0, 1].map(index => (
                  <div key={index} className="catalog-inventory-audit-detail__photo">
                    {part.photos[index] ? (
                      <img src={part.photos[index].url} alt={`${part.partLabel} photo ${index + 1}`} />
                    ) : (
                      <span className="catalog-inventory-audit-detail__photo-empty text-muted">No photo</span>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
