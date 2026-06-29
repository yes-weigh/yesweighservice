import React from 'react';
import { Package } from 'lucide-react';
import { StockBadge } from '../catalog/StockBadge';
import { formatCurrency, formatStockQuantity } from '../../lib/catalog';
import {
  collectWarehouseAuditPhotoUrls,
  formatQtyDifference,
  resolveGroupLinkInfo,
  resolveGroupWarehouseCount,
  resolveAuditorDisplayName,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import type { CatalogProduct } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';

interface InventoryAuditProductPreviewProps {
  product: CatalogProduct;
  items: YesStoreItemDoc[];
  totals: InventoryAuditGroupTotals;
  linkerNamesByUid?: Map<string, string>;
}

export const InventoryAuditProductPreview: React.FC<InventoryAuditProductPreviewProps> = ({
  product,
  items,
  totals,
  linkerNamesByUid,
}) => {
  const warehouseCount = resolveGroupWarehouseCount(items);
  const linkInfo = resolveGroupLinkInfo(items);
  const linkedBy = resolveAuditorDisplayName(
    linkInfo.linkedByName,
    linkInfo.linkedByUid,
    linkerNamesByUid,
  );
  const warehousePhotoUrls = collectWarehouseAuditPhotoUrls(items);
  const galleryUrls = [
    ...(product.imageUrl ? [product.imageUrl] : []),
    ...warehousePhotoUrls.filter(url => url !== product.imageUrl),
  ];

  const auditedQtyLabel =
    totals.mode === 'bundle'
      ? `${totals.countedQty} complete (${totals.rawCountedQty} parts)`
      : String(totals.countedQty);

  const differenceText =
    totals.difference != null ? formatQtyDifference(totals.difference) : '—';

  const infoRows: { label: string; value: string }[] = [
    ...(product.hsn ? [{ label: 'HSN', value: product.hsn }] : []),
    ...(product.sku ? [{ label: 'SKU', value: product.sku }] : []),
    { label: 'Price', value: formatCurrency(product.rate) },
    {
      label: 'Last audited',
      value: formatAuditDateTime(warehouseCount.lastCountedAt),
    },
    { label: 'Audited by', value: warehouseCount.countedByName },
    { label: 'Linked by', value: linkedBy },
    {
      label: 'Linked at',
      value: formatAuditDateTime(linkInfo.linkedAt),
    },
  ];

  const qtyRows: { label: string; value: string; valueClass?: string }[] = [
    { label: 'Stock in zoho', value: formatStockQuantity(product.stock, product.unit) },
    { label: 'Audited quantity', value: auditedQtyLabel, valueClass: 'is-audit-qty' },
    { label: 'Difference', value: differenceText, valueClass: 'is-audit-diff' },
  ];

  return (
    <div className="catalog-product-link-preview inventory-audit-product-preview panel glass">
      {galleryUrls.length > 0 ? (
        <div className="inventory-audit-product-preview__gallery" tabIndex={0}>
          <div className="inventory-audit-product-preview__gallery-track">
            {galleryUrls.map((url, index) => (
              <div key={`${url}-${index}`} className="inventory-audit-product-preview__gallery-item">
                <img
                  src={url}
                  alt={index === 0 && product.imageUrl === url ? product.name : `Warehouse photo ${index}`}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="inventory-audit-product-preview__gallery inventory-audit-product-preview__gallery--empty">
          <span className="catalog-product-link-preview__placeholder" aria-hidden>
            <Package size={28} />
          </span>
        </div>
      )}

      <div className="catalog-product-link-preview__header">
        <div className="catalog-product-link-preview__intro">
          <h3 className="catalog-product-link-preview__name">{product.name}</h3>
          <div className="catalog-product-link-preview__badges">
            <StockBadge status={product.stockStatus} variant="tile" />
          </div>
        </div>
      </div>

      <dl className="catalog-product-link-preview__specs">
        {infoRows.map(row => (
          <div key={row.label} className="catalog-product-link-preview__spec-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <dl className="catalog-product-link-preview__specs inventory-audit-product-preview__qty-specs">
        {qtyRows.map(row => (
          <div key={row.label} className="catalog-product-link-preview__spec-row">
            <dt>{row.label}</dt>
            <dd className={row.valueClass}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
