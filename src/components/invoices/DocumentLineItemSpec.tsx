import React from 'react';

export interface DocumentLineItemSpecProps {
  name: string;
  sku?: string | null;
  description?: string | null;
  /** Extra class on the root (defaults to invoice-detail-item__body). */
  className?: string;
  children?: React.ReactNode;
}

/**
 * Shared SO / invoice line “spec writing”: raw name, SKU, then full Zoho description.
 */
export const DocumentLineItemSpec: React.FC<DocumentLineItemSpecProps> = ({
  name,
  sku,
  description,
  className = 'invoice-detail-item__body',
  children,
}) => {
  const desc = String(description ?? '').trim();
  return (
    <div className={className}>
      <strong className="invoice-detail-item__name">{name}</strong>
      {sku ? <span className="invoice-detail-item__sku">{sku}</span> : null}
      {desc ? <p className="invoice-detail-item__desc">{desc}</p> : null}
      {children}
    </div>
  );
};
