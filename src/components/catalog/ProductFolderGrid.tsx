import React, { useEffect, useRef, useState } from 'react';
import type { CatalogProduct } from '../../types/catalog';
import { ProductBrowseCard } from './ProductBrowseCard';

export interface ProductFolderGridProps {
  products: CatalogProduct[];
  onProductSelect: (product: CatalogProduct) => void;
  onReorder: (products: CatalogProduct[]) => void;
  enableCart?: boolean;
  showStockQuantity?: boolean;
  manageItemLabel?: string;
  onManageItem?: (product: CatalogProduct) => void;
  spareLinkCountByProductId?: Map<string, number>;
  warehouseLinkedProductIds?: Set<string>;
}

export const ProductFolderGrid: React.FC<ProductFolderGridProps> = ({
  products,
  onProductSelect,
  onReorder,
  enableCart = false,
  showStockQuantity = false,
  manageItemLabel,
  onManageItem,
  spareLinkCountByProductId,
  warehouseLinkedProductIds,
}) => {
  const [localProducts, setLocalProducts] = useState<CatalogProduct[]>(products);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  const handleDragStart = (idx: number): React.DragEventHandler => e => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver: React.DragEventHandler = e => {
    e.preventDefault();
  };

  const handleDrop = (dropIdx: number): React.DragEventHandler => e => {
    e.preventDefault();
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === dropIdx) {
      dragIdx.current = null;
      return;
    }

    const next = [...localProducts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(dropIdx, 0, moved);
    const withOrder = next.map((product, index) => ({ ...product, displayOrder: index }));
    setLocalProducts(withOrder);
    void Promise.resolve().then(() => onReorder(withOrder));
    dragIdx.current = null;
  };

  const handleDragEnd: React.DragEventHandler = () => {
    dragIdx.current = null;
  };

  return (
    <>
      <p className="catalog-categories__hint text-muted text-sm">
        Drag to reorder products in this category
      </p>
      <div className="catalog-grid catalog-grid--tiles">
        {localProducts.map((product, idx) => (
          <ProductBrowseCard
            key={product.id}
            product={product}
            index={idx}
            editable
            onSelect={() => onProductSelect(product)}
            enableCart={enableCart}
            showStockQuantity={showStockQuantity}
            manageLabel={onManageItem ? manageItemLabel : undefined}
            onManage={
              onManageItem
                ? event => {
                    event.stopPropagation();
                    onManageItem(product);
                  }
                : undefined
            }
            linkedSpareCount={
              spareLinkCountByProductId !== undefined
                ? spareLinkCountByProductId.get(product.id) ?? 0
                : undefined
            }
            warehouseLinked={warehouseLinkedProductIds?.has(product.id)}
            dragProps={{
              draggable: true,
              onDragStart: handleDragStart(idx),
              onDragOver: handleDragOver,
              onDragLeave: () => undefined,
              onDrop: handleDrop(idx),
              onDragEnd: handleDragEnd,
            }}
          />
        ))}
      </div>
    </>
  );
};
