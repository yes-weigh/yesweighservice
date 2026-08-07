/**
 * Super-admin Trackon tariff editor (Settings → Delivery Partners → Trackon).
 * Live-saves appSettings/logisticsCourierRates.trackon via saveTrackonConfig.
 * Tabs: Air | Surface. Seeded from Phoenix Cargo Cochin quotation (Feb 2026).
 */
import React from 'react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import type { LogisticsPartnerStatus } from '../../../types/logistics-partner-status';
import type {
  TrackonConfig,
  TrackonNorthDestinationId,
  TrackonSouthDestinationId,
} from '../../../types/trackon-rates';
import {
  TRACKON_DESTINATION_LABELS,
  TRACKON_NORTH_DESTINATION_IDS,
  TRACKON_SOUTH_DESTINATION_IDS,
} from '../../../types/trackon-rates';
import {
  TRACKON_SERVICE_META,
  type TrackonServiceId,
} from '../../../types/logistics-courier-rates';
import { PartnerStatusControl } from './PartnerStatusControl';

type Props = {
  config: TrackonConfig;
  service: TrackonServiceId;
  onServiceChange: (service: TrackonServiceId) => void;
  onChange: (next: TrackonConfig) => void;
  serviceStatuses: Record<TrackonServiceId, LogisticsPartnerStatus>;
  onServiceStatusChange: (
    service: TrackonServiceId,
    next: LogisticsPartnerStatus,
  ) => void;
};

const TABS: Array<{ id: TrackonServiceId; label: string; sku: string }> = [
  { id: 'air', label: 'Air', sku: TRACKON_SERVICE_META.air.sku },
  { id: 'surface', label: 'Surface', sku: TRACKON_SERVICE_META.surface.sku },
];

function Field(props: {
  label: string;
  tip?: string;
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
    </label>
  );
}

function InrInput(props: {
  label: string;
  tip?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={props.label} tip={props.tip}>
      <div className="settings-courier-rates__suffix-input">
        <span aria-hidden>₹</span>
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
      </div>
    </Field>
  );
}

function PctInput(props: {
  label: string;
  tip?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={props.label} tip={props.tip}>
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

function CellInr(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      <span className="sr-only">{props.label}</span>
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
    </label>
  );
}

export const TrackonRatesEditor: React.FC<Props> = ({
  config,
  service,
  onServiceChange,
  onChange,
  serviceStatuses,
  onServiceStatusChange,
}) => {
  const patchShared = (patch: Partial<TrackonConfig['shared']>) => {
    onChange({ ...config, shared: { ...config.shared, ...patch } });
  };

  const patchAirDest = (
    id: TrackonNorthDestinationId,
    patch: Partial<TrackonConfig['air']['destinations'][TrackonNorthDestinationId]>,
  ) => {
    onChange({
      ...config,
      air: {
        destinations: {
          ...config.air.destinations,
          [id]: { ...config.air.destinations[id], ...patch },
        },
      },
    });
  };

  const patchNorthSurface = (
    id: TrackonNorthDestinationId,
    perKgInr: number,
  ) => {
    onChange({
      ...config,
      surface: {
        ...config.surface,
        northern: {
          ...config.surface.northern,
          [id]: { perKgInr },
        },
      },
    });
  };

  const patchSouthSurface = (
    id: TrackonSouthDestinationId,
    patch: Partial<TrackonConfig['surface']['southern'][TrackonSouthDestinationId]>,
  ) => {
    onChange({
      ...config,
      surface: {
        ...config.surface,
        southern: {
          ...config.surface.southern,
          [id]: { ...config.surface.southern[id], ...patch },
        },
      },
    });
  };

  return (
    <div className="settings-bluedart">
      <div className="settings-bluedart__tabs" role="tablist" aria-label="Trackon service">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={service === tab.id}
            className={`settings-bluedart__tab${service === tab.id ? ' is-selected' : ''}`}
            onClick={() => onServiceChange(tab.id)}
          >
            <img src="/logistics/trackon.png" alt="" width={28} height={28} />
            <span>
              <strong>{tab.label}</strong>
              <em>{tab.sku}</em>
            </span>
          </button>
        ))}
      </div>

      <PartnerStatusControl
        status={serviceStatuses[service]}
        ariaLabel={`Status for Trackon ${TRACKON_SERVICE_META[service].label}`}
        onChange={next => onServiceStatusChange(service, next)}
      />

      {config.source ? (
        <p className="settings-courier-rates__shared-note text-muted text-sm">
          Source: {config.source.label}
          {config.source.dated ? ` · ${config.source.dated}` : ''}
        </p>
      ) : null}

      <div className="settings-courier-rates__grid settings-courier-rates__grid--meta">
        <fieldset className="settings-courier-rates__card">
          <legend>Shared rules</legend>
          <div className="settings-bluedart__fields">
            <PctInput
              label="Fuel surcharge"
              tip="Sheet T&C §13 — 15%"
              value={config.shared.fuelSurchargePercent}
              onChange={fuelSurchargePercent => patchShared({ fuelSurchargePercent })}
            />
            <Field label="Volumetric divisor" tip="(L × B × H) / divisor">
              <DecimalAmountInput
                min={1}
                decimals={0}
                value={config.shared.volumetricDivisor}
                aria-label="Volumetric divisor"
                onChange={next => {
                  if (next == null) return;
                  patchShared({ volumetricDivisor: next });
                }}
              />
            </Field>
            <Field label="Oversized side (cm)" tip="Any side above this doubles volumetric weight">
              <DecimalAmountInput
                min={1}
                decimals={0}
                value={config.shared.oversizedSideCm}
                aria-label="Oversized side (cm)"
                onChange={next => {
                  if (next == null) return;
                  patchShared({ oversizedSideCm: next });
                }}
              />
            </Field>
            {service === 'surface' ? (
              <>
                <InrInput
                  label="North min kg"
                  tip="Minimum chargeable kg for northern surface ₹/kg"
                  value={config.shared.northernMinimumChargeableKg}
                  onChange={northernMinimumChargeableKg => patchShared({ northernMinimumChargeableKg })}
                />
                <InrInput
                  label="South bulk min kg"
                  tip="Sheet: minimum payload 4 kg for bulk"
                  value={config.shared.southernBulkMinimumKg}
                  onChange={southernBulkMinimumKg => patchShared({ southernBulkMinimumKg })}
                />
              </>
            ) : null}
          </div>
        </fieldset>
      </div>

      {service === 'air' ? (
        <fieldset className="settings-courier-rates__card">
          <legend>Air slabs (northern stations)</legend>
          <p className="settings-courier-rates__zone-hint text-muted text-sm">
            Flat ₹ up to 1 kg. Above 1 kg adds ₹ per each 500 g (or part).
          </p>
          <div className="settings-courier-rates__zone-table-wrap">
            <table className="settings-courier-rates__zone-table">
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">
                    Upto 1 kg
                    <span className="settings-courier-rates__th-sub">₹ flat</span>
                  </th>
                  <th scope="col">
                    Above 1 kg
                    <span className="settings-courier-rates__th-sub">₹ / 500 g</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {TRACKON_NORTH_DESTINATION_IDS.map(id => {
                  const row = config.air.destinations[id];
                  const label = TRACKON_DESTINATION_LABELS[id];
                  return (
                    <tr key={id}>
                      <th scope="row">{label}</th>
                      <td>
                        <CellInr
                          label={`${label} upto 1 kg`}
                          value={row.upTo1000gInr}
                          onChange={upTo1000gInr => patchAirDest(id, { upTo1000gInr })}
                        />
                      </td>
                      <td>
                        <CellInr
                          label={`${label} above 1 kg per 500 g`}
                          value={row.additionalPer500gInr}
                          onChange={additionalPer500gInr => patchAirDest(id, { additionalPer500gInr })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>
      ) : (
        <>
          <fieldset className="settings-courier-rates__card">
            <legend>Surface — northern ₹/kg</legend>
            <div className="settings-courier-rates__zone-table-wrap">
              <table className="settings-courier-rates__zone-table">
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col">
                      Per kg
                      <span className="settings-courier-rates__th-sub">₹</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKON_NORTH_DESTINATION_IDS.map(id => {
                    const label = TRACKON_DESTINATION_LABELS[id];
                    return (
                      <tr key={id}>
                        <th scope="row">{label}</th>
                        <td>
                          <CellInr
                            label={`${label} per kg`}
                            value={config.surface.northern[id].perKgInr}
                            onChange={perKgInr => patchNorthSurface(id, perKgInr)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>

          <fieldset className="settings-courier-rates__card">
            <legend>Surface — southern slabs + bulk</legend>
            <p className="settings-courier-rates__zone-hint text-muted text-sm">
              ≤ 1 kg uses slabs; above 1 kg bills bulk ₹/kg with the bulk minimum payload.
            </p>
            <div className="settings-courier-rates__zone-table-wrap">
              <table className="settings-courier-rates__zone-table">
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col">
                      ≤ 250 g
                      <span className="settings-courier-rates__th-sub">₹</span>
                    </th>
                    <th scope="col">
                      251–500 g
                      <span className="settings-courier-rates__th-sub">₹</span>
                    </th>
                    <th scope="col">
                      501–1000 g
                      <span className="settings-courier-rates__th-sub">₹</span>
                    </th>
                    <th scope="col">
                      Bulk / kg
                      <span className="settings-courier-rates__th-sub">min payload</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKON_SOUTH_DESTINATION_IDS.map(id => {
                    const row = config.surface.southern[id];
                    const label = TRACKON_DESTINATION_LABELS[id];
                    return (
                      <tr key={id}>
                        <th scope="row">{label}</th>
                        <td>
                          <CellInr
                            label={`${label} ≤ 250 g`}
                            value={row.upTo250gInr}
                            onChange={upTo250gInr => patchSouthSurface(id, { upTo250gInr })}
                          />
                        </td>
                        <td>
                          <CellInr
                            label={`${label} 251–500 g`}
                            value={row.upTo500gInr}
                            onChange={upTo500gInr => patchSouthSurface(id, { upTo500gInr })}
                          />
                        </td>
                        <td>
                          <CellInr
                            label={`${label} 501–1000 g`}
                            value={row.upTo1000gInr}
                            onChange={upTo1000gInr => patchSouthSurface(id, { upTo1000gInr })}
                          />
                        </td>
                        <td>
                          <CellInr
                            label={`${label} bulk / kg`}
                            value={row.bulkPerKgInr}
                            onChange={bulkPerKgInr => patchSouthSurface(id, { bulkPerKgInr })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
};
