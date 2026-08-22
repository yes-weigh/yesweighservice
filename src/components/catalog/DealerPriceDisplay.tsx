import React from 'react';
import { IndianRupee } from 'lucide-react';
import { formatPriceLevelSlabLabels } from '../../lib/priceLevels';
import type { DealerUnitPrice } from '../../types/priceLevels';

type Props = {
  listRate: number;
  pricing?: DealerUnitPrice | null;
  className?: string;
  iconSize?: number;
  /** Show qty slab rows when the level defines them (grid / detail). */
  showSlabs?: boolean;
  /** Optional control after the list / charge (e.g. dealer MRP pencil). */
  trailing?: React.ReactNode;
};

/** Catalog MRP when dealer charge price is hidden from Sales / Service staff. */
export function CatalogMrpLabel({
  mrp,
  iconSize = 14,
  className = '',
}: {
  mrp: number | null | undefined;
  iconSize?: number;
  className?: string;
}) {
  if (mrp == null || !(Number(mrp) > 0)) return null;
  const value = Math.round(Number(mrp) * 100) / 100;
  return (
    <span className={['catalog-mrp-label', className].filter(Boolean).join(' ')}>
      <span className="catalog-mrp-label__tag">MRP</span>
      <span className="catalog-mrp-label__amount">
        <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
        {value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
    </span>
  );
}

/**
 * Catalog / cart unit price for dealers:
 * - discount, or fixed custom below list → strikethrough list + charge
 * - increment, or fixed custom at/above list → charge only
 * - qty slabs (when present) listed under the charge rate
 * - none / staff → list
 */
export const DealerPriceDisplay: React.FC<Props> = ({
  listRate,
  pricing,
  className = '',
  iconSize = 15,
  showSlabs = true,
  trailing,
}) => {
  const mode = pricing?.mode ?? 'none';
  const list = Math.round((Number(listRate) || 0) * 100) / 100;
  const charge = Math.round((Number(pricing?.chargeRate ?? listRate) || 0) * 100) / 100;
  const showDual = list > charge && (
    mode === 'discount' || mode === 'fixed' || trailing != null
  );
  const slabRows = showSlabs && pricing?.slabs?.length
    ? formatPriceLevelSlabLabels(pricing.slabs)
    : [];

  const rootClass = [
    'dealer-price',
    showDual ? 'dealer-price--dual' : '',
    !showDual && slabRows.length <= 1 ? 'dealer-price--single' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {showDual ? (
        <span className="dealer-price__pair">
          <span className="dealer-price__charge">
            <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
            <span>{charge.toLocaleString('en-IN')}</span>
          </span>
          <span className="dealer-price__list">
            <IndianRupee size={Math.max(10, iconSize - 3)} strokeWidth={2.5} aria-hidden />
            <span>{list.toLocaleString('en-IN')}</span>
          </span>
          {trailing}
        </span>
      ) : (
        <span className="dealer-price__pair">
          <span className="dealer-price__charge">
            <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
            <span>{charge.toLocaleString('en-IN')}</span>
          </span>
          {trailing}
        </span>
      )}
      {slabRows.length > 1 ? (
        <ul className="dealer-price__slabs" aria-label="Quantity rates">
          {slabRows.map(row => (
            <li key={`${row.minQty}-${row.rate}`}>
              <span>{row.label}</span>
              <span className="dealer-price__slabs-rate">
                <IndianRupee size={10} strokeWidth={2.5} aria-hidden />
                {row.rate.toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {pricing?.directorsQtyClubLabel ? (
        <p className="dealer-price__club-note">{pricing.directorsQtyClubLabel}</p>
      ) : null}
    </div>
  );
};
