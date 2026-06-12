import React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { StockStatus } from '../../types/catalog';

const STOCK_MAP = {
  in_stock: { cls: 'catalog-stock--in', Icon: CheckCircle, label: 'In Stock' },
  low_stock: { cls: 'catalog-stock--low', Icon: AlertTriangle, label: 'Low Stock' },
  out_of_stock: { cls: 'catalog-stock--out', Icon: XCircle, label: 'Out of Stock' },
} as const;

export const StockBadge: React.FC<{
  status: StockStatus;
  overlay?: boolean;
}> = ({ status, overlay = false }) => {
  const { cls, Icon, label } = STOCK_MAP[status] ?? STOCK_MAP.out_of_stock;

  return (
    <div className={`catalog-stock ${cls} ${overlay ? 'catalog-stock--overlay' : ''}`}>
      <Icon size={overlay ? 11 : 14} />
      <span>{label}</span>
    </div>
  );
};
