import React, { useEffect, useState } from 'react';
import { IndianRupee, Package, X } from 'lucide-react';
import { fetchCatalogProductDetail, formatCurrency } from '../../lib/catalog';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { StockBadge } from './StockBadge';

export const ProductDetailModal: React.FC<{
  product: CatalogProduct;
  onClose: () => void;
}> = ({ product: initialProduct, onClose }) => {
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct>(initialProduct);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    void fetchCatalogProductDetail(initialProduct.id)
      .then(detail => {
        if (!active) return;
        if (!detail.imageUrl && initialProduct.imageUrl) {
          detail.imageUrl = initialProduct.imageUrl;
        }
        setProduct(detail);
      })
      .catch(() => {
        if (active) setProduct(initialProduct);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialProduct]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const detail = product as CatalogProductDetail;

  return (
    <div className="catalog-modal-backdrop" onClick={onClose} role="presentation">
      <div className="catalog-modal panel glass" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="catalog-modal__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="catalog-modal__hero">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="catalog-modal__image" />
          ) : (
            <Package size={48} className="catalog-modal__placeholder" />
          )}
        </div>

        <div className="catalog-modal__body">
          {product.sku && <p className="catalog-modal__sku">{product.sku}</p>}
          <h2>{product.name}</h2>
          {product.categoryName && (
            <p className="text-muted text-sm">Category: {product.categoryName}</p>
          )}

          <div className="catalog-modal__meta">
            <StockBadge status={product.stockStatus} stock={product.stock} unit={product.unit} />
            <div className="catalog-modal__price">
              <span>Price</span>
              <strong>
                <IndianRupee size={16} />
                {formatCurrency(product.rate).replace('₹', '')}
              </strong>
            </div>
          </div>

          {loading ? (
            <p className="text-muted text-sm">Loading live stock details…</p>
          ) : (
            <>
              {detail.description && (
                <p className="catalog-modal__description">{detail.description}</p>
              )}
              {(detail.hsn || detail.taxName) && (
                <div className="catalog-modal__tax">
                  {detail.hsn && <span>HSN: {detail.hsn}</span>}
                  {detail.taxName && (
                    <span>
                      Tax: {detail.taxName}
                      {detail.taxPercentage ? ` (${detail.taxPercentage}%)` : ''}
                    </span>
                  )}
                </div>
              )}
              {detail.preferredVendor && (
                <p className="text-sm text-muted">Vendor: {detail.preferredVendor}</p>
              )}
              {detail.warehouses?.length > 0 && (
                <div className="catalog-modal__warehouses">
                  <h3>Warehouse stock</h3>
                  <ul>
                    {detail.warehouses.map(w => (
                      <li key={w.warehouseId}>
                        <span>{w.warehouseName}</span>
                        <strong>{w.stock} {product.unit}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
