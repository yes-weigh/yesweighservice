import React, { useState } from 'react';
import type { DealerAddress } from '../../lib/dealerAddress';
import { lookupDealerPincode } from '../../lib/dealers';

interface DealerAddressBoxProps {
  idPrefix: string;
  title: string;
  value: DealerAddress;
  extra?: React.ReactNode;
  disabled?: boolean;
  onChange: (next: DealerAddress) => void;
}

export const DealerAddressBox: React.FC<DealerAddressBoxProps> = ({
  idPrefix,
  title,
  value,
  extra,
  disabled,
  onChange,
}) => {
  const [pinLookup, setPinLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  const set = (patch: Partial<DealerAddress>) => onChange({ ...value, ...patch });

  const handleZipChange = async (raw: string) => {
    const zip = raw.replace(/\D/g, '').slice(0, 6);
    const next = { ...value, zip };
    onChange(next);
    if (zip.length !== 6) {
      setPinLookup('idle');
      return;
    }
    setPinLookup('loading');
    try {
      const location = await lookupDealerPincode(zip);
      onChange({
        ...next,
        state: location.state || next.state,
        district: location.district || next.district,
        city: next.city || location.district,
      });
      setPinLookup('ok');
    } catch {
      setPinLookup('error');
    }
  };

  return (
    <section className="dealers-address-box">
      <div className="dealers-address-box__head">
        <h3>{title}</h3>
        {extra}
      </div>
      <div className="dealers-address-box__grid">
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-attention`}>
          <span>Attention</span>
          <input
            id={`${idPrefix}-attention`}
            className="input-field"
            value={value.attention}
            disabled={disabled}
            onChange={e => set({ attention: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-phone`}>
          <span>Phone</span>
          <input
            id={`${idPrefix}-phone`}
            className="input-field"
            value={value.phone}
            disabled={disabled}
            onChange={e => set({ phone: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field dealers-address-box__field--full" htmlFor={`${idPrefix}-address`}>
          <span>Address</span>
          <input
            id={`${idPrefix}-address`}
            className="input-field"
            value={value.address}
            disabled={disabled}
            onChange={e => set({ address: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field dealers-address-box__field--full" htmlFor={`${idPrefix}-street2`}>
          <span>Street 2</span>
          <input
            id={`${idPrefix}-street2`}
            className="input-field"
            value={value.street2}
            disabled={disabled}
            onChange={e => set({ street2: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-city`}>
          <span>City</span>
          <input
            id={`${idPrefix}-city`}
            className="input-field"
            value={value.city}
            disabled={disabled}
            onChange={e => set({ city: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-zip`}>
          <span>PIN</span>
          <input
            id={`${idPrefix}-zip`}
            className="input-field"
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            value={value.zip}
            disabled={disabled}
            onChange={e => void handleZipChange(e.target.value)}
          />
          {pinLookup === 'loading' ? (
            <span className="dealers-detail__pincode-hint">Looking up district and state…</span>
          ) : pinLookup === 'error' ? (
            <span className="dealers-detail__pincode-error">PIN not found. Enter district and state.</span>
          ) : null}
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-district`}>
          <span>District</span>
          <input
            id={`${idPrefix}-district`}
            className="input-field"
            value={value.district}
            disabled={disabled}
            onChange={e => set({ district: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-state`}>
          <span>State</span>
          <input
            id={`${idPrefix}-state`}
            className="input-field"
            value={value.state}
            disabled={disabled}
            onChange={e => set({ state: e.target.value })}
          />
        </label>
        <label className="dealers-modal__field" htmlFor={`${idPrefix}-country`}>
          <span>Country</span>
          <input
            id={`${idPrefix}-country`}
            className="input-field"
            value={value.country}
            disabled={disabled}
            onChange={e => set({ country: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
};
