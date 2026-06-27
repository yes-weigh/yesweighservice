import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Link2 } from 'lucide-react';
import { CatalogProductLinkPicker } from '../../components/yesStore/CatalogProductLinkPicker';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { fetchCatalog, formatStockQuantity } from '../../lib/catalog';
import { getItem, linkYesStoreItemToCatalog } from '../../lib/yesStore/data';
import type { CatalogProduct } from '../../types/catalog';
import {
  formatItemLocationShort,
  isYesStoreItemLinked,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';

export const InventoryAuditItemPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = user?.role === 'super_admin' ? '/super-admin/catalog' : '/catalog';

  const [item, setItem] = useState<YesStoreItemDoc | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);

  const loadItem = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError('');
    try {
      const data = await getItem(itemId);
      if (!data) {
        setError('Audit item not found.');
        setItem(null);
      } else {
        setItem(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit item.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchCatalog()
      .then(response => {
        if (!cancelled) setCatalogProducts(response.items);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load catalog.');
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!item?.catalogProductId || !catalogProducts.length) return;
    const linked = catalogProducts.find(p => p.id === item.catalogProductId);
    if (linked) setSelectedProduct(linked);
  }, [item?.catalogProductId, catalogProducts]);

  const linked = item ? isYesStoreItemLinked(item) : false;
  const canLink = selectedProduct && item && selectedProduct.id !== item.catalogProductId;

  const handleLink = async () => {
    if (!item || !selectedProduct || !user) return;
    setLinking(true);
    setError('');
    try {
      await linkYesStoreItemToCatalog(item.id, selectedProduct, user.uid);
      await loadItem();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link item.');
    } finally {
      setLinking(false);
    }
  };

  const handleBack = useCallback(() => {
    navigate(`${base}?section=inventory-audit`, { replace: false });
  }, [navigate, base]);

  useCatalogPageHeader({
    title: item ? formatItemLocationShort(item.rackId, item.rowNumber, item.binNumber) : 'Audit item',
    showBack: true,
    onBack: handleBack,
  });

  if (user?.role !== 'super_admin') {
    return <Navigate to={base} replace />;
  }

  if (!itemId) {
    return <Navigate to={`${base}?section=inventory-audit`} replace />;
  }

  if (loading && !item) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <FetchingLoader label="Loading audit item…" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page-content fade-in catalog-inventory-audit-detail">
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error || 'Audit item not found.'}</span>
        </div>
        <Link to={`${base}?section=inventory-audit`} className="btn btn-secondary btn-sm">
          Back to inventory audit
        </Link>
      </div>
    );
  }

  const photos = item.photos ?? [];
  const countedQty = readItemQuantity(item);
  const zohoQty = selectedProduct?.stock ?? null;
  const qtyDifference = zohoQty != null ? countedQty - zohoQty : null;

  const formatDifference = (value: number) => {
    if (value > 0) return `+${value}`;
    if (value < 0) return String(value);
    return '0';
  };

  return (
    <div className="page-content fade-in catalog-inventory-audit-detail">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="catalog-inventory-audit-detail__hero panel glass">
        <div className="catalog-inventory-audit-detail__summary">
          <p className="catalog-inventory-audit-detail__summary-line">
            Counted qty: <strong>{readItemQuantity(item)}</strong>
          </p>
          <span
            className={`catalog-inventory-audit-detail__status catalog-inventory-audit-detail__status--${
              linked ? 'linked' : 'unlinked'
            }`}
          >
            {linked ? 'Linked' : 'Unlinked'}
          </span>
        </div>

        <div className="catalog-inventory-audit-detail__photos">
          {[0, 1].map(index => (
            <div key={index} className="catalog-inventory-audit-detail__photo">
              {photos[index] ? (
                <img src={photos[index].url} alt={`Audit photo ${index + 1}`} />
              ) : (
                <span className="catalog-inventory-audit-detail__photo-empty text-muted">No photo</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="catalog-inventory-audit-detail__link panel glass">
        <h2 className="catalog-inventory-audit-detail__link-title">
          <Link2 size={18} aria-hidden />
          Link to Zoho catalog item
        </h2>

        <div className="catalog-inventory-audit-detail__link-form">
          <CatalogProductLinkPicker
            products={catalogProducts}
            value={selectedProduct}
            onChange={setSelectedProduct}
            loading={catalogLoading}
            disabled={linking}
          />

          {selectedProduct && (
            <div className="catalog-inventory-audit-detail__qty-compare">
              <div className="catalog-inventory-audit-detail__qty-compare-item">
                <span className="catalog-inventory-audit-detail__qty-compare-label">Zoho qty</span>
                <strong>{formatStockQuantity(selectedProduct.stock, selectedProduct.unit)}</strong>
              </div>
              <div className="catalog-inventory-audit-detail__qty-compare-item">
                <span className="catalog-inventory-audit-detail__qty-compare-label">Counted qty</span>
                <strong>{countedQty}</strong>
              </div>
              <div className="catalog-inventory-audit-detail__qty-compare-item">
                <span className="catalog-inventory-audit-detail__qty-compare-label">Difference</span>
                <strong
                  className={`catalog-inventory-audit-detail__qty-compare-diff${
                    qtyDifference != null && qtyDifference !== 0
                      ? qtyDifference > 0
                        ? ' is-over'
                        : ' is-under'
                      : ''
                  }`}
                >
                  {qtyDifference != null ? formatDifference(qtyDifference) : '—'}
                </strong>
              </div>
            </div>
          )}

          <div className="catalog-inventory-audit-detail__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canLink || linking || catalogLoading}
              onClick={() => void handleLink()}
            >
              {linking ? 'Linking…' : linked && canLink ? 'Update link' : 'Link item'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
