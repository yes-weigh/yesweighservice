import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Calendar,
  ChevronRight,
  ClipboardList,
  FileText,
  MapPin,
  Package,
  Ship,
  Store,
} from 'lucide-react';
import { InvoiceCategoryIcon } from '../invoices/InvoiceCategoryVisual';
import { FitSingleLine } from '../invoices/FitSingleLine';
import { formatCurrency } from '../../lib/catalog';
import type { AdminFirestorePurchaseOrder } from '../../lib/admin-purchase-orders';
import { vendorPlaceLabel, type ZohoVendorOption } from '../../lib/zoho-vendors';
import {
  formatInvoiceDateTime,
  formatInvoiceItemQuantity,
  invoiceCategoryLabel,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { preventMouseFocusScroll } from '../../lib/preventMouseFocusScroll';

function poStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function poCardAccent(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  if (key === 'billed' || key === 'closed' || key === 'received') return 'delivered';
  if (key === 'issued' || key === 'open' || key === 'sent') return 'dispatch';
  if (key === 'cancelled' || key === 'void') return 'void';
  return 'default';
}

function CardField({
  icon: Icon,
  label,
  children,
}: {
  icon?: LucideIcon;
  label?: string;
  children: ReactNode;
}) {
  return (
    <span className="invoice-doc-card__field">
      {label ? (
        <span className="invoice-doc-card__field-head">
          {Icon ? <Icon size={13} strokeWidth={2.2} className="invoice-doc-card__icon" aria-hidden /> : null}
          <span className="invoice-doc-card__field-label">{label}</span>
        </span>
      ) : null}
      <FitSingleLine className="invoice-doc-card__field-value">{children || '—'}</FitSingleLine>
    </span>
  );
}

export function AdminPurchaseOrderDocCard({
  purchaseOrder,
  vendor,
  onOpen,
}: {
  purchaseOrder: AdminFirestorePurchaseOrder;
  vendor?: ZohoVendorOption | null;
  onOpen: (purchaseOrder: AdminFirestorePurchaseOrder) => void;
}) {
  const category = purchaseOrder.purchaseOrderCategory
    ?? purchaseOrder.categories[0]
    ?? null;
  const categoryLabel = invoiceCategoryLabel(category);
  const accent = poCardAccent(purchaseOrder.status);
  const locationLabel = [
    purchaseOrder.vendorState || vendor?.state,
    purchaseOrder.vendorCountry || vendor?.country,
  ].filter(Boolean).join(', ')
    || vendorPlaceLabel(vendor)
    || '—';

  return (
    <button
      type="button"
      className={`invoice-doc-card invoice-doc-card--purchase-order invoice-doc-card--${accent}`}
      onMouseDown={preventMouseFocusScroll}
      onClick={() => onOpen(purchaseOrder)}
      aria-label={`View purchase order ${purchaseOrder.purchaseOrderNumber || purchaseOrder.id}`}
    >
      <span className="invoice-doc-card__main">
        <span className="invoice-doc-card__head invoice-doc-card__head--stacked">
          <span className="invoice-doc-card__dealer">
            <Store size={18} strokeWidth={2.1} className="invoice-doc-card__icon" aria-hidden />
            <FitSingleLine className="invoice-doc-card__title">
              {purchaseOrder.vendorName ?? '—'}
            </FitSingleLine>
          </span>
          <span className="invoice-doc-card__subhead">
            <span className="invoice-doc-card__meta-item">
              <MapPin size={11} strokeWidth={2.2} aria-hidden />
              <FitSingleLine className="invoice-doc-card__meta-text">{locationLabel}</FitSingleLine>
            </span>
            <span className="invoice-doc-card__head-end">
              <FitSingleLine className="invoice-doc-card__amount">
                {formatCurrency(purchaseOrder.total, purchaseOrder.currencyCode)}
              </FitSingleLine>
              <ChevronRight size={18} className="invoice-doc-card__chevron" aria-hidden />
            </span>
          </span>
        </span>

        <span className="invoice-doc-card__grid">
          <span className="invoice-doc-card__row">
            <CardField icon={FileText} label="PO No.">
              {purchaseOrder.purchaseOrderNumber || purchaseOrder.id}
            </CardField>
            <CardField icon={ClipboardList} label="Reference">
              {purchaseOrder.referenceNumber || '—'}
            </CardField>
            <CardField icon={Package} label="Qty">
              {formatInvoiceItemQuantity(purchaseOrder.itemQuantity)}
            </CardField>
          </span>
          <span className="invoice-doc-card__row">
            <CardField icon={Calendar} label="Date & Time">
              {formatInvoiceDateTime(purchaseOrder.date, purchaseOrder.createdTime) || '—'}
            </CardField>
            <CardField>
              <span className="invoice-doc-card__lead invoice-doc-card__lead--row">
                <InvoiceCategoryIcon category={category} />
                {categoryLabel ? (
                  <FitSingleLine className="invoice-doc-card__lead-label">{categoryLabel}</FitSingleLine>
                ) : null}
              </span>
            </CardField>
            <span className="invoice-doc-card__field invoice-doc-card__field--status">
              <span className={poStatusClass(purchaseOrder.status)}>
                <Ship size={12} strokeWidth={2.2} aria-hidden />
                {invoiceStatusLabel(purchaseOrder.status)}
              </span>
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
