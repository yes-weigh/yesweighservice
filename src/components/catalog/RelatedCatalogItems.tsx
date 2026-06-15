import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, Package } from 'lucide-react';
import type { CatalogProduct } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge, StockQuantity } from './StockBadge';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const RelatedCatalogItems: React.FC<{
  items: CatalogProduct[];
  title: string;
  emptyMessage: string;
  detailBasePath: string;
  loading?: boolean;
  headerAction?: React.ReactNode;
  showStockQuantity?: boolean;
}> = ({ items, title, emptyMessage, detailBasePath, loading = false, headerAction, showStockQuantity = false }) => {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="product-detail-page__section related-catalog">
        <div className="related-catalog__header">
          <h2>{title}</h2>
          {headerAction}
        </div>
        <p className="text-muted text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="product-detail-page__section related-catalog">
      <div className="related-catalog__header">
        <h2>{title}</h2>
        {headerAction}
      </div>
      {items.length === 0 ? (
        <p className="related-catalog__empty text-muted text-sm">{emptyMessage}</p>
      ) : (
        <ul className="related-catalog__list">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                className="related-catalog__item"
                onClick={() =>
                  navigate(`${detailBasePath}/${item.id}`, { state: { preview: item } })
                }
              >
                <div className="related-catalog__media">
                  <StockBadge status={item.stockStatus} overlay variant="tile" />
                  {item.imageUrl ? (
                    <CategoryThumbnail src={item.imageUrl} />
                  ) : (
                    <Package size={24} aria-hidden />
                  )}
                </div>
                <div className="related-catalog__info">
                  {item.sku && <span className="related-catalog__sku">{item.sku}</span>}
                  <span className="related-catalog__name">{formatProductTitle(item.name)}</span>
                  {item.categoryName && (
                    <span className="related-catalog__category text-muted text-sm">
                      {item.categoryName}
                    </span>
                  )}
                  {showStockQuantity && (
                    <StockQuantity
                      stock={item.stock}
                      unit={item.unit}
                      status={item.stockStatus}
                      compact
                    />
                  )}
                </div>
                <div className="related-catalog__price">
                  <IndianRupee size={13} strokeWidth={2.5} aria-hidden />
                  <span>{item.rate.toLocaleString('en-IN')}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
