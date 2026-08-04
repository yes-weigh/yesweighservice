import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import { useAuth } from '../../../context/AuthContext';
import { defaultLogisticsCourierRates } from '../../../constants/logisticsCourierRates';
import { LOGISTICS_PARTNERS } from '../../../constants/logisticsPartners';
import {
  originsUsingAnyPartnerInDeliveryRules,
  partnersForOriginInDeliveryRules,
  partnersUsedInDeliveryRules,
} from '../../../lib/logisticsDeliveryRules';
import {
  loadLogisticsCourierRates,
  saveCourierOriginRates,
} from '../../../lib/logisticsCourierRates';
import type { LogisticsDeliveryRulesMatrix } from '../../../types/logistics-delivery-rules';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';
import {
  COURIER_RATE_PARTNER_IDS,
  ST_COURIER_ZONES,
  ST_COURIER_ZONE_LABELS,
  isCourierRatePartnerId,
  type CourierRatePartnerId,
  type LogisticsCourierRates,
  type StCourierOriginRates,
  type StCourierZone,
} from '../../../types/logistics-courier-rates';

const RATE_PARTNER_ORDER = COURIER_RATE_PARTNER_IDS;

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

function partnerLabel(id: CourierRatePartnerId): string {
  return LOGISTICS_PARTNERS.find(p => p.id === id)?.label ?? id;
}

type Props = {
  /** Current delivery-rules matrix — drives which couriers / origins appear. */
  deliveryRules: LogisticsDeliveryRulesMatrix;
  /** Bubble errors up to the parent Logistics tab banner. */
  onError: (message: string) => void;
};

export const StCourierRatesSettings: React.FC<Props> = ({ deliveryRules, onError }) => {
  const { user } = useAuth();
  const [partnerId, setPartnerId] = useState<CourierRatePartnerId>('st_courier');
  const [origin, setOrigin] = useState<StaffLogisticsSite>('head_office');
  const [saved, setSaved] = useState<LogisticsCourierRates>(defaultLogisticsCourierRates);
  const [draft, setDraft] = useState<LogisticsCourierRates>(defaultLogisticsCourierRates);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** Sites that use at least one priced courier in Delivery rules. */
  const visibleOrigins = useMemo(() => {
    const sites = originsUsingAnyPartnerInDeliveryRules(deliveryRules, RATE_PARTNER_ORDER);
    return sites.length ? sites : [...STAFF_LOGISTICS_SITES];
  }, [deliveryRules]);

  /** Priced couriers for the selected site only (Pickup / own vehicle omitted). */
  const visiblePartners = useMemo(() => {
    const atSite = new Set(partnersForOriginInDeliveryRules(deliveryRules, origin));
    return RATE_PARTNER_ORDER.filter(id => atSite.has(id));
  }, [deliveryRules, origin]);

  const anyRatePartnerInRules = useMemo(
    () => partnersUsedInDeliveryRules(deliveryRules).some(id => isCourierRatePartnerId(id)),
    [deliveryRules],
  );

  useEffect(() => {
    if (!visibleOrigins.length) return;
    if (!visibleOrigins.includes(origin)) {
      setOrigin(visibleOrigins[0]);
    }
  }, [visibleOrigins, origin]);

  useEffect(() => {
    if (!visiblePartners.length) return;
    if (!visiblePartners.includes(partnerId)) {
      setPartnerId(visiblePartners[0]);
    }
  }, [visiblePartners, partnerId]);

  const loadRates = useCallback(async () => {
    setLoading(true);
    try {
      const rates = await loadLogisticsCourierRates();
      setSaved(rates);
      setDraft(rates);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load courier rates.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const activeRates = draft[partnerId][origin];
  const dirty = useMemo(
    () => !ratesEqual(draft[partnerId][origin], saved[partnerId][origin]),
    [draft, saved, origin, partnerId],
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
      [partnerId]: {
        ...prev[partnerId],
        [origin]: { ...prev[partnerId][origin], ...patch },
      },
    }));
  };

  const patchZone = (
    zone: StCourierZone,
    field: 'envelopeFixedInr' | 'boxPerKgInr',
    value: number,
  ) => {
    setDraft(prev => ({
      ...prev,
      [partnerId]: {
        ...prev[partnerId],
        [origin]: {
          ...prev[partnerId][origin],
          zones: {
            ...prev[partnerId][origin].zones,
            [zone]: {
              ...prev[partnerId][origin].zones[zone],
              [field]: value,
            },
          },
        },
      },
    }));
  };

  const handleSave = async () => {
    if (!isCourierRatePartnerId(partnerId)) return;
    setSaving(true);
    onError('');
    try {
      const normalized = await saveCourierOriginRates(
        partnerId,
        origin,
        draft[partnerId][origin],
        user?.uid ?? null,
      );
      setSaved(prev => ({
        ...prev,
        [partnerId]: { ...prev[partnerId], [origin]: normalized },
      }));
      setDraft(prev => ({
        ...prev,
        [partnerId]: { ...prev[partnerId], [origin]: normalized },
      }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save courier rates.');
    } finally {
      setSaving(false);
    }
  };

  if (!anyRatePartnerInRules) {
    return (
      <div className="settings-logistics__default panel settings-courier-rates">
        <div className="settings-logistics__default-head">
          <div>
            <h4 className="settings-logistics__title">Courier rates</h4>
            <p className="text-muted text-sm">
              No priced couriers in Delivery rules yet. Add ST, Trackon, or Delhivery on the
              Delivery rules tab — Pickup and Own vehicle do not need rate cards.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const canEditRates = visiblePartners.length > 0 && isCourierRatePartnerId(partnerId);

  return (
    <div className="settings-logistics__default panel settings-courier-rates">
      <div className="settings-logistics__default-head">
        <div>
          <h4 className="settings-logistics__title">Courier rates</h4>
          <p className="text-muted text-sm">
            Pick a ship-from site, then the courier. Only partners from Delivery rules (Pickup skipped).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canEditRates || !dirty || saving || loading}
          onClick={() => void handleSave()}
        >
          <Save size={15} aria-hidden />
          Save {canEditRates ? `${partnerLabel(partnerId)} · ${STAFF_LOGISTICS_SITE_LABELS[origin]}` : 'rates'}
        </button>
      </div>

      <div className="settings-courier-rates__hierarchy">
        <div className="settings-courier-rates__level">
          <span className="settings-courier-rates__level-label">Ship from</span>
          <div
            className="settings-courier-rates__origins settings-courier-rates__origins--master"
            role="tablist"
            aria-label="Ship-from site"
          >
            {visibleOrigins.map(site => (
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
        </div>

        <div className="settings-courier-rates__level">
          <span className="settings-courier-rates__level-label">Courier</span>
          {visiblePartners.length ? (
            <div
              className="settings-courier-rates__partners settings-courier-rates__partners--compact"
              role="tablist"
              aria-label="Courier partner"
            >
              {visiblePartners.map(id => {
                const selected = id === partnerId;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`settings-courier-rates__partner${selected ? ' is-selected' : ''}`}
                    onClick={() => setPartnerId(id)}
                  >
                    {partnerLabel(id)}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="settings-courier-rates__empty-partners text-muted text-sm">
              {STAFF_LOGISTICS_SITE_LABELS[origin]} has no priced courier in Delivery rules
              (only Pickup / Own vehicle).
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="settings-locations__loading settings-courier-rates__loading">
          <div className="loader-ring" />
        </div>
      ) : !canEditRates ? null : (
        <>
          {ratesWarning && (
            <p className="settings-courier-rates__warn text-sm">
              All destinations are ₹0 — enter rates below (or leave as placeholder).
            </p>
          )}

          <div className="settings-courier-rates__grid settings-courier-rates__grid--meta">
            <fieldset className="settings-courier-rates__card">
              <legend>Box weight rules</legend>
              <label className="settings-courier-rates__toggle">
                <input
                  type="checkbox"
                  checked={activeRates.useChargeableWeight}
                  disabled={saving}
                  onChange={e => patchOrigin({ useChargeableWeight: e.target.checked })}
                />
                <span>
                  Use chargeable weight (max of scale / size)
                  <em>Size weight = L × W × H ÷ divisor</em>
                </span>
              </label>

              <div className="settings-courier-rates__inline-fields">
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>Divisor</span>
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
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>Min weight</span>
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
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>Fuel</span>
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
              </div>
            </fieldset>
          </div>

          <fieldset className="settings-courier-rates__card settings-courier-rates__zone-card">
            <legend>
              Prices from {STAFF_LOGISTICS_SITE_LABELS[origin]}
            </legend>
            <div className="settings-courier-rates__zone-table-wrap">
              <table className="settings-courier-rates__zone-table">
                <thead>
                  <tr>
                    <th scope="col">Destination</th>
                    <th scope="col">
                      Envelope
                      <span className="settings-courier-rates__th-sub">Flat ₹</span>
                    </th>
                    <th scope="col">
                      Box
                      <span className="settings-courier-rates__th-sub">₹ / kg</span>
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
                            {ST_COURIER_ZONE_LABELS[zone]} envelope flat ₹
                          </span>
                          <DecimalAmountInput
                            min={0}
                            decimals={2}
                            value={activeRates.zones[zone].envelopeFixedInr}
                            disabled={saving}
                            aria-label={`${ST_COURIER_ZONE_LABELS[zone]} envelope flat rupees`}
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
        </>
      )}
    </div>
  );
};
