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
};

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
}) => {
  const mode = pricing?.mode ?? 'none';
  const list = Math.round((Number(listRate) || 0) * 100) / 100;
  const charge = Math.round((Number(pricing?.chargeRate ?? listRate) || 0) * 100) / 100;
  const showDual = (mode === 'discount' || mode === 'fixed') && charge < list;
  const slabRows = showSlabs && pricing?.slabs?.length
    ? formatPriceLevelSlabLabels(pricing.slabs)
    : [];

  const rootClass = [
    'dealer-price',
    !showDual && slabRows.length <= 1 ? 'dealer-price--single' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {showDual ? (
        <>
          <span className="dealer-price__list">
            <IndianRupee size={iconSize - 2} strokeWidth={2.5} aria-hidden />
            <span>{list.toLocaleString('en-IN')}</span>
          </span>
          <span className="dealer-price__charge">
            <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
            <span>{charge.toLocaleString('en-IN')}</span>
          </span>
        </>
      ) : (
        <span className="dealer-price__charge">
          <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
          <span>{charge.toLocaleString('en-IN')}</span>
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
    </div>
  );
};
