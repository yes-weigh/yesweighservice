import React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Headphones, Package } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import {
  formatInvoiceDate,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { supportBasePath } from '../../lib/dealerSupport';
import type { DealerInvoiceLineItem } from '../../types/invoices';
import type { SupportProductDraft } from '../../types/dealer-support';
import type { InvoiceDetailOutletContext } from './invoiceDetailContext';

function statusClass(status: string): string {
  const key = status.toLowerCase();
  if (key === 'paid') return 'invoices-status--paid';
  if (key === 'overdue' || key === 'unpaid') return 'invoices-status--due';
  if (key === 'partially_paid') return 'invoices-status--partial';
  if (key === 'void') return 'invoices-status--void';
  return 'invoices-status--default';
}

export const InvoiceDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { invoice, invoiceId } = useOutletContext<InvoiceDetailOutletContext>();

  const handleServiceRequest = (item: DealerInvoiceLineItem) => {
    if (!invoice || !invoiceId || !user) return;
    const draft: SupportProductDraft = {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      salesOrderNumber: invoice.salesOrderNumber,
      lineItemId: item.id,
      itemId: item.itemId,
      itemName: item.name,
      itemSku: item.sku,
      quantity: item.quantity,
    };
    navigate(supportBasePath(user.role), { state: { draft, intent: 'service' as const } });
  };

  if (!invoice) return null;

  return (
    <>
      <section className="invoice-detail-hero panel glass">
        <div className="invoice-detail-hero__head">
          <div>
            <p className="invoice-detail-hero__meta">
              {formatInvoiceDate(invoice.date)}
            </p>
          </div>
          <span className={`invoices-status ${statusClass(invoice.status)}`}>
            {invoiceStatusLabel(invoice.status)}
          </span>
        </div>

        <div className="invoice-detail-hero__totals">
          <div>
            <span className="invoice-detail-hero__label">Total</span>
            <strong>{formatCurrency(invoice.total)}</strong>
          </div>
          {invoice.balance > 0 && (
            <div>
              <span className="invoice-detail-hero__label">Balance</span>
              <strong className="invoice-detail-hero__balance">{formatCurrency(invoice.balance)}</strong>
            </div>
          )}
        </div>
      </section>

      <section className="invoice-detail-items panel glass">
        <h3 className="invoice-detail-items__title">
          Items{invoice.lineItems.length ? ` (${invoice.lineItems.length})` : ''}
        </h3>
        {invoice.lineItems.length ? (
          <ul className="invoice-detail-item-list">
            {invoice.lineItems.map(item => (
              <li key={item.id} className="invoice-detail-item">
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
                <button
                  type="button"
                  className="invoice-detail-item__service"
                  aria-label={`Request service for ${item.name}`}
                  onClick={() => handleServiceRequest(item)}
                >
                  <Headphones size={18} aria-hidden />
                  <span>Service</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="invoice-detail-items__empty text-muted text-sm">No line items on this invoice.</p>
        )}
      </section>

      {invoice.lineItems.length > 0 && (
        <footer className="invoice-detail-footer panel glass">
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
        </footer>
      )}
    </>
  );
};
