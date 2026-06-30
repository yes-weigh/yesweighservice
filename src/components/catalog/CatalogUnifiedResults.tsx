import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import type { CatalogProduct } from '../../types/catalog';
import { buildProductNavState, buildSpareNavState } from '../../lib/catalogNav';
import { ProductBrowseCard } from './ProductBrowseCard';

function matchesQuery(product: CatalogProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    product.name.toLowerCase().includes(q)
    || (product.sku ?? '').toLowerCase().includes(q)
    || (product.categoryName ?? '').toLowerCase().includes(q)
  );
}

export interface CatalogUnifiedResultsProps {
  query: string;
  products: CatalogProduct[];
  spares: CatalogProduct[];
  productsBasePath: string;
  sparesBasePath: string;
  enableCart?: boolean;
  showStockQuantity?: boolean;
  unlinkedSpareIds?: Set<string>;
  onLinkSpare?: (spare: CatalogProduct) => void;
  isLoading?: boolean;
}

export const CatalogUnifiedResults: React.FC<CatalogUnifiedResultsProps> = ({
  query,
  products,
  spares,
  productsBasePath,
  sparesBasePath,
  enableCart = false,
  showStockQuantity = false,
  unlinkedSpareIds,
  onLinkSpare,
  isLoading = false,
}) => {
  const navigate = useNavigate();

  const spareIdSet = useMemo(() => new Set(spares.map(spare => spare.id)), [spares]);

  const productHits = useMemo(
    () => products.filter(p => matchesQuery(p, query) && !spareIdSet.has(p.id)),
    [products, query, spareIdSet],
  );

  const spareHits = useMemo(
    () => spares.filter(p => matchesQuery(p, query)),
    [spares, query],
  );

  if (isLoading) {
    return (
      <div className="catalog-loading panel glass">
        <div className="loader-ring" />
        <p className="text-muted">Searching catalog…</p>
      </div>
    );
  }

  if (productHits.length === 0 && spareHits.length === 0) {
    return (
      <div className="catalog-empty panel glass">
        <Package size={40} />
        <p>No matches for &ldquo;{query.trim()}&rdquo;</p>
        <span className="text-muted text-sm">
          Try a product name, spare part name, or SKU.
        </span>
      </div>
    );
  }

  const openProduct = (product: CatalogProduct) => {
    navigate(`${productsBasePath}/${product.id}`, {
      state: buildProductNavState(product, {
        origin: 'search',
        returnCategoryId: product.categoryId ?? '',
        searchQuery: query,
      }),
    });
  };

  const openSpare = (spare: CatalogProduct) => {
    const isUnlinked = unlinkedSpareIds?.has(spare.id);
    navigate(`${sparesBasePath}/${spare.id}`, {
      state: buildSpareNavState(spare, {
        origin: isUnlinked ? 'unlinked' : 'search',
        searchQuery: query,
      }),
    });
  };

  return (
    <div className="catalog-unified-results">
      {productHits.length > 0 && (
        <section className="catalog-unified-results__section">
          <h2 className="catalog-unified-results__heading">
            Products
            <span className="catalog-unified-results__count">{productHits.length}</span>
          </h2>
          <div className="catalog-grid catalog-grid--tiles">
            {productHits.map((product, idx) => (
              <ProductBrowseCard
                key={product.id}
                product={product}
                index={idx}
                onSelect={() => openProduct(product)}
                enableCart={enableCart}
                showStockQuantity={showStockQuantity}
              />
            ))}
          </div>
        </section>
      )}

      {spareHits.length > 0 && (
        <section className="catalog-unified-results__section">
          <h2 className="catalog-unified-results__heading">
            Spare parts
            <span className="catalog-unified-results__count">{spareHits.length}</span>
          </h2>
          <div className="catalog-grid catalog-grid--tiles">
            {spareHits.map((spare, idx) => (
              <ProductBrowseCard
                key={spare.id}
                product={spare}
                index={idx}
                onSelect={() => openSpare(spare)}
                enableCart={enableCart}
                showStockQuantity={showStockQuantity}
                manageLabel={onLinkSpare && unlinkedSpareIds?.has(spare.id) ? 'Link to products' : undefined}
                onManage={
                  onLinkSpare && unlinkedSpareIds?.has(spare.id)
                    ? event => {
                        event.stopPropagation();
                        onLinkSpare(spare);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
