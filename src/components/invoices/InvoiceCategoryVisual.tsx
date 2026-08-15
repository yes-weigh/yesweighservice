import React from 'react';
import { BadgeCheck, Box, Cog, KeyRound, Wrench } from 'lucide-react';
import {
  invoiceCategoriesForDisplay,
  invoiceCategoryClassName,
  invoiceCategoryLabel,
} from '../../lib/invoices';
import type { OrderSegment } from '../../lib/salesOrderSegments';
import type { InvoiceCategory } from '../../types/invoices';
import { invoiceTileLeadVisual } from '../../lib/invoiceTileLead';
import { FitSingleLine } from './FitSingleLine';
import {
  logisticsPartnerImage,
  logisticsPartnerLabel,
} from '../../constants/logisticsPartners';
import type { LogisticsBooking } from '../../types/logistics-dispatch';

const INVOICE_CATEGORIES = new Set<InvoiceCategory>([
  'product',
  'spare',
  'software_key',
  'service',
  'gatc',
]);

const ORDER_SEGMENT_CATEGORY: Record<OrderSegment, InvoiceCategory> = {
  product: 'product',
  spare: 'spare',
  software: 'software_key',
};

export function invoiceCategoryIconNode(
  category: InvoiceCategory,
  size = 18,
  strokeWidth = 2,
): React.ReactNode {
  switch (category) {
    case 'product':
      return <Box size={size} strokeWidth={strokeWidth} />;
    case 'spare':
      return <Cog size={size} strokeWidth={strokeWidth} />;
    case 'software_key':
      return <KeyRound size={size} strokeWidth={strokeWidth} />;
    case 'service':
      return <Wrench size={size} strokeWidth={strokeWidth} />;
    case 'gatc':
      return <BadgeCheck size={size} strokeWidth={strokeWidth} />;
    default:
      return <Box size={size} strokeWidth={strokeWidth} />;
  }
}

export function orderSegmentIconNode(
  segment: OrderSegment,
  size = 18,
  strokeWidth = 2,
): React.ReactNode {
  return invoiceCategoryIconNode(ORDER_SEGMENT_CATEGORY[segment], size, strokeWidth);
}

export function InvoiceCategoryIcon({
  category,
}: {
  category: InvoiceCategory | null | undefined;
}) {
  const key = category && INVOICE_CATEGORIES.has(category) ? category : null;
  return (
    <span
      className={[
        'invoices-mobile-row__icon',
        key ? `invoices-mobile-row__icon--${key}` : 'invoices-mobile-row__icon--unknown',
      ].join(' ')}
      aria-hidden
    >
      {key ? invoiceCategoryIconNode(key) : invoiceCategoryIconNode('product')}
    </span>
  );
}

export function InvoiceTileLeadIcon({
  invoice,
  booking,
}: {
  invoice: Parameters<typeof invoiceTileLeadVisual>[0];
  booking?: Pick<LogisticsBooking, 'partnerId'> | null;
}) {
  const lead = invoiceTileLeadVisual(invoice, booking);
  if (lead.kind === 'partner') {
    return (
      <span
        className="invoices-mobile-row__icon invoices-mobile-row__icon--partner"
        title={lead.label}
        aria-label={lead.label}
      >
        <img src={lead.image} alt="" />
      </span>
    );
  }
  return <InvoiceCategoryIcon category={lead.category} />;
}

export function InvoiceTileLeadWithLabel({
  invoice,
  booking,
  layout = 'column',
}: {
  invoice: Parameters<typeof invoiceTileLeadVisual>[0];
  booking?: Pick<LogisticsBooking, 'partnerId'> | null;
  layout?: 'column' | 'row';
}) {
  const lead = invoiceTileLeadVisual(invoice, booking);
  const pickupImage = logisticsPartnerImage('personal_collection');
  const pickupLabel = logisticsPartnerLabel('personal_collection');
  const label = lead.kind === 'partner' ? lead.label : pickupLabel;
  return (
    <span className={`invoice-doc-card__lead invoice-doc-card__lead--${layout}`}>
      {lead.kind === 'partner' ? (
        <InvoiceTileLeadIcon invoice={invoice} booking={booking} />
      ) : pickupImage ? (
        <span
          className="invoices-mobile-row__icon invoices-mobile-row__icon--partner"
          title={pickupLabel}
          aria-label={pickupLabel}
        >
          <img src={pickupImage} alt="" />
        </span>
      ) : (
        <InvoiceTileLeadIcon invoice={invoice} booking={booking} />
      )}
      {label ? (
        <FitSingleLine className="invoice-doc-card__lead-label">{label}</FitSingleLine>
      ) : null}
    </span>
  );
}

export function SalesOrderTileLeadIcon({
  category,
  categories,
  freightSku,
}: {
  category?: InvoiceCategory | null;
  categories?: InvoiceCategory[] | null;
  freightSku?: string | null;
}) {
  return (
    <InvoiceTileLeadIcon
      invoice={{
        invoiceCategory: category,
        categories,
        freightSku,
      }}
    />
  );
}

export function InvoiceCategoryBadge({
  category,
}: {
  category: InvoiceCategory | null | undefined;
}) {
  const label = invoiceCategoryLabel(category);
  if (!label) return null;
  return (
    <span className={invoiceCategoryClassName(category)}>
      {label}
    </span>
  );
}

export function InvoiceCategoryBadgeList({
  categories,
  invoiceCategory,
}: {
  categories?: InvoiceCategory[] | null;
  invoiceCategory?: InvoiceCategory | null;
}) {
  const values = invoiceCategoriesForDisplay({ categories, invoiceCategory });
  if (!values.length) return null;
  return (
    <>
      {values.map(category => (
        <span key={category} className={invoiceCategoryClassName(category)}>
          {invoiceCategoryLabel(category)}
        </span>
      ))}
    </>
  );
}
