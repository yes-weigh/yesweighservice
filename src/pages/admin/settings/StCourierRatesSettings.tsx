import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import { useAuth } from '../../../context/AuthContext';
import { defaultStCourierRatesByOrigin } from '../../../constants/logisticsCourierRates';
import {
  LOGISTICS_PARTNERS,
  type LogisticsPartnerId,
} from '../../../constants/logisticsPartners';
import {
  loadLogisticsCourierRates,
  saveStCourierOriginRates,
} from '../../../lib/logisticsCourierRates';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';
import {
  ST_COURIER_ZONES,
  ST_COURIER_ZONE_LABELS,
  type StCourierOriginRates,
  type StCourierRatesByOrigin,
  type StCourierZone,
} from '../../../types/logistics-courier-rates';

function ratesEqual(a: StCourierOriginRates, b: StCourierOriginRates): boolean {
  if (
    a.volumetricDivisor !== b.volumetricDivisor
    || a.useChargeableWeight !== b.useChargeableWeight
    || a.minimumChargeableWeightKg !== b.minimumChargeableWeightKg
    || a.fuelSurchargePercent !== b.fuelSurchargePercent
  ) {
    return false;
  }
  return ST_COURIER_ZONES.every(zone => (
    a.zones[zone].envelopeFixedInr === b.zones[zone].envelopeFixedInr
    && a.zones[zone].boxPerKgInr === b.zones[zone].boxPerKgInr
  ));
}

type Props = {
  /** Bubble errors up to the parent Logistics tab banner. */
  onError: (message: string) => void;
};

export const StCourierRatesSettings: React.FC<Props> = ({ onError }) => {
  const { user } = useAuth();
  const [partnerId, setPartnerId] = useState<LogisticsPartnerId>('st_courier');
  const [origin, setOrigin] = useState<StaffLogisticsSite>('head_office');
  const [saved, setSaved] = useState<StCourierRatesByOrigin>(defaultStCourierRatesByOrigin);
  const [draft, setDraft] = useState<StCourierRatesByOrigin>(defaultStCourierRatesByOrigin);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadRates = useCallback(async () => {
    setLoading(true);
    try {
      const rates = await loadLogisticsCourierRates();
      setSaved(rates.st_courier);
      setDraft(rates.st_courier);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load courier rates.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const activeRates = draft[origin];
  const dirty = useMemo(
    () => !ratesEqual(draft[origin], saved[origin]),
    [draft, saved, origin],
  );

  const ratesWarning = useMemo(() => (
    ST_COURIER_ZONES.every(zone => (
      activeRates.zones[zone].envelopeFixedInr === 0
      && activeRates.zones[zone].boxPerKgInr === 0
    ))
  ), [activeRates]);

  const patchOrigin = (patch: Partial<StCourierOriginRates>) => {
    setDraft(prev => ({
      ...prev,
      [origin]: { ...prev[origin], ...patch },
    }));
  };

  const patchZone = (
    zone: StCourierZone,
    field: 'envelopeFixedInr' | 'boxPerKgInr',
    value: number,
  ) => {
    setDraft(prev => ({
      ...prev,
      [origin]: {
        ...prev[origin],
        zones: {
          ...prev[origin].zones,
          [zone]: {
            ...prev[origin].zones[zone],
            [field]: value,
          },
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    onError('');
    try {
      const normalized = await saveStCourierOriginRates(origin, draft[origin], user?.uid ?? null);
      setSaved(prev => ({ ...prev, [origin]: normalized }));
      setDraft(prev => ({ ...prev, [origin]: normalized }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save ST Courier rates.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-logistics__default panel settings-courier-rates">
      <div className="settings-logistics__default-head">
        <div>
          <h4 className="settings-logistics__title">Courier rates</h4>
          <p className="text-muted text-sm">
            Set shipping prices for each courier and warehouse. These rates will be used when booking logistics.
          </p>
        </div>
        {partnerId === 'st_courier' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || saving || loading}
            onClick={() => void handleSave()}
          >
            <Save size={15} aria-hidden />
            Save {STAFF_LOGISTICS_SITE_LABELS[origin]} rates
          </button>
        )}
      </div>

      <div className="settings-courier-rates__partners" role="tablist" aria-label="Courier partner">
        {LOGISTICS_PARTNERS.map(partner => {
          const enabled = partner.id === 'st_courier';
          const selected = partnerId === partner.id;
          return (
            <button
              key={partner.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`settings-courier-rates__partner${selected ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}`}
              disabled={!enabled}
              onClick={() => setPartnerId(partner.id)}
            >
              <span>{partner.label}</span>
              {!enabled && <em>Coming soon</em>}
            </button>
          );
        })}
      </div>

      {partnerId !== 'st_courier' ? (
        <p className="text-muted text-sm settings-courier-rates__placeholder">
          Rate setup for this courier will be added soon.
        </p>
      ) : loading ? (
        <div className="settings-locations__loading settings-courier-rates__loading">
          <div className="loader-ring" />
        </div>
      ) : (
        <>
          <div className="settings-courier-rates__section-label">
            <span>Ship from</span>
            <p className="text-muted text-sm">
              Choose the warehouse these rates apply to. Cochin and Head Office can differ.
            </p>
          </div>
          <div className="settings-courier-rates__origins" role="tablist" aria-label="Ship-from origin">
            {STAFF_LOGISTICS_SITES.map(site => (
              <button
                key={site}
                type="button"
                role="tab"
                aria-selected={origin === site}
                className={`settings-courier-rates__origin${origin === site ? ' is-selected' : ''}`}
                onClick={() => setOrigin(site)}
              >
                {STAFF_LOGISTICS_SITE_LABELS[site]}
              </button>
            ))}
          </div>

          {ratesWarning && (
            <p className="settings-courier-rates__warn text-sm">
              Destination prices are still ₹0. Enter zone rates below before quotes can work.
            </p>
          )}

          <div className="settings-courier-rates__grid settings-courier-rates__grid--meta">
            <fieldset className="settings-courier-rates__card">
              <legend>Box weight rules</legend>
              <p className="text-muted text-sm settings-courier-rates__card-intro">
                Used when shipping a <strong>box</strong>. Documents / envelopes ignore these and use a flat price.
              </p>

              <label className="settings-courier-rates__toggle">
                <input
                  type="checkbox"
                  checked={activeRates.useChargeableWeight}
                  disabled={saving}
                  onChange={e => patchOrigin({ useChargeableWeight: e.target.checked })}
                />
                <span>
                  Bill the higher of scale weight or size-based weight
                  <em>Large light boxes may cost more than their scale weight.</em>
                </span>
              </label>

              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Size-to-weight divisor</span>
                <DecimalAmountInput
                  min={1}
                  decimals={0}
                  value={activeRates.volumetricDivisor}
                  disabled={saving || !activeRates.useChargeableWeight}
                  aria-label="Size-to-weight divisor"
                  onChange={next => {
                    if (next == null) return;
                    patchOrigin({ volumetricDivisor: next });
                  }}
                />
              </label>
              <p className="text-muted text-sm settings-courier-rates__hint">
                Size weight (kg) = length × width × height (cm) ÷ this number. Usually <strong>5000</strong>.
              </p>

              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Minimum billable weight</span>
                <div className="settings-courier-rates__suffix-input">
                  <DecimalAmountInput
                    min={0}
                    decimals={1}
                    value={activeRates.minimumChargeableWeightKg}
                    disabled={saving}
                    aria-label="Minimum billable weight in kilograms"
                    onChange={next => {
                      if (next == null) return;
                      patchOrigin({ minimumChargeableWeightKg: next });
                    }}
                  />
                  <span aria-hidden>kg</span>
                </div>
              </label>
              <p className="text-muted text-sm settings-courier-rates__hint">
                Example: min <strong>2 kg</strong> → a 0.8 kg parcel is billed as 2 kg. Use <strong>0</strong> for no minimum.
              </p>
            </fieldset>

            <fieldset className="settings-courier-rates__card">
              <legend>Fuel surcharge</legend>
              <p className="text-muted text-sm settings-courier-rates__card-intro">
                Extra % added on top of the shipping price (after weight / flat rate).
              </p>
              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Fuel surcharge</span>
                <div className="settings-courier-rates__suffix-input">
                  <DecimalAmountInput
                    min={0}
                    decimals={1}
                    value={activeRates.fuelSurchargePercent}
                    disabled={saving}
                    aria-label="Fuel surcharge percent"
                    onChange={next => {
                      if (next == null) return;
                      patchOrigin({ fuelSurchargePercent: next });
                    }}
                  />
                  <span aria-hidden>%</span>
                </div>
              </label>
              <p className="text-muted text-sm settings-courier-rates__hint">
                Example: freight ₹100 + <strong>10%</strong> fuel = ₹110 total.
              </p>
            </fieldset>
          </div>

          <fieldset className="settings-courier-rates__card settings-courier-rates__zone-card">
            <legend>Destination prices</legend>
            <p className="text-muted text-sm settings-courier-rates__zone-hint">
              Enter what this courier charges from <strong>{STAFF_LOGISTICS_SITE_LABELS[origin]}</strong> to each region.
            </p>
            <div className="settings-courier-rates__zone-table-wrap">
              <table className="settings-courier-rates__zone-table">
                <thead>
                  <tr>
                    <th scope="col">Destination</th>
                    <th scope="col">
                      Document / envelope
                      <span className="settings-courier-rates__th-sub">Flat price (₹)</span>
                    </th>
                    <th scope="col">
                      Box
                      <span className="settings-courier-rates__th-sub">Price per kg (₹)</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ST_COURIER_ZONES.map(zone => (
                    <tr key={zone}>
                      <th scope="row">{ST_COURIER_ZONE_LABELS[zone]}</th>
                      <td>
                        <label>
                          <span className="sr-only">
                            {ST_COURIER_ZONE_LABELS[zone]} document or envelope flat ₹
                          </span>
                          <DecimalAmountInput
                            min={0}
                            decimals={2}
                            value={activeRates.zones[zone].envelopeFixedInr}
                            disabled={saving}
                            aria-label={`${ST_COURIER_ZONE_LABELS[zone]} document or envelope flat rupees`}
                            onChange={next => {
                              if (next == null) return;
                              patchZone(zone, 'envelopeFixedInr', next);
                            }}
                          />
                        </label>
                      </td>
                      <td>
                        <label>
                          <span className="sr-only">
                            {ST_COURIER_ZONE_LABELS[zone]} box ₹ per kg
                          </span>
                          <DecimalAmountInput
                            min={0}
                            decimals={2}
                            value={activeRates.zones[zone].boxPerKgInr}
                            disabled={saving}
                            aria-label={`${ST_COURIER_ZONE_LABELS[zone]} box rupees per kilogram`}
                            onChange={next => {
                              if (next == null) return;
                              patchZone(zone, 'boxPerKgInr', next);
                            }}
                          />
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

          <div className="settings-courier-rates__howto" aria-label="How quotes work">
            <strong>How a quote is calculated</strong>
            <ol>
              <li>
                <strong>Document / envelope</strong>
                {' '}
                — flat price for that destination, then add fuel %.
              </li>
              <li>
                <strong>Box</strong>
                {' '}
                — billable kg = higher of scale weight, size weight (if enabled), and minimum weight; then × ₹/kg, then add fuel %.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
};
