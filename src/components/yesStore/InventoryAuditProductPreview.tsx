import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  GitCompare,
  Hash,
  IndianRupee,
  Link2,
  Package,
  Tag,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StockBadge } from '../catalog/StockBadge';
import { formatCurrency, formatStockQuantity } from '../../lib/catalog';
import {
  collectWarehouseAuditPhotos,
  formatQtyDifference,
  resolveGroupLinkInfo,
  resolveGroupWarehouseCount,
  resolveAuditorDisplayName,
  type InventoryAuditGroupTotals,
} from '../../lib/yesStore/inventoryAudit';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import { resolveYesStorePhotoUrls } from '../../lib/yesStore/photos';
import type { CatalogProduct } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';
import { AuditIconPanel, AuditIconRow, type AuditIconTone } from './AuditIconRow';

interface InventoryAuditProductPreviewProps {
  product: CatalogProduct;
  items: YesStoreItemDoc[];
  totals: InventoryAuditGroupTotals;
  linkerNamesByUid?: Map<string, string>;
}

function iconMetaForLabel(label: string): { icon: LucideIcon; tone: AuditIconTone } {
  switch (label) {
    case 'HSN':
      return { icon: Hash, tone: 'blue' };
    case 'SKU':
      return { icon: Tag, tone: 'indigo' };
    case 'Price':
      return { icon: IndianRupee, tone: 'amber' };
    case 'Last audited':
      return { icon: Calendar, tone: 'teal' };
    case 'Audited by':
      return { icon: User, tone: 'orange' };
    case 'Linked by':
      return { icon: Link2, tone: 'purple' };
    case 'Linked at':
      return { icon: Calendar, tone: 'teal' };
    case 'Stock in zoho':
      return { icon: Package, tone: 'purple' };
    case 'Audited quantity':
      return { icon: CheckCircle2, tone: 'green' };
    case 'Difference':
      return { icon: GitCompare, tone: 'amber' };
    default:
      return { icon: Package, tone: 'blue' };
  }
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
  const warehousePhotos = useMemo(() => collectWarehouseAuditPhotos(items), [items]);
  const [warehousePhotoUrls, setWarehousePhotoUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void resolveYesStorePhotoUrls(warehousePhotos).then(urls => {
      if (!cancelled) setWarehousePhotoUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [warehousePhotos]);

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

  const differenceClass =
    totals.difference != null && totals.difference !== 0
      ? `is-audit-diff ${totals.difference > 0 ? 'is-over' : 'is-under'}`
      : 'is-audit-diff';

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
    { label: 'Difference', value: differenceText, valueClass: differenceClass },
  ];

  return (
    <div className="catalog-product-link-preview inventory-audit-product-preview">
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

      <AuditIconPanel>
        {infoRows.map(row => {
          const meta = iconMetaForLabel(row.label);
          return (
            <AuditIconRow
              key={row.label}
              icon={meta.icon}
              tone={meta.tone}
              label={row.label}
              value={row.value}
            />
          );
        })}
      </AuditIconPanel>

      <AuditIconPanel className="inventory-audit-product-preview__qty-specs">
        {qtyRows.map(row => {
          const meta = iconMetaForLabel(row.label);
          return (
            <AuditIconRow
              key={row.label}
              icon={meta.icon}
              tone={meta.tone}
              label={row.label}
              value={row.value}
              valueClassName={row.valueClass}
            />
          );
        })}
      </AuditIconPanel>
    </div>
  );
};
