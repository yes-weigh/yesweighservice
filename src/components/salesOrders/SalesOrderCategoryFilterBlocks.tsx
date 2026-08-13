import { LayoutGrid } from 'lucide-react';
import { InvoiceCategoryIcon } from '../invoices/InvoiceCategoryVisual';
import type { InvoiceCategory } from '../../types/invoices';

export type SalesOrderCategoryCounts = Record<InvoiceCategory | 'all', number>;

const CATEGORY_BLOCKS: Array<{ value: InvoiceCategory | 'all'; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'product', label: 'Product' },
  { value: 'spare', label: 'Spares' },
  { value: 'software_key', label: 'Software' },
  { value: 'service', label: 'Service' },
];

type Props = {
  value: InvoiceCategory | 'all';
  counts: SalesOrderCategoryCounts;
  loading?: boolean;
  onChange: (next: InvoiceCategory | 'all') => void;
};

export function SalesOrderCategoryFilterBlocks({
  value,
  counts,
  loading = false,
  onChange,
}: Props) {
  return (
    <div
      className="unified-so-category-blocks unified-so-category-blocks--sectors"
      role="tablist"
      aria-label="Order sector"
    >
      {CATEGORY_BLOCKS.map(item => {
        const active = value === item.value;
        const count = item.value === 'all' ? counts.all : counts[item.value];
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-so-category-block${active ? ' is-active' : ''}${
              item.value !== 'all' ? ` unified-so-category-block--${item.value}` : ''
            }`}
            onClick={() => onChange(item.value)}
            title={item.label}
          >
            <span className="unified-so-category-block__icon" aria-hidden>
              {item.value === 'all' ? (
                <span className="unified-so-category-block__icon--all">
                  <LayoutGrid size={18} strokeWidth={2.2} />
                </span>
              ) : (
                <InvoiceCategoryIcon category={item.value} />
              )}
            </span>
            <span className="unified-so-category-block__label">{item.label}</span>
            <span className="unified-so-category-block__count">
              {loading ? '…' : count.toLocaleString('en-IN')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
