import React from 'react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import {
  BLUE_DART_AIR_ZONES,
  BLUE_DART_DP_ZONES,
  BLUE_DART_EDL_MODES,
  BLUE_DART_REGIONS,
  type BlueDartAirZone,
  type BlueDartConfig,
  type BlueDartDpZone,
  type BlueDartEdlMode,
  type BlueDartKgServiceRates,
  type BlueDartRegion,
} from '../../../types/blue-dart-rates';
import {
  BLUE_DART_SERVICE_IDS,
  BLUE_DART_SERVICE_META,
  type BlueDartServiceId,
} from '../../../types/logistics-courier-rates';

type Props = {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  onServiceChange: (service: BlueDartServiceId) => void;
  onChange: (next: BlueDartConfig) => void;
};

function Field(props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-courier-rates__field settings-courier-rates__field--plain">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <em className="settings-bluedart__hint">{props.hint}</em> : null}
    </label>
  );
}

function PctInput(props: {
  label: string;
  value: number;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
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
  value: number;
  hint?: string;
  decimals?: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
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

export const BlueDartRatesEditor: React.FC<Props> = ({
  config,
  service,
  onServiceChange,
  onChange,
}) => {
  const shared = config.shared;

  const patchShared = (patch: Partial<BlueDartConfig['shared']>) => {
    onChange({ ...config, shared: { ...shared, ...patch } });
  };

  const patchKg = (svc: 'air' | 'surface', patch: Partial<BlueDartKgServiceRates>) => {
    onChange({ ...config, [svc]: { ...config[svc], ...patch } });
  };

  const patchDp = (patch: Partial<BlueDartConfig['domestic_priority']>) => {
    onChange({
      ...config,
      domestic_priority: { ...config.domestic_priority, ...patch },
    });
  };

  const kgService = service === 'air' || service === 'surface' ? service : null;
  const kgRates = kgService ? config[kgService] : null;

  return (
    <div className="settings-bluedart">
      <div className="settings-courier-rates__level">
        <span className="settings-courier-rates__level-label">Blue Dart service</span>
        <div
          className="settings-courier-rates__service-grid"
          role="tablist"
          aria-label="Blue Dart service"
        >
          {BLUE_DART_SERVICE_IDS.map(serviceId => {
            const meta = BLUE_DART_SERVICE_META[serviceId];
            const selected = service === serviceId;
            return (
              <button
                key={serviceId}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`settings-courier-rates__service-card${selected ? ' is-selected' : ''}`}
                onClick={() => onServiceChange(serviceId)}
              >
                <span className="settings-courier-rates__service-name">{meta.label}</span>
                <span className="settings-courier-rates__service-sku">{meta.sku}</span>
                <span className="settings-courier-rates__service-tagline">{meta.tagline}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="settings-courier-rates__shared-note text-muted text-sm">
        One tariff for all ship-from sites (origin region defaults to SOUTH / Kerala).
        Quotes use shipping address pin + state.
      </p>

      <fieldset className="settings-courier-rates__card">
        <legend>Shared surcharges &amp; gaps</legend>
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <PctInput
            label="Fuel surcharge"
            value={shared.fuelSurchargePercent}
            hint="Absolute % (ops enter resulting FS after mechanism ± adjustments)"
            onChange={fuelSurchargePercent => patchShared({ fuelSurchargePercent })}
          />
          <PctInput
            label="CAF"
            value={shared.cafPercent}
            onChange={cafPercent => patchShared({ cafPercent })}
          />
          <PctInput
            label="GST"
            value={shared.gstPercent}
            onChange={gstPercent => patchShared({ gstPercent })}
          />
          <InrInput
            label="RAS ₹/kg"
            value={shared.rasPerKgInr}
            hint="Bihar, Jharkhand, Kerala, J&K, Ladakh"
            onChange={rasPerKgInr => patchShared({ rasPerKgInr })}
          />
          <InrInput
            label="FOV min"
            value={shared.fov.minInr}
            onChange={minInr => patchShared({ fov: { ...shared.fov, minInr } })}
          />
          <PctInput
            label="FOV % of invoice"
            value={shared.fov.percentOfInvoice}
            hint="e.g. 0.05 = 0.05%"
            onChange={percentOfInvoice => patchShared({
              fov: { ...shared.fov, percentOfInvoice },
            })}
          />
        </div>

        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <Field label="Origin region">
            <select
              className="settings-bluedart__select"
              value={shared.originRegion}
              onChange={e => patchShared({ originRegion: e.target.value as BlueDartRegion })}
            >
              {BLUE_DART_REGIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field
            label="EDL mode"
            hint="flat_fallback uses the ₹ below when pin is EDL and hub-km is unknown"
          >
            <select
              className="settings-bluedart__select"
              value={shared.edlMode}
              onChange={e => patchShared({ edlMode: e.target.value as BlueDartEdlMode })}
            >
              {BLUE_DART_EDL_MODES.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <InrInput
            label="EDL flat fallback"
            value={shared.edlFlatFallbackInr}
            hint="Closes hub-distance gap for EDL pins"
            onChange={edlFlatFallbackInr => patchShared({ edlFlatFallbackInr })}
          />
          <InrInput
            label="EDL NE/J&K ₹/kg"
            value={shared.edlNeJkPerKgInr}
            onChange={edlNeJkPerKgInr => patchShared({ edlNeJkPerKgInr })}
          />
          <InrInput
            label="EDL NE/J&K floor"
            value={shared.edlNeJkFloorInr}
            onChange={edlNeJkFloorInr => patchShared({ edlNeJkFloorInr })}
          />
          <InrInput
            label="EDL >500 km ₹/km"
            value={shared.edlBeyond500KmPerKmInr}
            onChange={edlBeyond500KmPerKmInr => patchShared({ edlBeyond500KmPerKmInr })}
          />
          <InrInput
            label="EDL >1500 kg ₹/kg"
            value={shared.edlBeyond1500KgPerKgInr}
            onChange={edlBeyond1500KgPerKgInr => patchShared({ edlBeyond1500KgPerKgInr })}
          />
          <label className="settings-courier-rates__toggle">
            <input
              type="checkbox"
              checked={shared.hideTemPer}
              onChange={e => patchShared({ hideTemPer: e.target.checked })}
            />
            <span>
              Hide TEM / PER pins
              <em>Treat temporary/permanent exclusions as not serviceable</em>
            </span>
          </label>
        </div>

        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <Field label="Zoho product ID · Air (BDAIR)">
            <input
              className="settings-bluedart__text"
              value={shared.productIds.air}
              onChange={e => patchShared({
                productIds: { ...shared.productIds, air: e.target.value.trim() },
              })}
            />
          </Field>
          <Field label="Zoho product ID · Surface (BDFRC)">
            <input
              className="settings-bluedart__text"
              value={shared.productIds.surface}
              onChange={e => patchShared({
                productIds: { ...shared.productIds, surface: e.target.value.trim() },
              })}
            />
          </Field>
          <Field label="Zoho product ID · Domestic Priority (BDDP)">
            <input
              className="settings-bluedart__text"
              value={shared.productIds.domestic_priority}
              onChange={e => patchShared({
                productIds: {
                  ...shared.productIds,
                  domestic_priority: e.target.value.trim(),
                },
              })}
            />
          </Field>
        </div>
      </fieldset>

      {kgRates ? (
        <fieldset className="settings-courier-rates__card settings-courier-rates__zone-card">
          <legend>
            {BLUE_DART_SERVICE_META[service].label}
            {' '}
            (
            {BLUE_DART_SERVICE_META[service].sku}
            )
            {' '}
            · Zones 1–5
          </legend>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
            <Field label="Min weight (kg)">
              <DecimalAmountInput
                min={0}
                decimals={1}
                value={kgRates.minimumChargeableWeightKg}
                onChange={next => {
                  if (next == null || !kgService) return;
                  patchKg(kgService, { minimumChargeableWeightKg: next });
                }}
              />
            </Field>
            <InrInput
              label="Min freight"
              value={kgRates.minimumFreightInr}
              onChange={minimumFreightInr => {
                if (!kgService) return;
                patchKg(kgService, { minimumFreightInr });
              }}
            />
            <InrInput
              label="Docket fee"
              value={kgRates.docketFeeInr}
              onChange={docketFeeInr => {
                if (!kgService) return;
                patchKg(kgService, { docketFeeInr });
              }}
            />
            <Field label="Volumetric divisor">
              <DecimalAmountInput
                min={1}
                decimals={0}
                value={kgRates.volumetricDivisor}
                onChange={next => {
                  if (next == null || !kgService) return;
                  patchKg(kgService, { volumetricDivisor: next });
                }}
              />
            </Field>
            <PctInput
              label="IDC %"
              value={kgRates.idcPercent}
              onChange={idcPercent => {
                if (!kgService) return;
                patchKg(kgService, { idcPercent });
              }}
            />
            <PctInput
              label="EFSS %"
              value={kgRates.efssPercent}
              onChange={efssPercent => {
                if (!kgService) return;
                patchKg(kgService, { efssPercent });
              }}
            />
            <PctInput
              label="PSS %"
              value={kgRates.pssPercent}
              onChange={pssPercent => {
                if (!kgService) return;
                patchKg(kgService, { pssPercent });
              }}
            />
          </div>
          <div className="settings-courier-rates__zone-table-wrap">
            <table className="settings-courier-rates__zone-table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">
                    ₹ / kg
                    <span className="settings-courier-rates__th-sub">Base</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {BLUE_DART_AIR_ZONES.map((z: BlueDartAirZone) => (
                  <tr key={z}>
                    <th scope="row">Zone {z}</th>
                    <td>
                      <DecimalAmountInput
                        min={0}
                        decimals={2}
                        value={kgRates.perKgInr[z]}
                        aria-label={`Zone ${z} rupees per kg`}
                        onChange={next => {
                          if (next == null || !kgService) return;
                          patchKg(kgService, {
                            perKgInr: { ...kgRates.perKgInr, [z]: next },
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      ) : (
        <fieldset className="settings-courier-rates__card settings-courier-rates__zone-card">
          <legend>
            Domestic Priority (BDDP) · 500g slabs
          </legend>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
            <Field label="Volumetric divisor" hint="LBH / divisor">
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
              label="IDC %"
              value={config.domestic_priority.idcPercent}
              onChange={idcPercent => patchDp({ idcPercent })}
            />
            <PctInput
              label="EFSS %"
              value={config.domestic_priority.efssPercent}
              onChange={efssPercent => patchDp({ efssPercent })}
            />
            <PctInput
              label="PSS %"
              value={config.domestic_priority.pssPercent}
              onChange={pssPercent => patchDp({ pssPercent })}
            />
          </div>
          <div className="settings-courier-rates__zone-table-wrap">
            <table className="settings-courier-rates__zone-table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">First 500g ₹</th>
                  <th scope="col">Addl 500g ₹</th>
                </tr>
              </thead>
              <tbody>
                {BLUE_DART_DP_ZONES.map((z: BlueDartDpZone) => (
                  <tr key={z}>
                    <th scope="row">{z === 'A1' ? 'A1 (Within Kerala)' : z}</th>
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
        </fieldset>
      )}

      {config.source?.importedAt ? (
        <p className="text-muted text-sm">
          Seeded
          {config.source.bandLabel ? ` · ${config.source.bandLabel}` : ''}
          {' · '}
          {new Date(config.source.importedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
};
