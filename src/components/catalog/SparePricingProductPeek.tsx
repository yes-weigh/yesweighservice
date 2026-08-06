import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, IndianRupee, Loader2, Package, X } from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import {
  fetchCatalogProductDetail,
  formatCurrency,
  setCatalogProductHidden,
} from '../../lib/catalog';
import { catalogGridStockQty } from '../../lib/catalogProductAudit/display';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { ProductImageFrame } from './ProductImageFrame';
import { StockBadge, StockQuantity } from './StockBadge';

type Props = {
  product: CatalogProduct;
  onClose: () => void;
  /** Called after the product is hidden from the catalogue. */
  onHidden: (productId: string) => void;
};

export const SparePricingProductPeek: React.FC<Props> = ({
  product,
  onClose,
  onHidden,
}) => {
  const confirm = useConfirm();
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = detail ?? product;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    void fetchCatalogProductDetail(product.id)
      .then(next => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        /* list row is enough for preview */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hiding) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hiding]);

  const handleHide = async () => {
    if (hiding) return;
    const ok = await confirm({
      title: 'Hide from catalogue?',
      message: `“${display.name}” will no longer appear in the dealer/public catalogue or spare pricing. The item stays active in Zoho.`,
      confirmLabel: 'Hide from catalogue',
      destructive: true,
    });
    if (!ok) return;

    setHiding(true);
    setError(null);
    try {
      await setCatalogProductHidden(product.id, true);
      onHidden(product.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hide from catalogue.');
    } finally {
      setHiding(false);
    }
  };

  const stockQty = catalogGridStockQty(display);
  const stockStatus = stockQty <= 0
    ? 'out_of_stock' as const
    : display.stockStatus === 'low_stock'
      ? 'low_stock' as const
      : 'in_stock' as const;
  const warehouses = detail?.warehouses?.filter(w => w.warehouseName && w.stock > 0) ?? [];

  return createPortal(
    <div
      className="catalog-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!hiding) onClose();
      }}
    >
      <div
        className="catalog-modal panel glass spare-pricing-peek"
        role="dialog"
        aria-modal="true"
        aria-label={display.name}
        onClick={event => event.stopPropagation()}
      >
        <div className="spare-pricing-peek__scroll">
          <div className="catalog-modal__hero">
            {display.imageUrl ? (
              <ProductImageFrame src={display.imageUrl} alt="" variant="card" />
            ) : (
              <span className="catalog-modal__placeholder" aria-hidden>
                <Package size={40} />
              </span>
            )}
          </div>

          <div className="catalog-modal__body">
            <div className="catalog-modal__meta">
              {display.sku ? <span className="catalog-modal__sku">{display.sku}</span> : null}
              {display.categoryName ? (
                <span className="text-muted text-sm">{display.categoryName}</span>
              ) : null}
              <h2 className="spare-pricing-peek__title">{display.name}</h2>
              <div className="spare-pricing-peek__badges">
                <StockBadge status={display.stockStatus} variant="tile" />
                <StockQuantity
                  stock={stockQty}
                  unit={display.unit || 'pcs'}
                  status={stockStatus}
                  compact
                />
                {detailLoading ? (
                  <span className="text-muted text-sm spare-pricing-peek__loading">
                    <Loader2 size={14} className="spin-icon" aria-hidden />
                    Refreshing…
                  </span>
                ) : null}
              </div>
              <div className="catalog-modal__price">
                <span>Selling price</span>
                <strong>
                  <IndianRupee size={18} strokeWidth={2.5} aria-hidden />
                  {display.rate.toLocaleString('en-IN')}
                </strong>
              </div>
              {display.description ? (
                <p className="catalog-modal__description">{display.description}</p>
              ) : null}
              <div className="catalog-modal__tax">
                {display.hsn ? <span>HSN {display.hsn}</span> : null}
                {display.taxName ? (
                  <span>
                    {display.taxName}
                    {display.taxPercentage ? ` (${display.taxPercentage}%)` : ''}
                  </span>
                ) : null}
                <span>{formatCurrency(display.rate)}</span>
              </div>
            </div>

            {warehouses.length > 0 ? (
              <div className="catalog-modal__warehouses">
                <h3>Warehouse stock</h3>
                <ul>
                  {warehouses.map(w => (
                    <li key={w.warehouseId}>
                      <span>{w.warehouseName}</span>
                      <strong>
                        {w.stock.toLocaleString('en-IN')}
                        {display.unit ? ` ${display.unit}` : ' pcs'}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? (
              <p className="spare-pricing-peek__error" role="alert">{error}</p>
            ) : null}
          </div>
        </div>

        <div className="spare-pricing-peek__footer">
          <button
            type="button"
            className="btn btn-secondary spare-pricing-peek__close-btn"
            onClick={onClose}
            disabled={hiding}
          >
            <X size={18} aria-hidden />
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary spare-pricing-peek__hide-btn"
            onClick={() => void handleHide()}
            disabled={hiding}
          >
            {hiding
              ? <Loader2 size={16} className="spin-icon" aria-hidden />
              : <EyeOff size={16} aria-hidden />}
            {hiding ? 'Hiding…' : 'Hide from catalogue'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
