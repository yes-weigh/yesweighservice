import React from 'react';
import { ArrowRight, ChevronRight, Package } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import { isFreightInvoiceLineItem } from '../../lib/invoices';
import type { DealerInvoiceDetail, DealerInvoiceLineItem } from '../../types/invoices';

interface InvoiceDocumentBodyProps {
  invoice: Pick<DealerInvoiceDetail, 'subtotal' | 'taxTotal' | 'total' | 'lineItems'>;
  selectedLineItemId?: string | null;
  onSelectLineItem?: (item: DealerInvoiceLineItem) => void;
  onConfirmLineItem?: () => void;
  itemClassName?: string;
  /** When set, matching line items are omitted (e.g. freight/stamping fees for service requests). */
  hideLineItem?: (item: DealerInvoiceLineItem) => boolean;
  hideTotals?: boolean;
}

export const InvoiceDocumentBody: React.FC<InvoiceDocumentBodyProps> = ({
  invoice,
  selectedLineItemId,
  onSelectLineItem,
  onConfirmLineItem,
  itemClassName = '',
  hideLineItem,
  hideTotals = false,
}) => {
  const selectable = Boolean(onSelectLineItem);
  const visibleItems = hideLineItem
    ? invoice.lineItems.filter(item => !hideLineItem(item))
    : invoice.lineItems;

  return (
    <>
      {!hideTotals && (
        <section className="invoice-detail-footer panel glass">
          <div className="invoice-detail-footer__row">
            <span>Sub Total</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>
          <div className="invoice-detail-footer__row">
            <span>GST</span>
            <span>{formatCurrency(invoice.taxTotal)}</span>
          </div>
          <div className="invoice-detail-footer__row invoice-detail-footer__row--total">
            <span>Grand Total</span>
            <strong>{formatCurrency(invoice.total)}</strong>
          </div>
        </section>
      )}

      <section className="invoice-detail-items panel glass">
        <h3 className="invoice-detail-items__title">
          Items{visibleItems.length ? ` (${visibleItems.length})` : ''}
        </h3>
        {visibleItems.length ? (
          <ul className="invoice-detail-item-list">
            {visibleItems.map(item => {
              const isFreight = isFreightInvoiceLineItem(item);
              const isSelected = selectedLineItemId === item.id;
              const canSelect = selectable && (hideLineItem ? true : !isFreight);

              return (
                <li
                  key={item.id}
                  className={[
                    'invoice-detail-item',
                    itemClassName,
                    isSelected ? 'is-selected' : '',
                    canSelect ? 'is-selectable' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {canSelect ? (
                    <div
                      role="button"
                      tabIndex={0}
                      className="invoice-detail-item__select"
                      onClick={() => onSelectLineItem?.(item)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectLineItem?.(item);
                        }
                      }}
                      aria-pressed={isSelected}
                    >
                      <ItemContent
                        item={item}
                        showNext={isSelected && Boolean(onConfirmLineItem)}
                        onNext={onConfirmLineItem}
                      />
                      {!isSelected && (
                        <ChevronRight size={20} className="invoice-detail-item__chevron" aria-hidden />
                      )}
                    </div>
                  ) : (
                    <ItemContent item={item} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="invoice-detail-items__empty text-muted text-sm">No line items on this invoice.</p>
        )}
      </section>
    </>
  );
};

function ItemContent({
  item,
  showNext = false,
  onNext,
}: {
  item: DealerInvoiceLineItem;
  showNext?: boolean;
  onNext?: () => void;
}) {
  return (
    <>
      <div className="invoice-detail-item__image-wrap">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="invoice-detail-item__image" loading="lazy" decoding="async" />
        ) : (
          <span className="invoice-detail-item__placeholder" aria-hidden>
            <Package size={22} />
          </span>
        )}
      </div>
      <div className="invoice-detail-item__body">
        <strong className="invoice-detail-item__name">{item.name}</strong>
        {item.sku && <span className="invoice-detail-item__sku">{item.sku}</span>}
        {item.description && (
          <p className="invoice-detail-item__desc">{item.description}</p>
        )}
        <div className="invoice-detail-item__pricing">
          <span>{formatCurrency(item.rate)} × {item.quantity}</span>
          <strong>{formatCurrency(item.total)}</strong>
        </div>
        {showNext && onNext && (
          <button
            type="button"
            className="btn btn-primary btn-sm invoice-detail-item__next"
            onClick={e => {
              e.stopPropagation();
              onNext();
            }}
          >
            Next
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </>
  );
}
