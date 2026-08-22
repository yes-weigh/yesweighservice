import { AlertCircle, Star } from 'lucide-react';
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
        <span className="catalog-merch-badge catalog-merch-badge--new">
          <i className="catalog-merch-badge__icon" aria-hidden>
            <Star size={11} strokeWidth={2.4} fill="currentColor" />
          </i>
          New arrival
        </span>
      )}
      {product.discontinuedSoon === true && (
        <span className="catalog-merch-badge catalog-merch-badge--soon">
          <i className="catalog-merch-badge__icon" aria-hidden>
            <AlertCircle size={11} strokeWidth={2.6} />
          </i>
          Discontinued soon
        </span>
      )}
    </div>
  );
}
