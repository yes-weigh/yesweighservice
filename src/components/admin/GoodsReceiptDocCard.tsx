import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Calendar,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  MapPin,
  Package,
  PackageCheck,
  Ship,
  Store,
  Warehouse,
} from 'lucide-react';
import {
  goodsReceiptLocationLabel,
  goodsReceiptShipmentStage,
  goodsReceiptStatusClass,
  goodsReceiptStatusLabel,
  type AdminFirestoreGoodsReceipt,
} from '../../lib/admin-goods-receipts';
import {
  formatInvoiceDate,
  formatInvoiceDateTime,
  formatInvoiceItemQuantity,
  invoiceCategoriesForDisplay,
  invoiceCategoryLabel,
} from '../../lib/invoices';
import { preventMouseFocusScroll } from '../../lib/preventMouseFocusScroll';
import { FitSingleLine } from '../invoices/FitSingleLine';
import { InvoiceCategoryIcon } from '../invoices/InvoiceCategoryVisual';

type FieldTone =
  | 'bill'
  | 'ref'
  | 'qty'
  | 'date'
  | 'sailed'
  | 'received'
  | 'category'
  | 'location';

function CardField({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon?: LucideIcon;
  label?: string;
  tone?: FieldTone;
  children: ReactNode;
}) {
  return (
    <span className={`invoice-doc-card__field${tone ? ` invoice-doc-card__field--${tone}` : ''}`}>
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

function cardAccent(stage: ReturnType<typeof goodsReceiptShipmentStage>) {
  if (stage === 'received') return 'delivered';
  if (stage === 'in_transit') return 'transit';
  return 'dispatch';
}

function StatusIcon({ stage }: { stage: ReturnType<typeof goodsReceiptShipmentStage> }) {
  if (stage === 'received') return <PackageCheck size={12} strokeWidth={2.2} aria-hidden />;
  if (stage === 'in_transit') return <Ship size={12} strokeWidth={2.2} aria-hidden />;
  return <CalendarClock size={12} strokeWidth={2.2} aria-hidden />;
}

export function GoodsReceiptDocCard({
  goodsReceipt,
  onOpen,
}: {
  goodsReceipt: AdminFirestoreGoodsReceipt;
  onOpen: (row: AdminFirestoreGoodsReceipt) => void;
}) {
  const locationLabel = goodsReceiptLocationLabel(goodsReceipt.inventorySite);
  const stage = goodsReceiptShipmentStage(goodsReceipt);
  const statusLabel = goodsReceiptStatusLabel(goodsReceipt.status);
  const category = invoiceCategoriesForDisplay({
    categories: goodsReceipt.categories,
    invoiceCategory: goodsReceipt.goodsReceiptCategory,
  })[0] ?? goodsReceipt.goodsReceiptCategory ?? null;

  return (
    <button
      type="button"
      className={`invoice-doc-card invoice-doc-card--goods-receipt invoice-doc-card--${cardAccent(stage)}`}
      onMouseDown={preventMouseFocusScroll}
      onClick={() => onOpen(goodsReceipt)}
      aria-label={`View goods receipt ${goodsReceipt.billNumber || goodsReceipt.id}`}
    >
      <span className="invoice-doc-card__main">
        <span className="invoice-doc-card__head">
          <span className="invoice-doc-card__dealer">
            <Store size={18} strokeWidth={2.1} className="invoice-doc-card__icon" aria-hidden />
            <span className="invoice-doc-card__dealer-copy">
              <FitSingleLine className="invoice-doc-card__title">
                {goodsReceipt.vendorName ?? '—'}
              </FitSingleLine>
              {locationLabel !== '—' ? (
                <span className="invoice-doc-card__meta-item">
                  <MapPin size={11} strokeWidth={2.2} aria-hidden />
                  <FitSingleLine className="invoice-doc-card__meta-text">{locationLabel}</FitSingleLine>
                </span>
              ) : null}
            </span>
          </span>
          <span className="invoice-doc-card__head-end">
            <FitSingleLine className="invoice-doc-card__amount">
              {goodsReceipt.itemVariantCount == null
                ? '—'
                : `${goodsReceipt.itemVariantCount.toLocaleString('en-IN')} ${
                  goodsReceipt.itemVariantCount === 1 ? 'variant' : 'variants'
                }`}
            </FitSingleLine>
            <ChevronRight size={18} className="invoice-doc-card__chevron" aria-hidden />
          </span>
        </span>

        <span className="invoice-doc-card__grid">
          <span className="invoice-doc-card__row">
            <CardField tone="bill" icon={FileText} label="Bill No.">
              {goodsReceipt.billNumber || goodsReceipt.id}
            </CardField>
            <CardField tone="ref" icon={ClipboardList} label="Ref No.">
              {goodsReceipt.referenceNumber || '—'}
            </CardField>
            <CardField tone="qty" icon={Package} label="Qty">
              {formatInvoiceItemQuantity(goodsReceipt.itemQuantity)}
            </CardField>
          </span>
          <span className="invoice-doc-card__row">
            <CardField tone="date" icon={Calendar} label="Date & Time">
              {formatInvoiceDateTime(goodsReceipt.date, goodsReceipt.createdTime) || '—'}
            </CardField>
            <CardField tone="sailed" icon={Ship} label="Sailed">
              {formatInvoiceDate(goodsReceipt.sailedDate)}
            </CardField>
            <CardField tone="received" icon={PackageCheck} label="Received">
              {formatInvoiceDateTime(goodsReceipt.receivedDate, goodsReceipt.opsReceivedAt) || '—'}
            </CardField>
          </span>
          <span className="invoice-doc-card__row">
            <CardField tone="category">
              <span className="invoice-doc-card__lead invoice-doc-card__lead--row">
                <InvoiceCategoryIcon category={category} />
                <FitSingleLine className="invoice-doc-card__lead-label">
                  {invoiceCategoryLabel(category) || '—'}
                </FitSingleLine>
              </span>
            </CardField>
            <CardField tone="location" icon={Warehouse} label="Location">
              {locationLabel}
            </CardField>
            <span className="invoice-doc-card__field invoice-doc-card__field--status">
              <span className={goodsReceiptStatusClass(goodsReceipt.status)}>
                <StatusIcon stage={stage} />
                {statusLabel}
              </span>
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
