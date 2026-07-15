import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Clock, ShieldCheck, Truck } from 'lucide-react';
import { DELIVERY_METHODS, type DeliveryMethod } from '../../constants/deliveryMethods';

interface CourierPartnerPickerProps {
  onClose: () => void;
  onSelect: (methodId: string) => void;
  partners?: DeliveryMethod[];
  /** When provided, partners not in this list are shown as "Coming soon" and are not selectable. */
  availableIds?: readonly string[];
  titleLead?: string;
  titleAccent?: string;
  subtitle?: string;
  ariaLabel?: string;
}

export const CourierPartnerPicker: React.FC<CourierPartnerPickerProps> = ({
  onClose,
  onSelect,
  partners = DELIVERY_METHODS,
  availableIds,
  titleLead = 'DELIVERY',
  titleAccent = 'METHOD',
  subtitle = 'Choose your preferred delivery option',
  ariaLabel = 'Logistic partners',
}) => createPortal(
  <div className="delivery-method-backdrop" role="presentation" onClick={onClose}>
    <div
      className="delivery-method-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="courier-partner-picker-title"
      onClick={event => event.stopPropagation()}
    >
      <span className="delivery-method-dialog__glow delivery-method-dialog__glow--tl" aria-hidden />
      <span className="delivery-method-dialog__glow delivery-method-dialog__glow--br" aria-hidden />

      <header className="delivery-method-dialog__header">
        <button
          type="button"
          className="delivery-method-dialog__back"
          onClick={onClose}
          aria-label="Go back"
        >
          <ChevronLeft size={22} aria-hidden />
        </button>
        <div className="delivery-method-dialog__hero">
          <span className="delivery-method-dialog__hero-icon" aria-hidden>
            <Truck size={34} strokeWidth={1.8} />
          </span>
          <h2 id="courier-partner-picker-title" className="delivery-method-dialog__title">
            <span>{titleLead}</span>
            <span className="delivery-method-dialog__title-accent">{titleAccent}</span>
          </h2>
          <p className="delivery-method-dialog__subtitle">{subtitle}</p>
        </div>
        <span className="delivery-method-dialog__header-spacer" aria-hidden />
      </header>

      <div className="delivery-method-dialog__grid" role="listbox" aria-label={ariaLabel}>
        {partners.map(method => {
          const comingSoon = availableIds ? !availableIds.includes(method.id) : false;
          return (
            <button
              key={method.id}
              type="button"
              role="option"
              aria-disabled={comingSoon}
              aria-selected={false}
              className={[
                'delivery-method-card',
                comingSoon ? 'delivery-method-card--coming-soon' : '',
              ].filter(Boolean).join(' ')}
              aria-label={comingSoon ? `${method.label} (coming soon)` : method.label}
              onClick={() => { if (!comingSoon) onSelect(method.id); }}
            >
              <span className="delivery-method-card__logo-wrap">
                <img
                  src={method.image}
                  alt=""
                  className="delivery-method-card__logo"
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="delivery-method-card__text">
                <span className="delivery-method-card__label">{method.label}</span>
                <span className="delivery-method-card__tagline">{method.tagline}</span>
                {comingSoon && (
                  <span className="delivery-method-card__badge delivery-method-card__badge--soon">
                    <Clock size={11} aria-hidden />
                    Coming soon
                  </span>
                )}
              </span>
              {!comingSoon && (
                <ChevronRight size={18} className="delivery-method-card__chevron" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      <footer className="delivery-method-dialog__footer">
        <ShieldCheck size={22} aria-hidden className="delivery-method-dialog__footer-icon" />
        <div className="delivery-method-dialog__footer-copy">
          <strong>SAFE &amp; RELIABLE DELIVERY</strong>
          <span>We ensure your products reach you safely</span>
        </div>
        <span className="delivery-method-dialog__footer-box" aria-hidden>📦</span>
      </footer>
    </div>
  </div>,
  document.body,
);
