import React from 'react';
import { IndianRupee } from 'lucide-react';
import type { DealerUnitPrice } from '../../types/priceLevels';

type Props = {
  listRate: number;
  pricing?: DealerUnitPrice | null;
  className?: string;
  iconSize?: number;
};

/**
 * Catalog / cart unit price for dealers:
 * - discount → strikethrough list + charge (“for you”)
 * - increment → charge only
 * - none / staff → list
 */
export const DealerPriceDisplay: React.FC<Props> = ({
  listRate,
  pricing,
  className = '',
  iconSize = 14,
}) => {
  const mode = pricing?.mode ?? 'none';
  const charge = pricing?.chargeRate ?? listRate;
  const showDual = mode === 'discount' && charge < listRate;

  if (showDual) {
    return (
      <div className={`dealer-price ${className}`.trim()}>
        <span className="dealer-price__list">
          <IndianRupee size={iconSize - 2} strokeWidth={2.5} aria-hidden />
          <span>{listRate.toLocaleString('en-IN')}</span>
        </span>
        <span className="dealer-price__charge">
          <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
          <span>{charge.toLocaleString('en-IN')}</span>
          <span className="dealer-price__for-you">for you</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`dealer-price dealer-price--single ${className}`.trim()}>
      <IndianRupee size={iconSize} strokeWidth={2.5} aria-hidden />
      <span>{charge.toLocaleString('en-IN')}</span>
    </div>
  );
};
