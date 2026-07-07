import React from 'react';
import { ChevronLeft, ShieldCheck, Truck, X } from 'lucide-react';
import { DELIVERY_METHODS, type DeliveryMethod } from '../../constants/deliveryMethods';

interface DeliveryMethodPickerDialogProps {
  onClose: () => void;
  onSelect: (method: DeliveryMethod) => void;
}

export const DeliveryMethodPickerDialog: React.FC<DeliveryMethodPickerDialogProps> = ({
  onClose,
  onSelect,
}) => (
  <div className="delivery-method-backdrop" role="presentation" onClick={onClose}>
    <div
      className="delivery-method-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-method-title"
      onClick={event => event.stopPropagation()}
    >
      <header className="delivery-method-dialog__header">
        <button
          type="button"
          className="delivery-method-dialog__back"
          onClick={onClose}
          aria-label="Close delivery method picker"
        >
          <ChevronLeft size={22} aria-hidden />
        </button>
        <div className="delivery-method-dialog__hero">
          <span className="delivery-method-dialog__hero-icon" aria-hidden>
            <Truck size={34} strokeWidth={1.8} />
          </span>
          <h2 id="delivery-method-title" className="delivery-method-dialog__title">
            <span>DELIVERY</span>
            <span className="delivery-method-dialog__title-accent">METHOD</span>
          </h2>
          <p className="delivery-method-dialog__subtitle">Choose your preferred delivery option</p>
        </div>
        <button
          type="button"
          className="delivery-method-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </header>

      <div className="delivery-method-dialog__grid" role="listbox" aria-label="Delivery methods">
        {DELIVERY_METHODS.map(method => (
          <button
            key={method.id}
            type="button"
            role="option"
            className="delivery-method-card"
            onClick={() => onSelect(method)}
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
            <span className="delivery-method-card__label">{method.label}</span>
          </button>
        ))}
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
  </div>
);
