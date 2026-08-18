import React from 'react';
import type { FreightLineSku } from '../../constants/freightLines';
import { LOCAL_FREIGHT_SKU_OPTIONS } from '../../lib/invoiceLocalFreight';

type Props = {
  selectedSku: string | null;
  busy?: boolean;
  error?: string;
  onSelect: (sku: FreightLineSku) => void;
};

export const InvoiceLocalFreightEditor: React.FC<Props> = ({
  selectedSku,
  busy = false,
  error = '',
  onSelect,
}) => (
  <div className="invoice-local-freight">
    <p className="invoice-local-freight__hint text-muted text-sm">
      Super admin only — switch courier in YesOne if the billed partner cannot serve this pin.
      Amount stays on the invoice. This is not sent to Zoho (e-invoice cannot change).
    </p>
    <div
      className="freight-partner-picker__list"
      role="radiogroup"
      aria-label="Local logistics partner"
    >
      {LOCAL_FREIGHT_SKU_OPTIONS.map(option => {
        const selected = selectedSku === option.sku;
        return (
          <div
            key={option.sku}
            className={`freight-partner-picker__row${selected ? ' is-selected' : ''}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="freight-partner-picker__main"
              disabled={busy}
              onClick={() => {
                if (selected) return;
                onSelect(option.sku);
              }}
            >
              <span
                className={`freight-partner-picker__radio${selected ? ' is-on' : ''}`}
                aria-hidden
              />
              <span className="freight-partner-picker__logo-wrap">
                <img
                  src={option.image}
                  alt=""
                  className="freight-partner-picker__logo"
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="freight-partner-picker__copy">
                <strong>{option.label}</strong>
                <span className="text-muted text-sm">{option.sku}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
    {error ? (
      <p className="invoice-local-freight__error" role="alert">{error}</p>
    ) : null}
  </div>
);
