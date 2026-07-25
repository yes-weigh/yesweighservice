import React from 'react';
import orderPlacedSealUrl from '../../assets/order-placed-seal.png';

type OrderPlacedSealProps = {
  className?: string;
  /** Compact seal for desktop table cells. */
  size?: 'tile' | 'inline';
};

/**
 * Order Placed stamp badge — overlays sales-order list rows.
 */
export const OrderPlacedSeal: React.FC<OrderPlacedSealProps> = ({
  className,
  size = 'tile',
}) => (
  <span
    className={['so-order-seal', size === 'inline' ? 'so-order-seal--inline' : '', className]
      .filter(Boolean)
      .join(' ')}
    aria-hidden
  >
    <img
      className="so-order-seal__img"
      src={orderPlacedSealUrl}
      alt=""
      draggable={false}
    />
  </span>
);
