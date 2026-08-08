import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import { useAuth } from '../../../context/AuthContext';
import { defaultLogisticsCourierRates } from '../../../constants/logisticsCourierRates';
import {
  BLUEDART_LOGISTICS_PARTNER_IDS,
  BLUEDART_SERVICE_TO_PARTNER,
  LOGISTICS_PARTNERS,
  TRACKON_LOGISTICS_PARTNER_IDS,
  TRACKON_SERVICE_TO_PARTNER,
  logisticsPartnerImage,
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../../../constants/logisticsPartners';
import { partnerStatusesEqual } from '../../../constants/logisticsPartnerStatus';
import {
  originsUsingPartnerInDeliveryRules,
  partnersUsedInDeliveryRules,
} from '../../../lib/logisticsDeliveryRules';
import {
  blueDartConfigsEqual,
  loadLogisticsCourierRates,
  originRatesForPartner,
  saveBlueDartConfig,
  saveCourierOriginRates,
  saveTrackonConfig,
  trackonConfigsEqual,
} from '../../../lib/logisticsCourierRates';
import { saveLogisticsPartnerStatuses } from '../../../lib/logisticsSettings';
import type { BlueDartConfig } from '../../../types/blue-dart-rates';
import type { TrackonConfig } from '../../../types/trackon-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../../types/logistics-delivery-rules';
import type {
  LogisticsPartnerStatus,
  LogisticsPartnerStatuses,
} from '../../../types/logistics-partner-status';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';
import {
  ST_COURIER_ZONES,
  ST_COURIER_ZONE_LABELS,
  isCourierRatePartnerId,
  partnerUsesOriginRates,
  type BlueDartServiceId,
  type CourierRatePartnerId,
  type LogisticsCourierRates,
  type StCourierOriginRates,
  type StCourierZone,
  type TrackonServiceId,
} from '../../../types/logistics-courier-rates';
import { BlueDartRatesEditor } from './BlueDartRatesEditor';
import { TrackonRatesEditor } from './TrackonRatesEditor';
import { PartnerStatusControl } from './PartnerStatusControl';
import { DelhiveryB2bApiPanel } from './DelhiveryB2bApiPanel';

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

type ZoneRatePartnerId = Extract<CourierRatePartnerId, 'st_courier' | 'delhivery'>;

/** Partner tabs: rate cards + multi-mode tiles, then status-only logistics partners. */
type DeliveryPartnerTabId =
  | CourierRatePartnerId
  | Exclude<
    LogisticsPartnerId,
    | typeof BLUEDART_LOGISTICS_PARTNER_IDS[number]
    | typeof TRACKON_LOGISTICS_PARTNER_IDS[number]
  >;

const LIVE_SAVE_MS = 550;
const STATUS_SAVE_KEY = 'partnerStatuses';

/** Partner picker order: Blue Dart first, then major couriers, then the rest. */
const DETAIL_PARTNER_ORDER: DeliveryPartnerTabId[] = [
  'bluedart',
  'trackon',
  'delhivery',
  'st_courier',
  'dtdc',
  'ecosafe',
  'aps',
  'personal_collection',
  'own_vehicle',
];

function isZoneRatePartnerId(id: DeliveryPartnerTabId): id is ZoneRatePartnerId {
  return id === 'st_courier' || id === 'delhivery';
}

function isStatusOnlyPartnerId(
  id: DeliveryPartnerTabId,
): id is Exclude<
  LogisticsPartnerId,
  | typeof BLUEDART_LOGISTICS_PARTNER_IDS[number]
  | typeof TRACKON_LOGISTICS_PARTNER_IDS[number]
> {
  return !isCourierRatePartnerId(id);
}

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

function partnerMeta(id: DeliveryPartnerTabId) {
  if (id === 'bluedart') {
    return {
      label: 'Blue Dart',
      image: '/logistics/bluedart-surface.webp' as string | null,
    };
  }
  if (id === 'trackon') {
    return {
      label: 'Trackon',
      image: '/logistics/trackon.png' as string | null,
    };
  }
  const partner = LOGISTICS_PARTNERS.find(p => p.id === id);
  return {
    label: partner?.label ?? id,
    image: logisticsPartnerImage(id) ?? partner?.image ?? null,
  };
}

function partnerLabel(id: DeliveryPartnerTabId): string {
  return partnerMeta(id).label;
}

type Props = {
  deliveryRules: LogisticsDeliveryRulesMatrix;
  partnerStatuses: LogisticsPartnerStatuses;
  onPartnerStatusesSaved: (next: LogisticsPartnerStatuses) => void;
  onError: (message: string) => void;
};

function withPartnerRates(
  prev: LogisticsCourierRates,
  partner: ZoneRatePartnerId,
  site: StaffLogisticsSite,
  nextRates: StCourierOriginRates,
): LogisticsCourierRates {
  if (partner === 'st_courier') {
    return {
      ...prev,
      st_courier: {
        ...prev.st_courier,
        [site]: nextRates,
      },
    };
  }
  return {
    ...prev,
    [partner]: nextRates,
  };
}

export const StCourierRatesSettings: React.FC<Props> = ({
  deliveryRules,
  partnerStatuses,
  onPartnerStatusesSaved,
  onError,
}) => {
  const { user } = useAuth();
  const [partnerId, setPartnerId] = useState<DeliveryPartnerTabId>('st_courier');
  const [blueDartService, setBlueDartService] = useState<BlueDartServiceId>('surface');
  const [trackonService, setTrackonService] = useState<TrackonServiceId>('surface');
  const [origin, setOrigin] = useState<StaffLogisticsSite>('head_office');
  const [saved, setSaved] = useState<LogisticsCourierRates>(defaultLogisticsCourierRates);
  const [draft, setDraft] = useState<LogisticsCourierRates>(defaultLogisticsCourierRates);
  const [statusDraft, setStatusDraft] = useState<LogisticsPartnerStatuses>(() => ({
    ...partnerStatuses,
  }));
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  const statusDraftRef = useRef(statusDraft);
  const statusSavedRef = useRef(partnerStatuses);
  const saveTimersRef = useRef<Partial<Record<string, ReturnType<typeof setTimeout>>>>({});
  const saveEpochRef = useRef(0);
  const userUid = user?.uid ?? null;

  draftRef.current = draft;
  savedRef.current = saved;
  statusDraftRef.current = statusDraft;
  statusSavedRef.current = partnerStatuses;

  const visiblePartners = DETAIL_PARTNER_ORDER;
  const isZonePartner = isZoneRatePartnerId(partnerId);
  const isStatusOnlyPartner = isStatusOnlyPartnerId(partnerId);
  const blueDartServiceStatuses = useMemo(() => ({
    air: statusDraft.bluedart_air,
    surface: statusDraft.bluedart_surface,
    domestic_priority: statusDraft.bluedart_domestic,
  }), [statusDraft]);
  const trackonServiceStatuses = useMemo(() => ({
    air: statusDraft.trackon_air,
    surface: statusDraft.trackon_surface,
  }), [statusDraft]);

  const visibleOrigins = useMemo(() => {
    if (!isZonePartner || !partnerUsesOriginRates(partnerId)) {
      return [] as StaffLogisticsSite[];
    }
    const sites = originsUsingPartnerInDeliveryRules(
      deliveryRules,
      partnerId as LogisticsPartnerId,
    );
    return sites.length ? sites : [...STAFF_LOGISTICS_SITES];
  }, [deliveryRules, isZonePartner, partnerId]);

  useEffect(() => {
    if (!visiblePartners.includes(partnerId)) {
      setPartnerId(visiblePartners[0]);
    }
  }, [visiblePartners, partnerId]);

  useEffect(() => {
    if (!isZonePartner || !partnerUsesOriginRates(partnerId)) return;
    if (!visibleOrigins.length) return;
    if (!visibleOrigins.includes(origin)) {
      setOrigin(visibleOrigins[0]);
    }
  }, [visibleOrigins, origin, partnerId, isZonePartner]);

  useEffect(() => {
    setStatusDraft({ ...partnerStatuses });
  }, [partnerStatuses]);

  const loadRates = useCallback(async () => {
    setLoading(true);
    setSaveStatus('idle');
    try {
      const rates = await loadLogisticsCourierRates();
      setSaved(rates);
      setDraft(rates);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load partner rates.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  useEffect(() => () => {
    for (const timer of Object.values(saveTimersRef.current)) {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const queueLiveSave = useCallback((
    partner: ZoneRatePartnerId,
    site: StaffLogisticsSite,
  ) => {
    const key = partner === 'st_courier' ? `st_courier:${site}` : partner;
    const existing = saveTimersRef.current[key];
    if (existing) clearTimeout(existing);
    setSaveStatus('pending');
    saveTimersRef.current[key] = setTimeout(() => {
      const rates = originRatesForPartner(draftRef.current, partner, site);
      const savedRates = originRatesForPartner(savedRef.current, partner, site);
      if (ratesEqual(rates, savedRates)) {
        setSaveStatus(prev => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      onError('');
      void saveCourierOriginRates(partner, site, rates, userUid)
        .then(normalized => {
          setSaved(prev => withPartnerRates(prev, partner, site, normalized));
          setDraft(prev => {
            const current = originRatesForPartner(prev, partner, site);
            if (!ratesEqual(current, rates)) return prev;
            return withPartnerRates(prev, partner, site, normalized);
          });
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          onError(err instanceof Error ? err.message : 'Could not save partner rates.');
        });
    }, LIVE_SAVE_MS);
  }, [onError, userUid]);

  const queueBlueDartSave = useCallback(() => {
    const key = 'bluedart';
    const existing = saveTimersRef.current[key];
    if (existing) clearTimeout(existing);
    setSaveStatus('pending');
    saveTimersRef.current[key] = setTimeout(() => {
      const next = draftRef.current.bluedart;
      const prev = savedRef.current.bluedart;
      if (blueDartConfigsEqual(next, prev)) {
        setSaveStatus(s => (s === 'pending' ? 'idle' : s));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      onError('');
      void saveBlueDartConfig(next, userUid)
        .then(normalized => {
          setSaved(s => ({ ...s, bluedart: normalized }));
          setDraft(d => {
            if (!blueDartConfigsEqual(d.bluedart, next)) return d;
            return { ...d, bluedart: normalized };
          });
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          onError(err instanceof Error ? err.message : 'Could not save Blue Dart rates.');
        });
    }, LIVE_SAVE_MS);
  }, [onError, userUid]);

  const queueTrackonSave = useCallback(() => {
    const key = 'trackon';
    const existing = saveTimersRef.current[key];
    if (existing) clearTimeout(existing);
    setSaveStatus('pending');
    saveTimersRef.current[key] = setTimeout(() => {
      const next = draftRef.current.trackon;
      const prev = savedRef.current.trackon;
      if (trackonConfigsEqual(next, prev)) {
        setSaveStatus(s => (s === 'pending' ? 'idle' : s));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      onError('');
      void saveTrackonConfig(next, userUid)
        .then(normalized => {
          setSaved(s => ({ ...s, trackon: normalized }));
          setDraft(d => {
            if (!trackonConfigsEqual(d.trackon, next)) return d;
            return { ...d, trackon: normalized };
          });
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          onError(err instanceof Error ? err.message : 'Could not save Trackon rates.');
        });
    }, LIVE_SAVE_MS);
  }, [onError, userUid]);

  const queueStatusSave = useCallback(() => {
    const existing = saveTimersRef.current[STATUS_SAVE_KEY];
    if (existing) clearTimeout(existing);
    setSaveStatus('pending');
    saveTimersRef.current[STATUS_SAVE_KEY] = setTimeout(() => {
      const next = statusDraftRef.current;
      const prev = statusSavedRef.current;
      if (partnerStatusesEqual(next, prev)) {
        setSaveStatus(s => (s === 'pending' ? 'idle' : s));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      onError('');
      void saveLogisticsPartnerStatuses(next, userUid)
        .then(normalized => {
          setStatusDraft(normalized);
          onPartnerStatusesSaved(normalized);
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          onError(err instanceof Error ? err.message : 'Could not save partner status.');
        });
    }, LIVE_SAVE_MS);
  }, [onError, onPartnerStatusesSaved, userUid]);

  const activeRates = isZonePartner
    ? originRatesForPartner(draft, partnerId, origin)
    : null;

  const ratesWarning = useMemo(() => {
    if (!activeRates) return false;
    return ST_COURIER_ZONES.every(zone => (
      activeRates.zones[zone].envelopeFixedInr === 0
      && activeRates.zones[zone].boxPerKgInr === 0
    ));
  }, [activeRates]);

  const patchOrigin = (patch: Partial<StCourierOriginRates>) => {
    if (!isZonePartner) return;
    const partner = partnerId;
    setDraft(prev => {
      const current = originRatesForPartner(prev, partner, origin);
      return withPartnerRates(prev, partner, origin, { ...current, ...patch });
    });
    queueLiveSave(partner, origin);
  };

  const patchZone = (
    zone: StCourierZone,
    field: 'envelopeFixedInr' | 'boxPerKgInr',
    value: number,
  ) => {
    if (!isZonePartner) return;
    const partner = partnerId;
    setDraft(prev => {
      const current = originRatesForPartner(prev, partner, origin);
      return withPartnerRates(prev, partner, origin, {
        ...current,
        zones: {
          ...current.zones,
          [zone]: {
            ...current.zones[zone],
            [field]: value,
          },
        },
      });
    });
    queueLiveSave(partner, origin);
  };

  const patchBlueDart = (next: BlueDartConfig) => {
    setDraft(prev => ({ ...prev, bluedart: next }));
    queueBlueDartSave();
  };

  const patchTrackon = (next: TrackonConfig) => {
    setDraft(prev => ({ ...prev, trackon: next }));
    queueTrackonSave();
  };

  const setLogisticsPartnerStatus = (
    id: LogisticsPartnerId,
    next: LogisticsPartnerStatus,
  ) => {
    if (id === 'personal_collection') return;
    const updated = { ...statusDraftRef.current, [id]: next };
    statusDraftRef.current = updated;
    setStatusDraft(updated);
    queueStatusSave();
  };

  const partnerInDeliveryRules = useMemo(() => {
    const used = partnersUsedInDeliveryRules(deliveryRules);
    if (partnerId === 'bluedart') {
      return BLUEDART_LOGISTICS_PARTNER_IDS.some(id => used.includes(id));
    }
    if (partnerId === 'trackon') {
      return TRACKON_LOGISTICS_PARTNER_IDS.some(id => used.includes(id));
    }
    return used.includes(partnerId as LogisticsPartnerId);
  }, [deliveryRules, partnerId]);

  const saveStatusLabel = saveStatus === 'pending' || saveStatus === 'saving'
    ? 'Saving…'
    : saveStatus === 'saved'
      ? 'Saved'
      : saveStatus === 'error'
        ? 'Save failed'
        : 'Changes save automatically';

  const showOriginPicker = isZonePartner && partnerUsesOriginRates(partnerId);
  const showSharedRateNote = isZonePartner && !partnerUsesOriginRates(partnerId);

  return (
    <div className="settings-logistics__default panel settings-courier-rates">
      <div className="settings-logistics__default-head">
        <div>
          <h4 className="settings-logistics__title">Delivery Partners</h4>
        </div>
        {!loading ? (
          <span
            className={`settings-courier-rates__save-status${
              saveStatus === 'saved' ? ' is-saved' : ''
            }${saveStatus === 'error' ? ' is-error' : ''}${
              saveStatus === 'pending' || saveStatus === 'saving' ? ' is-busy' : ''
            }`}
            role="status"
            aria-live="polite"
          >
            {saveStatusLabel}
          </span>
        ) : null}
      </div>

      <div
        className="settings-courier-rates__partner-grid"
        role="tablist"
        aria-label="Delivery partners"
      >
        {visiblePartners.map(id => {
          const meta = partnerMeta(id);
          const selected = id === partnerId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`settings-courier-rates__partner-card${selected ? ' is-selected' : ''}`}
              onClick={() => setPartnerId(id)}
            >
              <span className="settings-courier-rates__partner-logo-wrap">
                {meta.image ? (
                  <img
                    src={meta.image}
                    alt=""
                    className="settings-courier-rates__partner-logo"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="settings-courier-rates__partner-logo-fallback" aria-hidden>
                    {meta.label.slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="settings-courier-rates__partner-copy">
                <span className="settings-courier-rates__partner-name">{meta.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {showOriginPicker ? (
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
        </div>
      ) : null}
      {showSharedRateNote ? (
        <p className="settings-courier-rates__shared-note text-muted text-sm">
          One rate card for all ship-from sites.
        </p>
      ) : null}
      {isStatusOnlyPartner ? (
        <p className="settings-courier-rates__shared-note text-muted text-sm">
          No rate card for this partner — status still controls whether it appears on sales orders
          when assigned in Delivery rules.
        </p>
      ) : null}
      {!partnerInDeliveryRules ? (
        <p className="settings-courier-rates__empty-partners text-muted text-sm">
          {partnerLabel(partnerId)} is not in Delivery rules yet — status
          {isStatusOnlyPartner ? '' : ' and rates'} still save automatically.
        </p>
      ) : null}

      {loading ? (
        <div className="settings-locations__loading settings-courier-rates__loading">
          <div className="loader-ring" />
        </div>
      ) : partnerId === 'bluedart' ? (
        <BlueDartRatesEditor
          config={draft.bluedart}
          service={blueDartService}
          onServiceChange={setBlueDartService}
          onChange={patchBlueDart}
          serviceStatuses={blueDartServiceStatuses}
          onServiceStatusChange={(service, next) => {
            setLogisticsPartnerStatus(BLUEDART_SERVICE_TO_PARTNER[service], next);
          }}
        />
      ) : partnerId === 'trackon' ? (
        <TrackonRatesEditor
          config={draft.trackon}
          service={trackonService}
          onServiceChange={setTrackonService}
          onChange={patchTrackon}
          serviceStatuses={trackonServiceStatuses}
          onServiceStatusChange={(service, next) => {
            setLogisticsPartnerStatus(TRACKON_SERVICE_TO_PARTNER[service], next);
          }}
        />
      ) : isStatusOnlyPartner ? (
        <PartnerStatusControl
          status={statusDraft[partnerId]}
          ariaLabel={`Status for ${logisticsPartnerLabel(partnerId)}`}
          disabled={partnerId === 'personal_collection'}
          title={
            partnerId === 'personal_collection'
              ? 'Customer Pickup stays available on every sales order'
              : undefined
          }
          onChange={next => {
            setLogisticsPartnerStatus(partnerId, next);
          }}
        />
      ) : isZonePartner && activeRates ? (
        <>
          <PartnerStatusControl
            status={statusDraft[partnerId]}
            ariaLabel={`Status for ${logisticsPartnerLabel(partnerId)}`}
            onChange={next => {
              setLogisticsPartnerStatus(partnerId, next);
            }}
          />

          {partnerId === 'delhivery' ? (
            <DelhiveryB2bApiPanel onError={onError} />
          ) : null}

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
                    disabled={!activeRates.useChargeableWeight}
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
              {partnerUsesOriginRates(partnerId)
                ? `Prices from ${STAFF_LOGISTICS_SITE_LABELS[origin]}`
                : 'Prices (all ship-from sites)'}
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
      ) : null}
    </div>
  );
};
