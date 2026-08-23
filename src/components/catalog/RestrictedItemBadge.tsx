import React from 'react';
import { Lock, ShieldCheck } from 'lucide-react';

export const RESTRICTED_ITEM_TITLE = 'Restricted Item';
export const RESTRICTED_ITEM_SUBTITLE = 'You are not authorized to purchase this product.';

export const RestrictedItemBadge: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  if (compact) {
    return (
      <div
        className="catalog-product-card__restricted-badge"
        role="status"
        title={`${RESTRICTED_ITEM_TITLE}. ${RESTRICTED_ITEM_SUBTITLE}`}
      >
        <Lock size={13} strokeWidth={2.4} aria-hidden />
        <span>Restricted</span>
      </div>
    );
  }

  return (
    <div className="product-restricted-badge" role="status">
      <span className="product-restricted-badge__icon" aria-hidden>
        <Lock size={18} strokeWidth={2.4} />
      </span>
      <div className="product-restricted-badge__copy">
        <strong>{RESTRICTED_ITEM_TITLE}</strong>
        <p>{RESTRICTED_ITEM_SUBTITLE}</p>
      </div>
    </div>
  );
};

export const RestrictedItemWhyBox: React.FC = () => (
  <div className="product-restricted-why" role="note">
    <ShieldCheck size={22} strokeWidth={2.1} aria-hidden />
    <div>
      <h3>Why is this restricted?</h3>
      <p>
        This item is restricted based on your dealer permissions. Contact your{' '}
        <strong>Sales Manager</strong> for more information.
      </p>
    </div>
  </div>
);
