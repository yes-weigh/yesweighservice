import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, MapPin, Plus } from 'lucide-react';
import { lookupDealerPincode } from '../../lib/dealers';
import {
  EMPTY_NEW_ADDRESS,
  type NewShippingAddressInput,
  type ShippingAddress,
  type ShippingSelection,
  validateNewShippingAddress,
} from '../../lib/shippingAddresses';

type ShippingAddressPickerProps = {
  addresses: ShippingAddress[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  value: ShippingSelection | null;
  onChange: (next: ShippingSelection | null) => void;
  onRefresh?: () => void;
};

function selectionKey(sel: ShippingSelection | null): string {
  if (!sel) return '';
  if (sel.mode === 'saved') return `id:${sel.addressId}`;
  if (sel.mode === 'kind') return `kind:${sel.kind}`;
  return 'new';
}

function addressOptionKey(addr: ShippingAddress): string {
  if (addr.addressId) return `id:${addr.addressId}`;
  return `kind:${addr.kind}`;
}

export const ShippingAddressPicker: React.FC<ShippingAddressPickerProps> = ({
  addresses,
  loading = false,
  error = '',
  disabled = false,
  value,
  onChange,
  onRefresh,
}) => {
  const radioName = useId();
  const [showNew, setShowNew] = useState(value?.mode === 'new');
  const [draft, setDraft] = useState<NewShippingAddressInput>(
    value?.mode === 'new' ? value.newAddress : EMPTY_NEW_ADDRESS,
  );
  const [formError, setFormError] = useState('');
  const [lookingUpPin, setLookingUpPin] = useState(false);

  useEffect(() => {
    if (value?.mode === 'new') {
      setShowNew(true);
      setDraft(value.newAddress);
    }
  }, [value]);

  // Default to first shipping, else first address, once loaded.
  useEffect(() => {
    if (value || loading || !addresses.length || showNew) return;
    const preferred = addresses.find(a => a.kind === 'shipping')
      || addresses.find(a => a.addressId)
      || addresses[0];
    if (!preferred) return;
    if (preferred.addressId) {
      onChange({ mode: 'saved', addressId: preferred.addressId });
    } else if (preferred.kind === 'billing' || preferred.kind === 'shipping') {
      onChange({ mode: 'kind', kind: preferred.kind });
    }
  }, [addresses, loading, value, showNew, onChange]);

  const selectedKey = selectionKey(value);

  const options = useMemo(() => addresses.filter(a => a.formatted || a.address), [addresses]);

  const updateDraft = (patch: Partial<NewShippingAddressInput>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setFormError('');
    const err = validateNewShippingAddress(next);
    if (!err) {
      onChange({ mode: 'new', newAddress: {
        attention: next.attention.trim(),
        address: next.address.trim(),
        street2: next.street2?.trim() || '',
        city: next.city.trim(),
        state: next.state.trim(),
        zip: next.zip.trim(),
        country: next.country.trim() || 'India',
        phone: next.phone.trim(),
      } });
    } else {
      onChange(null);
      setFormError(err);
    }
  };

  const handlePinBlur = async () => {
    const pin = draft.zip.replace(/\D/g, '').slice(0, 6);
    if (pin.length !== 6) return;
    setLookingUpPin(true);
    try {
      const loc = await lookupDealerPincode(pin);
      updateDraft({ zip: pin, state: loc.state || draft.state, city: loc.district || draft.city });
    } catch {
      updateDraft({ zip: pin });
    } finally {
      setLookingUpPin(false);
    }
  };

  return (
    <div className={`ship-addr-picker${disabled ? ' is-disabled' : ''}`}>
      <div className="ship-addr-picker__head">
        <h4 className="ship-addr-picker__title">
          <MapPin size={16} aria-hidden />
          Shipping address
        </h4>
        {onRefresh ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || loading}
            onClick={onRefresh}
          >
            Refresh
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="ship-addr-picker__status text-muted text-sm">
          <Loader2 size={14} className="spin-icon" aria-hidden />
          Loading addresses…
        </p>
      ) : null}
      {error ? <p className="ship-addr-picker__error text-sm">{error}</p> : null}

      <div className="ship-addr-picker__list" role="radiogroup" aria-label="Saved shipping addresses">
        {options.map(addr => {
          const key = addressOptionKey(addr);
          const checked = !showNew && selectedKey === key;
          return (
            <label
              key={key}
              className={`ship-addr-picker__option${checked ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={radioName}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  setShowNew(false);
                  setFormError('');
                  if (addr.addressId) {
                    onChange({ mode: 'saved', addressId: addr.addressId });
                  } else if (addr.kind === 'billing' || addr.kind === 'shipping') {
                    onChange({ mode: 'kind', kind: addr.kind });
                  }
                }}
              />
              <span className="ship-addr-picker__option-body">
                <span className="ship-addr-picker__option-label">{addr.label}</span>
                <span className="ship-addr-picker__option-text">
                  {addr.formatted || '—'}
                </span>
              </span>
            </label>
          );
        })}

        <label className={`ship-addr-picker__option${showNew ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name={radioName}
            checked={showNew}
            disabled={disabled}
            onChange={() => {
              setShowNew(true);
              onChange(null);
              setFormError(validateNewShippingAddress(draft) || '');
            }}
          />
          <span className="ship-addr-picker__option-body">
            <span className="ship-addr-picker__option-label">
              <Plus size={14} aria-hidden />
              New shipping address
            </span>
            <span className="ship-addr-picker__option-text text-muted">
              Saved to Zoho on this customer
            </span>
          </span>
        </label>
      </div>

      {showNew ? (
        <div className="ship-addr-picker__form">
          <label>
            Attention / contact name *
            <input
              value={draft.attention}
              disabled={disabled}
              onChange={e => updateDraft({ attention: e.target.value })}
              autoComplete="name"
            />
          </label>
          <label>
            Address line 1 *
            <input
              value={draft.address}
              disabled={disabled}
              onChange={e => updateDraft({ address: e.target.value })}
              autoComplete="address-line1"
            />
          </label>
          <label>
            Address line 2
            <input
              value={draft.street2 || ''}
              disabled={disabled}
              onChange={e => updateDraft({ street2: e.target.value })}
              autoComplete="address-line2"
            />
          </label>
          <div className="ship-addr-picker__row">
            <label>
              PIN code *
              <input
                value={draft.zip}
                disabled={disabled || lookingUpPin}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                onChange={e => updateDraft({ zip: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                onBlur={() => { void handlePinBlur(); }}
                autoComplete="postal-code"
              />
            </label>
            <label>
              City *
              <input
                value={draft.city}
                disabled={disabled}
                onChange={e => updateDraft({ city: e.target.value })}
                autoComplete="address-level2"
              />
            </label>
          </div>
          <div className="ship-addr-picker__row">
            <label>
              State *
              <input
                value={draft.state}
                disabled={disabled}
                onChange={e => updateDraft({ state: e.target.value })}
                autoComplete="address-level1"
              />
            </label>
            <label>
              Country *
              <input
                value={draft.country}
                disabled={disabled}
                onChange={e => updateDraft({ country: e.target.value })}
                autoComplete="country-name"
              />
            </label>
          </div>
          <label>
            Phone *
            <input
              value={draft.phone}
              disabled={disabled}
              inputMode="tel"
              onChange={e => updateDraft({ phone: e.target.value })}
              autoComplete="tel"
            />
          </label>
          {formError ? <p className="ship-addr-picker__error text-sm">{formError}</p> : null}
        </div>
      ) : null}
    </div>
  );
};
