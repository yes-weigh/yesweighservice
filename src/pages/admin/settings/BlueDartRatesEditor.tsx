/**
 * Super-admin Blue Dart tariff editor (Settings → Delivery Partners → Blue Dart).
 * Live-saves `appSettings/logisticsCourierRates.bluedart` via saveBlueDartConfig.
 * Tabs: Surface | Air | Domestic Priority (shared surcharges/EDL appear on each).
 * Does NOT edit blueDartPincodes or zone/EDL matrices (re-seed those from Excel).
 * Zoho product IDs are hardcoded in freightLines.ts — intentionally not shown here.
 * Full architecture notes: src/types/blue-dart-rates.ts
 */
import React, { useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import {
  BLUE_DART_DIESEL_FUEL_SURCHARGE_URL,
  fetchBlueDartDieselFuelSurcharge,
} from '../../../lib/blueDartDieselFuel';
import { blueDartStatesByAirZone } from '../../../lib/blueDartZone';
import {
  BLUE_DART_AIR_ZONES,
  BLUE_DART_DP_ZONES,
  BLUE_DART_EDL_MODES,
  type BlueDartAirZone,
  type BlueDartConfig,
  type BlueDartDpZone,
  type BlueDartEdlMode,
  type BlueDartKgServiceRates,
  type BlueDartSharedRules,
  type BlueDartSurfaceRates,
} from '../../../types/blue-dart-rates';
import {
  BLUE_DART_SERVICE_META,
  type BlueDartServiceId,
} from '../../../types/logistics-courier-rates';

type Props = {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  onServiceChange: (service: BlueDartServiceId) => void;
  onChange: (next: BlueDartConfig) => void;
};

const MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

const TABS: Array<{ id: BlueDartServiceId; label: string; sku: string; image: string }> = [
  { id: 'surface', label: 'Surface', sku: 'BDFRC', image: '/logistics/bluedart-surface.webp' },
  { id: 'air', label: 'Air', sku: 'BDAIR', image: '/logistics/bluedart-air.webp' },
  {
    id: 'domestic_priority',
    label: 'Domestic Priority',
    sku: 'BDDP',
    image: '/logistics/bluedart-domestic-priority.webp',
  },
];

const SERVICE_BLURB: Record<BlueDartServiceId, string> = {
  air: 'Express air (Apex). Billed by Zone 1–5 ₹/kg, usually min 10 kg.',
  surface: 'Ground / Surface Band 13. Billed by Zone 1–5 ₹/kg, usually min 10 kg.',
  domestic_priority: 'Priority parcels. Billed in 500 g slabs (Within Kerala A1, then A/B/C).',
};

function Field(props: {
  label: string;
  tip?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-courier-rates__field settings-courier-rates__field--plain">
      <span
        className={props.tip ? 'settings-bluedart__label-tip' : undefined}
        data-tip={props.tip || undefined}
        tabIndex={props.tip ? 0 : undefined}
      >
        {props.label}
      </span>
      {props.children}
      {props.hint ? <em className="settings-bluedart__hint">{props.hint}</em> : null}
    </label>
  );
}

function PctInput(props: {
  label: string;
  tip?: string;
  value: number;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={props.label}
      tip={props.tip}
      hint={props.hint}
    >
      <div className="settings-courier-rates__suffix-input">
        <DecimalAmountInput
          min={0}
          decimals={2}
          value={props.value}
          aria-label={props.label}
          onChange={next => {
            if (next == null) return;
            props.onChange(next);
          }}
        />
        <span aria-hidden>%</span>
      </div>
    </Field>
  );
}

function InrInput(props: {
  label: string;
  tip?: string;
  value: number;
  hint?: string;
  decimals?: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={props.label}
      tip={props.tip}
      hint={props.hint}
    >
      <div className="settings-courier-rates__suffix-input">
        <DecimalAmountInput
          min={0}
          decimals={props.decimals ?? 2}
          value={props.value}
          aria-label={props.label}
          onChange={next => {
            if (next == null) return;
            props.onChange(next);
          }}
        />
        <span aria-hidden>₹</span>
      </div>
    </Field>
  );
}

function SharedChargesEditor(props: {
  shared: BlueDartConfig['shared'];
  /** Surface uses diesel FS only — hide shared Fuel / CAF on that tab. */
  forService: BlueDartServiceId;
  onPatch: (patch: Partial<BlueDartConfig['shared']>) => void;
}) {
  const { shared, onPatch, forService } = props;
  const surfaceTab = forService === 'surface';
  return (
    <div className="settings-bluedart__shared-block">
      <div className="settings-bluedart__shared-head">
        <strong>Charges for all services</strong>
        <em>
          {surfaceTab
            ? 'RAS, insurance, and EDL apply here. Surface fuel is Diesel FS below (no CAF).'
            : 'Fuel, CAF, RAS, insurance, and EDL apply to Air and Domestic Priority (ex-GST).'}
        </em>
      </div>

      <div className="settings-bluedart__subhead">Everyday surcharges</div>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
        {!surfaceTab ? (
          <>
            <PctInput
              label="Fuel (FS)"
              tip="Fuel Surcharge — absolute % you bill (e.g. 92). Not used for Surface."
              value={shared.fuelSurchargePercent}
              onChange={fuelSurchargePercent => onPatch({ fuelSurchargePercent })}
            />
            <PctInput
              label="CAF"
              tip="Currency Adjustment Factor — absolute % (e.g. 22). Not used for Surface."
              value={shared.cafPercent}
              onChange={cafPercent => onPatch({ cafPercent })}
            />
          </>
        ) : null}
        <InrInput
          label="Remote area (RAS)"
          tip="Remote Area Surcharge — ₹/kg for Bihar, Jharkhand, Kerala, J&K, Ladakh."
          value={shared.rasPerKgInr}
          hint="Only certain states"
          onChange={rasPerKgInr => onPatch({ rasPerKgInr })}
        />
        <InrInput
          label="Insurance min (FOV)"
          tip="Freight on Value — minimum insurance ₹ per AWB."
          value={shared.fov.minInr}
          onChange={minInr => onPatch({ fov: { ...shared.fov, minInr } })}
        />
        <PctInput
          label="Insurance % of invoice"
          tip="FOV % of invoice value. Billed as max(min, this %)."
          value={shared.fov.percentOfInvoice}
          hint="e.g. 0.05 = 0.05%"
          onChange={percentOfInvoice => onPatch({
            fov: { ...shared.fov, percentOfInvoice },
          })}
        />
        <label className="settings-courier-rates__toggle">
          <input
            type="checkbox"
            checked={shared.hideTemPer}
            onChange={e => onPatch({ hideTemPer: e.target.checked })}
          />
          <span>
            <span
              className="settings-bluedart__label-tip"
              data-tip="TEM = temporary exclusion, PER = permanent. When on, those pins are not offered."
              tabIndex={0}
            >
              Hide TEM / PER pins
            </span>
            <em>Skip pins Blue Dart marked unavailable</em>
          </span>
        </label>
      </div>

      <div className="settings-bluedart__subhead">Extra delivery locations (EDL)</div>
      <p className="settings-bluedart__panel-blurb">
        Used when the pincode is outside Blue Dart’s standard coverage.
        Set a flat ₹ if you do not store hub distance.
      </p>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
        <Field
          label="EDL mode"
          tip="How to charge EDL pins. flat_fallback = use the flat ₹ below when km is unknown."
        >
          <select
            className="settings-bluedart__select"
            value={shared.edlMode}
            onChange={e => onPatch({ edlMode: e.target.value as BlueDartEdlMode })}
          >
            {BLUE_DART_EDL_MODES.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <InrInput
          label="EDL flat ₹"
          tip="Charged for EDL pins when hub-km is unknown."
          value={shared.edlFlatFallbackInr}
          hint="Main gap-fill field"
          onChange={edlFlatFallbackInr => onPatch({ edlFlatFallbackInr })}
        />
        <InrInput
          label="NE / J&K ₹ per kg"
          tip="Special EDL for North-East and J&K — vs floor, higher wins."
          value={shared.edlNeJkPerKgInr}
          onChange={edlNeJkPerKgInr => onPatch({ edlNeJkPerKgInr })}
        />
        <InrInput
          label="NE / J&K minimum ₹"
          tip="Floor for NE / J&K EDL."
          value={shared.edlNeJkFloorInr}
          onChange={edlNeJkFloorInr => onPatch({ edlNeJkFloorInr })}
        />
        <InrInput
          label="Beyond 500 km ₹/km"
          tip="Only when pin has edlKm stored."
          value={shared.edlBeyond500KmPerKmInr}
          onChange={edlBeyond500KmPerKmInr => onPatch({ edlBeyond500KmPerKmInr })}
        />
        <InrInput
          label="Beyond 1500 kg ₹/kg"
          tip="Heavy EDL shipments when distance is known."
          value={shared.edlBeyond1500KgPerKgInr}
          onChange={edlBeyond1500KgPerKgInr => onPatch({ edlBeyond1500KgPerKgInr })}
        />
      </div>
    </div>
  );
}

function KgServiceEditor(props: {
  service: 'air' | 'surface';
  rates: BlueDartKgServiceRates | BlueDartSurfaceRates;
  shared: BlueDartSharedRules;
  onPatch: (patch: Partial<BlueDartSurfaceRates>) => void;
}) {
  const { rates, onPatch, service, shared } = props;
  const surfaceRates = service === 'surface' ? rates as BlueDartSurfaceRates : null;
  const statesByZone = useMemo(() => blueDartStatesByAirZone(shared), [shared]);
  const [dieselFetchBusy, setDieselFetchBusy] = useState(false);
  const [dieselFetchNote, setDieselFetchNote] = useState<string | null>(null);
  const [dieselFetchError, setDieselFetchError] = useState<string | null>(null);

  const surfaceDieselPercent = surfaceRates?.fuelSurchargePercent ?? 0;

  const handleFetchDieselFs = async () => {
    if (!surfaceRates || dieselFetchBusy) return;
    setDieselFetchBusy(true);
    setDieselFetchError(null);
    setDieselFetchNote(null);
    try {
      const result = await fetchBlueDartDieselFuelSurcharge();
      onPatch({ fuelSurchargePercent: result.percent, cafPercent: null });
      setDieselFetchNote(
        `Applied ${result.percent}% (effective ${result.effectiveLabel}).`,
      );
    } catch (err) {
      setDieselFetchError(
        err instanceof Error ? err.message : 'Could not fetch diesel fuel surcharge.',
      );
    } finally {
      setDieselFetchBusy(false);
    }
  };

  return (
    <div className="settings-bluedart__service-block">
      <div className="settings-bluedart__subhead">
        {service === 'air' ? 'Air rates' : 'Surface rates'}
      </div>
      <p className="settings-bluedart__panel-blurb">{SERVICE_BLURB[service]}</p>

      {surfaceRates ? (
        <>
          <div className="settings-bluedart__subhead">Diesel fuel surcharge</div>
          <p className="settings-bluedart__panel-blurb">
            Surface fuel charge (no shared Fuel / CAF). Fetch from Blue Dart’s published table.
            {' '}
            <a
              href={BLUE_DART_DIESEL_FUEL_SURCHARGE_URL}
              target="_blank"
              rel="noreferrer"
              className="settings-bluedart__inline-link"
            >
              bluedart.com/diesel-fuel-surcharge
              <ExternalLink size={12} aria-hidden />
            </a>
          </p>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid settings-bluedart__diesel-row">
            <PctInput
              label="Diesel FS"
              tip="Published Diesel Fuel Surcharge % for Surface only."
              value={surfaceDieselPercent}
              onChange={fuelSurchargePercent => onPatch({
                fuelSurchargePercent,
                cafPercent: null,
              })}
            />
            <div className="settings-bluedart__diesel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={dieselFetchBusy}
                onClick={() => void handleFetchDieselFs()}
              >
                {dieselFetchBusy
                  ? <Loader2 size={14} className="spin-icon" aria-hidden />
                  : <RefreshCw size={14} aria-hidden />}
                {dieselFetchBusy ? 'Fetching…' : 'Fetch current'}
              </button>
            </div>
          </div>
          {dieselFetchNote ? (
            <p className="settings-bluedart__diesel-note text-sm">{dieselFetchNote}</p>
          ) : null}
          {dieselFetchError ? (
            <p className="settings-bluedart__diesel-error text-sm" role="alert">{dieselFetchError}</p>
          ) : null}
        </>
      ) : null}

      <div className="settings-bluedart__subhead">Weight &amp; fees</div>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
        <Field
          label="Min weight (kg)"
          tip="If the parcel is lighter, billing still uses this floor."
        >
          <DecimalAmountInput
            min={0}
            decimals={1}
            value={rates.minimumChargeableWeightKg}
            onChange={next => {
              if (next == null) return;
              onPatch({ minimumChargeableWeightKg: next });
            }}
          />
        </Field>
        <InrInput
          label="Min freight"
          tip="Floor for base freight before % surcharges and docket."
          value={rates.minimumFreightInr}
          onChange={minimumFreightInr => onPatch({ minimumFreightInr })}
        />
        <InrInput
          label="Docket fee"
          tip="Fixed AWB fee added once per shipment."
          value={rates.docketFeeInr}
          onChange={docketFeeInr => onPatch({ docketFeeInr })}
        />
        <Field
          label="Volumetric divisor"
          tip="Volumetric kg = L × B × H (cm) ÷ divisor. Chargeable = max(actual, volumetric)."
        >
          <DecimalAmountInput
            min={1}
            decimals={0}
            value={rates.volumetricDivisor}
            onChange={next => {
              if (next == null) return;
              onPatch({ volumetricDivisor: next });
            }}
          />
        </Field>
      </div>

      <div className="settings-bluedart__subhead">Extra % on this service</div>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
        <PctInput
          label="IDC"
          tip="Infrastructure Development Charge — % on base freight."
          value={rates.idcPercent}
          onChange={idcPercent => onPatch({ idcPercent })}
        />
        <PctInput
          label="EFSS"
          tip={service === 'surface'
            ? 'Elevated Freight Stability Surcharge — % after diesel FS.'
            : 'Elevated Freight Stability Surcharge — % after CAF.'}
          value={rates.efssPercent}
          onChange={efssPercent => onPatch({ efssPercent })}
        />
        {service === 'air' ? (
          <PctInput
            label="PSS"
            tip="Peak Season Surcharge — % on base freight."
            value={rates.pssPercent}
            onChange={pssPercent => onPatch({ pssPercent })}
          />
        ) : null}
      </div>

      {surfaceRates ? (
        <>
          <div className="settings-bluedart__subhead">Festival surcharge</div>
          <p className="settings-bluedart__panel-blurb">
            Applied on base freight only when the quote month falls in the festival season
            (inclusive). Season can wrap the year — e.g. October → January.
          </p>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
            <PctInput
              label="Festival %"
              tip="Festival surcharge — % of base freight during the season below."
              value={surfaceRates.festivalSurchargePercent}
              onChange={festivalSurchargePercent => onPatch({ festivalSurchargePercent })}
            />
            <Field
              label="Season starts"
              tip="First calendar month of the festival season."
            >
              <select
                className="settings-bluedart__select"
                value={surfaceRates.festivalSeasonStartMonth}
                onChange={e => onPatch({
                  festivalSeasonStartMonth: Number(e.target.value),
                })}
              >
                {MONTH_OPTIONS.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Season ends"
              tip="Last calendar month of the festival season (inclusive)."
            >
              <select
                className="settings-bluedart__select"
                value={surfaceRates.festivalSeasonEndMonth}
                onChange={e => onPatch({
                  festivalSeasonEndMonth: Number(e.target.value),
                })}
              >
                {MONTH_OPTIONS.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : null}

      <div className="settings-bluedart__subhead">Base rate by destination zone</div>
      <p className="settings-bluedart__panel-blurb">
        Zone comes from ship-from SOUTH (Kerala) × destination state.
      </p>
      <div className="settings-courier-rates__zone-table-wrap">
        <table className="settings-courier-rates__zone-table settings-bluedart__zone-table">
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Destination states</th>
              <th scope="col">
                ₹ / kg
                <span className="settings-courier-rates__th-sub">Base</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {BLUE_DART_AIR_ZONES.map((z: BlueDartAirZone) => {
              const states = statesByZone[z];
              return (
                <tr key={z}>
                  <th scope="row">Zone {z}</th>
                  <td className="settings-bluedart__zone-states">
                    {states.length > 0 ? states.join(', ') : '—'}
                  </td>
                  <td>
                    <DecimalAmountInput
                      min={0}
                      decimals={2}
                      value={rates.perKgInr[z]}
                      aria-label={`Zone ${z} rupees per kg`}
                      onChange={next => {
                        if (next == null) return;
                        onPatch({ perKgInr: { ...rates.perKgInr, [z]: next } });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const BlueDartRatesEditor: React.FC<Props> = ({
  config,
  service,
  onServiceChange,
  onChange,
}) => {
  const shared = config.shared;
  const [tab, setTab] = useState<BlueDartServiceId>(service);

  const patchShared = (patch: Partial<BlueDartConfig['shared']>) => {
    onChange({ ...config, shared: { ...shared, ...patch } });
  };

  const patchKg = (
    svc: 'air' | 'surface',
    patch: Partial<BlueDartKgServiceRates> | Partial<BlueDartSurfaceRates>,
  ) => {
    onChange({ ...config, [svc]: { ...config[svc], ...patch } });
  };

  const patchDp = (patch: Partial<BlueDartConfig['domestic_priority']>) => {
    onChange({
      ...config,
      domestic_priority: { ...config.domestic_priority, ...patch },
    });
  };

  const selectTab = (next: BlueDartServiceId) => {
    setTab(next);
    onServiceChange(next);
  };

  const sharedEditor = (
    <SharedChargesEditor
      shared={shared}
      forService={tab}
      onPatch={patchShared}
    />
  );

  return (
    <div className="settings-bluedart">
      <p className="settings-bluedart__intro">
        Quotes use the dealer’s shipping <strong>pincode + state</strong>.
        Open Air, Surface, or Domestic Priority to edit that service’s rates and the charges that apply to all of them.
      </p>

      <div
        className="settings-bluedart__tabs"
        role="tablist"
        aria-label="Blue Dart settings"
      >
        {TABS.map(item => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`settings-bluedart__tab${selected ? ' is-selected' : ''}`}
              onClick={() => selectTab(item.id)}
            >
              <img
                className="settings-bluedart__tab-img"
                src={item.image}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
              />
              <span className="settings-bluedart__tab-copy">
                <span className="settings-bluedart__tab-label">{item.label}</span>
                <span className="settings-bluedart__tab-sku">{item.sku}</span>
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'air' || tab === 'surface' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          {sharedEditor}
          <KgServiceEditor
            service={tab}
            rates={config[tab]}
            shared={shared}
            onPatch={patch => patchKg(tab, patch)}
          />
        </div>
      ) : null}

      {tab === 'domestic_priority' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          {sharedEditor}
          <p className="settings-bluedart__panel-blurb">
            {SERVICE_BLURB.domestic_priority}
            {' '}
            (
            {BLUE_DART_SERVICE_META.domestic_priority.sku}
            )
          </p>
          <div className="settings-bluedart__subhead">Domestic Priority rules</div>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
            <Field
              label="Volumetric divisor"
              tip="Volumetric kg = L × B × H ÷ divisor (sheet uses 5000)."
            >
              <DecimalAmountInput
                min={1}
                decimals={0}
                value={config.domestic_priority.volumetricDivisor}
                onChange={next => {
                  if (next == null) return;
                  patchDp({ volumetricDivisor: next });
                }}
              />
            </Field>
            <PctInput
              label="IDC"
              tip="Infrastructure Development Charge."
              value={config.domestic_priority.idcPercent}
              onChange={idcPercent => patchDp({ idcPercent })}
            />
            <PctInput
              label="EFSS"
              tip="Elevated Freight Stability Surcharge."
              value={config.domestic_priority.efssPercent}
              onChange={efssPercent => patchDp({ efssPercent })}
            />
            <PctInput
              label="PSS"
              tip="Peak Season Surcharge."
              value={config.domestic_priority.pssPercent}
              onChange={pssPercent => patchDp({ pssPercent })}
            />
          </div>
          <div className="settings-bluedart__subhead">500 g price slabs</div>
          <div className="settings-courier-rates__zone-table-wrap">
            <table className="settings-courier-rates__zone-table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">First 500 g ₹</th>
                  <th scope="col">Each addl 500 g ₹</th>
                </tr>
              </thead>
              <tbody>
                {BLUE_DART_DP_ZONES.map((z: BlueDartDpZone) => (
                  <tr key={z}>
                    <th scope="row">
                      {z === 'A1' ? 'A1 · Within Kerala' : z}
                    </th>
                    <td>
                      <DecimalAmountInput
                        min={0}
                        decimals={2}
                        value={config.domestic_priority.first500gInr[z]}
                        onChange={next => {
                          if (next == null) return;
                          patchDp({
                            first500gInr: {
                              ...config.domestic_priority.first500gInr,
                              [z]: next,
                            },
                          });
                        }}
                      />
                    </td>
                    <td>
                      <DecimalAmountInput
                        min={0}
                        decimals={2}
                        value={config.domestic_priority.addl500gInr[z]}
                        onChange={next => {
                          if (next == null) return;
                          patchDp({
                            addl500gInr: {
                              ...config.domestic_priority.addl500gInr,
                              [z]: next,
                            },
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {config.source?.importedAt ? (
        <p className="settings-bluedart__seed-note text-muted text-sm">
          Tariff seeded
          {config.source.bandLabel ? ` · ${config.source.bandLabel}` : ''}
          {' · '}
          {new Date(config.source.importedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
};
