import React, { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Loader2, MapPin, Plus } from 'lucide-react';
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

function formatNewAddressPreview(draft: NewShippingAddressInput): string {
  return [
    draft.attention.trim(),
    draft.address.trim(),
    draft.street2?.trim(),
    [draft.city.trim(), draft.state.trim()].filter(Boolean).join(', '),
    draft.zip.trim(),
  ].filter(Boolean).join('\n') || 'Fill in the new address below';
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
  const [expanded, setExpanded] = useState(false);
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
      setExpanded(true);
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

  const selectedAddress = useMemo(() => {
    if (showNew || value?.mode === 'new') return null;
    return options.find(addr => addressOptionKey(addr) === selectedKey) ?? null;
  }, [options, selectedKey, showNew, value?.mode]);

  const summaryLabel = showNew || value?.mode === 'new'
    ? 'New shipping address'
    : selectedAddress?.label || (loading ? 'Loading…' : 'No address selected');

  const summaryText = showNew || value?.mode === 'new'
    ? formatNewAddressPreview(draft)
    : selectedAddress?.formatted || selectedAddress?.address || (
      loading ? 'Loading addresses…' : 'Choose a shipping address'
    );

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

  const selectSaved = (addr: ShippingAddress) => {
    setShowNew(false);
    setFormError('');
    if (addr.addressId) {
      onChange({ mode: 'saved', addressId: addr.addressId });
    } else if (addr.kind === 'billing' || addr.kind === 'shipping') {
      onChange({ mode: 'kind', kind: addr.kind });
    }
    setExpanded(false);
  };

  return (
    <div className={`ship-addr-picker${disabled ? ' is-disabled' : ''}${expanded ? ' is-expanded' : ''}`}>
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

      {loading && !selectedAddress && !showNew ? (
        <p className="ship-addr-picker__status text-muted text-sm">
          <Loader2 size={14} className="spin-icon" aria-hidden />
          Loading addresses…
        </p>
      ) : null}
      {error ? <p className="ship-addr-picker__error text-sm">{error}</p> : null}

      {!expanded ? (
        <button
          type="button"
          className="ship-addr-picker__summary"
          disabled={disabled}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <span className="ship-addr-picker__summary-body">
            <span className="ship-addr-picker__summary-label">{summaryLabel}</span>
            <span className="ship-addr-picker__summary-text">{summaryText}</span>
          </span>
          <span className="ship-addr-picker__summary-action">
            Change
            <ChevronDown size={14} aria-hidden />
          </span>
        </button>
      ) : (
        <>
          <div className="ship-addr-picker__expanded-bar">
            <span className="text-muted text-sm">Select a shipping address</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={disabled || !value}
              onClick={() => setExpanded(false)}
            >
              Done
            </button>
          </div>

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
                    onChange={() => selectSaved(addr)}
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
                  setExpanded(true);
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
        </>
      )}
    </div>
  );
};
