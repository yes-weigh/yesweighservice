import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { invoice } = useOutletContext<AdminInvoiceDetailOutletContext>();

  if (!invoice) return null;

  return (
    <>
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

      <section className="invoice-detail-items panel glass">
        <h3 className="invoice-detail-items__title">
          Items{invoice.lineItems.length ? ` (${invoice.lineItems.length})` : ''}
        </h3>
        {invoice.lineItems.length ? (
          <ul className="invoice-detail-item-list">
            {invoice.lineItems.map(item => (
              <li key={item.id} className="invoice-detail-item admin-invoice-detail-item">
                <div className="invoice-detail-item__image-wrap">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="invoice-detail-item__image" />
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
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="invoice-detail-items__empty text-muted text-sm">No line items on this invoice.</p>
        )}
      </section>
    </>
  );
};
