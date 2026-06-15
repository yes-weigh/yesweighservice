import React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { formatStockQuantity } from '../../lib/catalog';
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

export const StockQuantity: React.FC<{
  stock: number;
  unit?: string;
  compact?: boolean;
  status?: StockStatus;
}> = ({ stock, unit = 'pcs', compact = false, status }) => {
  const formatted = formatStockQuantity(stock, unit);
  const statusClass = status ? ` catalog-stock-qty--${status.replace(/_/g, '-')}` : '';
  const spaceIndex = formatted.indexOf(' ');
  const qtyValue = spaceIndex === -1 ? formatted : formatted.slice(0, spaceIndex);
  const qtyUnit = spaceIndex === -1 ? '' : formatted.slice(spaceIndex + 1);

  if (compact) {
    return (
      <span className={`catalog-stock-qty catalog-stock-qty--compact${statusClass}`}>
        <strong className="catalog-stock-qty__value">{qtyValue}</strong>
        {qtyUnit && <span className="catalog-stock-qty__unit">{qtyUnit}</span>}
      </span>
    );
  }

  return (
    <span className={`catalog-stock-qty${statusClass}`}>
      <span className="catalog-stock-qty__label">Stock:</span>
      <strong className="catalog-stock-qty__value">{qtyValue}</strong>
      {qtyUnit && <span className="catalog-stock-qty__unit">{qtyUnit}</span>}
    </span>
  );
};
