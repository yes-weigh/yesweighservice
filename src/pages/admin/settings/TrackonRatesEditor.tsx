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
  TrackonDestinationId,
  TrackonNorthDestinationId,
  TrackonSouthDestinationId,
  TrackonSurfaceNorthDestinationId,
} from '../../../types/trackon-rates';
import {
  TRACKON_DESTINATION_LABELS,
  TRACKON_NORTH_DESTINATION_IDS,
  TRACKON_SOUTH_DESTINATION_IDS,
  TRACKON_SURFACE_NORTH_DESTINATION_IDS,
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

const TABS: Array<{ id: TrackonServiceId; label: string; sku: string; image: string }> = [
  { id: 'air', label: 'Air', sku: TRACKON_SERVICE_META.air.sku, image: '/logistics/trackon-air.webp' },
  {
    id: 'surface',
    label: 'Surface',
    sku: TRACKON_SERVICE_META.surface.sku,
    image: '/logistics/trackon-surface.webp',
  },
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

/** Group stations that share the same ₹/kg so the editor stays compact. */
function groupStationsByPerKg<T extends TrackonDestinationId>(
  ids: readonly T[],
  getPerKg: (id: T) => number,
): Array<{ ids: T[]; label: string; perKgInr: number }> {
  const groups: Array<{ ids: T[]; perKgInr: number }> = [];
  for (const id of ids) {
    const perKgInr = getPerKg(id);
    const existing = groups.find(g => g.perKgInr === perKgInr);
    if (existing) existing.ids.push(id);
    else groups.push({ ids: [id], perKgInr });
  }
  return groups.map(g => ({
    ...g,
    label: g.ids.map(id => TRACKON_DESTINATION_LABELS[id]).join(', '),
  }));
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

  const patchNorthSurfaceGroup = (
    ids: TrackonSurfaceNorthDestinationId[],
    perKgInr: number,
  ) => {
    const northern = { ...config.surface.northern };
    for (const id of ids) northern[id] = { perKgInr };
    onChange({
      ...config,
      surface: { ...config.surface, northern },
    });
  };

  const patchSouthSurfaceGroup = (
    ids: TrackonSouthDestinationId[],
    perKgInr: number,
  ) => {
    const southern = { ...config.surface.southern };
    for (const id of ids) southern[id] = { perKgInr };
    onChange({
      ...config,
      surface: { ...config.surface, southern },
    });
  };

  const northSurfaceGroups = groupStationsByPerKg(
    TRACKON_SURFACE_NORTH_DESTINATION_IDS,
    id => config.surface.northern[id].perKgInr,
  );
  const southSurfaceGroups = groupStationsByPerKg(
    TRACKON_SOUTH_DESTINATION_IDS,
    id => config.surface.southern[id].perKgInr,
  );

  return (
    <div className="settings-bluedart">
      <div
        className="settings-bluedart__tabs settings-bluedart__tabs--duo"
        role="tablist"
        aria-label="Trackon service"
      >
        {TABS.map(tab => {
          const selected = service === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`settings-bluedart__tab${selected ? ' is-selected' : ''}`}
              onClick={() => onServiceChange(tab.id)}
            >
              <img
                className="settings-bluedart__tab-img settings-bluedart__tab-img--plain"
                src={tab.image}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
              />
              <span className="settings-bluedart__tab-copy">
                <span className="settings-bluedart__tab-label">{tab.label}</span>
                <span className="settings-bluedart__tab-sku">{tab.sku}</span>
              </span>
            </button>
          );
        })}
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
              <Field label="Minimum kg" tip="Surface bills ₹/kg with this floor (sheet: 4 kg)">
                <DecimalAmountInput
                  min={0}
                  decimals={0}
                  value={config.shared.minimumChargeableKg}
                  aria-label="Minimum chargeable kg"
                  onChange={next => {
                    if (next == null) return;
                    patchShared({ minimumChargeableKg: next });
                  }}
                />
              </Field>
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
                  {northSurfaceGroups.map(group => (
                    <tr key={group.ids.join('|')}>
                      <th scope="row">{group.label}</th>
                      <td>
                        <CellInr
                          label={`${group.label} per kg`}
                          value={group.perKgInr}
                          onChange={perKgInr => patchNorthSurfaceGroup(group.ids, perKgInr)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

          <fieldset className="settings-courier-rates__card">
            <legend>Surface — southern ₹/kg</legend>
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
                  {southSurfaceGroups.map(group => (
                    <tr key={group.ids.join('|')}>
                      <th scope="row">{group.label}</th>
                      <td>
                        <CellInr
                          label={`${group.label} per kg`}
                          value={group.perKgInr}
                          onChange={perKgInr => patchSouthSurfaceGroup(group.ids, perKgInr)}
                        />
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
