import type { CatalogProduct } from '../../types/catalog';

type MerchProduct = Pick<CatalogProduct, 'newArrival' | 'discontinuedSoon'>;

export function CatalogMerchBadges({
  product,
  className,
}: {
  product: MerchProduct;
  className?: string;
}) {
  if (product.newArrival !== true && product.discontinuedSoon !== true) return null;
  return (
    <div className={['catalog-merch-badges', className].filter(Boolean).join(' ')}>
      {product.newArrival === true && (
        <span className="catalog-merch-badge catalog-merch-badge--new">New arrival</span>
      )}
      {product.discontinuedSoon === true && (
        <span className="catalog-merch-badge catalog-merch-badge--soon">Discontinued soon</span>
      )}
    </div>
  );
}
