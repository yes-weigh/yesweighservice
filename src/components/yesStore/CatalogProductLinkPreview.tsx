import React from 'react';
import { Loader2, Package } from 'lucide-react';
import { StockBadge } from '../catalog/StockBadge';
import { ProductImageFrame } from '../catalog/ProductImageFrame';
import {
  formatCurrency,
  formatStockQuantity,
  stockStatusLabel,
} from '../../lib/catalog';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';

function buildDetailRows(product: CatalogProduct | CatalogProductDetail): { label: string; value: string }[] {
  const detail = product as CatalogProductDetail;
  const rows: { label: string; value: string }[] = [];

  if (product.sku) rows.push({ label: 'SKU', value: product.sku });
  if (product.categoryName) rows.push({ label: 'Category', value: product.categoryName });
  if (product.unit) rows.push({ label: 'Unit', value: product.unit });
  rows.push({ label: 'Price', value: formatCurrency(product.rate) });
  rows.push({ label: 'Stock on hand', value: formatStockQuantity(product.stock, product.unit) });
  rows.push({ label: 'Stock status', value: stockStatusLabel(product.stockStatus) });
  if (product.hsn) rows.push({ label: 'HSN', value: product.hsn });
  if (product.taxName) {
    rows.push({
      label: 'Tax',
      value: `${product.taxName}${product.taxPercentage ? ` (${product.taxPercentage}%)` : ''}`,
    });
  }
  if (product.status) {
    rows.push({
      label: 'Catalog status',
      value: product.status.charAt(0).toUpperCase() + product.status.slice(1),
    });
  }
  if (product.reorderLevel != null && product.reorderLevel > 0) {
    rows.push({ label: 'Reorder level', value: String(product.reorderLevel) });
  }
  if (detail.preferredVendor) rows.push({ label: 'Vendor', value: detail.preferredVendor });
  if (product.syncedAt) {
    rows.push({
      label: 'Last synced',
      value: new Date(product.syncedAt).toLocaleString('en-IN'),
    });
  }

  return rows;
}

interface CatalogProductLinkPreviewProps {
  product: CatalogProduct | CatalogProductDetail;
  loading?: boolean;
}

export const CatalogProductLinkPreview: React.FC<CatalogProductLinkPreviewProps> = ({
  product,
  loading,
}) => {
  const detail = product as CatalogProductDetail;
  const rows = buildDetailRows(product);
  const warehouses = detail.warehouses?.filter(w => w.warehouseName && w.stock > 0) ?? [];

  return (
    <div className="catalog-product-link-preview panel glass">
      <div className="catalog-product-link-preview__header">
        <div className="catalog-product-link-preview__media">
          {product.imageUrl ? (
            <ProductImageFrame src={product.imageUrl} alt="" variant="card" />
          ) : (
            <span className="catalog-product-link-preview__placeholder" aria-hidden>
              <Package size={28} />
            </span>
          )}
        </div>
        <div className="catalog-product-link-preview__intro">
          {product.categoryName && (
            <span className="catalog-product-link-preview__category text-muted text-sm">
              {product.categoryName}
            </span>
          )}
          <h3 className="catalog-product-link-preview__name">{product.name}</h3>
          <div className="catalog-product-link-preview__badges">
            <StockBadge status={product.stockStatus} variant="tile" />
            {loading && (
              <span className="catalog-product-link-preview__loading text-muted text-sm">
                <Loader2 size={14} className="spin-icon" aria-hidden />
                Loading details…
              </span>
            )}
          </div>
        </div>
      </div>

      {product.description && (
        <p className="catalog-product-link-preview__description text-sm">{product.description}</p>
      )}

      {rows.length > 0 && (
        <dl className="catalog-product-link-preview__specs">
          {rows.map(row => (
            <div key={row.label} className="catalog-product-link-preview__spec-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {warehouses.length > 0 && (
        <div className="catalog-product-link-preview__warehouses">
          <h4 className="catalog-product-link-preview__warehouses-title">Warehouse stock</h4>
          <ul className="catalog-product-link-preview__warehouse-list">
            {warehouses.map(w => (
              <li key={w.warehouseId}>
                <span>{w.warehouseName}</span>
                <strong>{formatStockQuantity(w.stock, product.unit)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
