import React from 'react';
import { Box, Cog, KeyRound, Wrench } from 'lucide-react';
import {
  invoiceCategoryClassName,
  invoiceCategoryLabel,
} from '../../lib/invoices';
import type { InvoiceCategory } from '../../types/invoices';

const CATEGORY_ICONS: Record<InvoiceCategory, React.ReactNode> = {
  product: <Box size={18} strokeWidth={2} />,
  spare: <Cog size={18} strokeWidth={2} />,
  software_key: <KeyRound size={18} strokeWidth={2} />,
  service: <Wrench size={18} strokeWidth={2} />,
};

export function InvoiceCategoryIcon({
  category,
}: {
  category: InvoiceCategory | null | undefined;
}) {
  const key = category && CATEGORY_ICONS[category] ? category : null;
  return (
    <span
      className={[
        'invoices-mobile-row__icon',
        key ? `invoices-mobile-row__icon--${key}` : 'invoices-mobile-row__icon--unknown',
      ].join(' ')}
      aria-hidden
    >
      {key ? CATEGORY_ICONS[key] : <Box size={18} strokeWidth={2} />}
    </span>
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
