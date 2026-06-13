import React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { StockStatus } from '../../types/catalog';

const STOCK_MAP = {
  in_stock: { cls: 'catalog-stock--in', Icon: CheckCircle, label: 'In Stock', short: 'In stock' },
  low_stock: { cls: 'catalog-stock--low', Icon: AlertTriangle, label: 'Low Stock', short: 'Low stock' },
  out_of_stock: { cls: 'catalog-stock--out', Icon: XCircle, label: 'Out of Stock', short: 'Out of stock' },
} as const;

export const StockBadge: React.FC<{
  status: StockStatus;
  overlay?: boolean;
  variant?: 'default' | 'tile';
}> = ({ status, overlay = false, variant = 'default' }) => {
  const { cls, Icon, label, short } = STOCK_MAP[status] ?? STOCK_MAP.out_of_stock;
  const displayLabel = variant === 'tile' ? short : label;

  return (
    <div
      className={[
        'catalog-stock',
        cls,
        overlay ? 'catalog-stock--overlay' : '',
        variant === 'tile' ? 'catalog-stock--tile' : '',
      ].filter(Boolean).join(' ')}
    >
      <Icon size={variant === 'tile' ? 12 : overlay ? 11 : 14} strokeWidth={2.5} />
      <span>{displayLabel}</span>
    </div>
  );
};
