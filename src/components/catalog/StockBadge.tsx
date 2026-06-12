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
  stock: number;
  unit: string;
  compact?: boolean;
}> = ({ status, stock, unit, compact = false }) => {
  const { cls, Icon, label } = STOCK_MAP[status] ?? STOCK_MAP.out_of_stock;

  return (
    <div className={`catalog-stock ${cls} ${compact ? 'catalog-stock--compact' : ''}`}>
      <div className="catalog-stock__label">
        <Icon size={14} />
        <span>{label}</span>
      </div>
      {stock > 0 && (
        <div className="catalog-stock__qty">
          <strong>{stock}</strong>
          <span>{unit}</span>
        </div>
      )}
    </div>
  );
};
