import React from 'react';
import {
  dealerOrderStatusClass,
  dealerOrderStatusLabel,
  type DealerOrderStatus,
} from '../../types/dealer-orders';

export function OrderStatusBadge({ status }: { status: DealerOrderStatus | string }) {
  return (
    <span className={dealerOrderStatusClass(status)}>
      {dealerOrderStatusLabel(status)}
    </span>
  );
}
