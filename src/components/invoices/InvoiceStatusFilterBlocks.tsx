import React from 'react';
import {
  Ban,
  LayoutGrid,
  LifeBuoy,
  Package,
  PackageCheck,
  RotateCcw,
  Truck,
} from 'lucide-react';
import { invoiceListStatusLabel } from '../../lib/invoiceListStatus';
import {
  INVOICE_STATUS_FILTERS,
  type InvoiceListStatusFilter,
} from '../../types/invoices';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  to_dispatch: <Package size={16} strokeWidth={2.2} />,
  in_transit: <Truck size={16} strokeWidth={2.2} />,
  delivered: <PackageCheck size={16} strokeWidth={2.2} />,
  returned: <RotateCcw size={16} strokeWidth={2.2} />,
  void: <Ban size={16} strokeWidth={2.2} />,
  support: <LifeBuoy size={16} strokeWidth={2.2} />,
};

type Props = {
  value: string;
  counts: Record<string, number>;
  allCount: number;
  countsComplete?: boolean;
  loading?: boolean;
  onChange: (next: string) => void;
};

export function InvoiceStatusFilterBlocks({
  value,
  counts,
  allCount,
  countsComplete = true,
  loading = false,
  onChange,
}: Props) {
  return (
    <div
      className="unified-so-stage-blocks unified-so-stage-blocks--invoice-status"
      role="tablist"
      aria-label="Invoice status"
    >
      {INVOICE_STATUS_FILTERS.map(status => {
        const active = value === status;
        const label = invoiceListStatusLabel(status);
        const count = counts[status] ?? 0;
        return (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--${status}${
              active ? ' is-active' : ''
            }`}
            onClick={() => onChange(status)}
            title={label}
          >
            <span className="unified-so-category-block__icon" aria-hidden>
              <span className={`unified-so-stage-block__icon unified-so-stage-block__icon--${status}`}>
                {STATUS_ICONS[status] ?? <Package size={16} strokeWidth={2.2} />}
              </span>
            </span>
            <span className="unified-so-category-block__label">{label}</span>
            <span className="unified-so-category-block__count">
              {loading ? '…' : countsComplete ? count.toLocaleString('en-IN') : '\u00a0'}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected={value === 'all'}
        className={`unified-so-category-block unified-so-stage-block unified-so-stage-block--all${
          value === 'all' ? ' is-active' : ''
        }`}
        onClick={() => onChange('all')}
        title="All statuses"
      >
        <span className="unified-so-category-block__icon" aria-hidden>
          <span className="unified-so-stage-block__icon unified-so-stage-block__icon--all">
            <LayoutGrid size={16} strokeWidth={2.2} />
          </span>
        </span>
        <span className="unified-so-category-block__label">All</span>
        <span className="unified-so-category-block__count">
          {loading ? '…' : allCount.toLocaleString('en-IN')}
        </span>
      </button>
    </div>
  );
}

export type { InvoiceListStatusFilter };
