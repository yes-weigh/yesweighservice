/**
 * Super-admin Blue Dart tariff editor (Settings → Delivery Partners → Blue Dart).
 * Live-saves `appSettings/logisticsCourierRates.bluedart` via saveBlueDartConfig.
 * Tabs: Shared charges | Air | Surface | Domestic Priority.
 * Does NOT edit blueDartPincodes or zone/EDL matrices (re-seed those from Excel).
 * Zoho product IDs are hardcoded in freightLines.ts — intentionally not shown here.
 * Full architecture notes: src/types/blue-dart-rates.ts
 */
import React, { useMemo, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import {
  acknowledgeBlueDartSetup,
  blueDartFieldNeedsVerifyNote,
  listOpenBlueDartSetupTasks,
  type BlueDartSetupAckKey,
} from '../../../lib/blueDartSetup';
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
  BLUE_DART_SERVICE_META,
  type BlueDartServiceId,
} from '../../../types/logistics-courier-rates';

type Props = {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  onServiceChange: (service: BlueDartServiceId) => void;
  onChange: (next: BlueDartConfig) => void;
};

type BlueDartTab = 'shared' | BlueDartServiceId;

const TABS: Array<{ id: BlueDartTab; label: string; sku?: string }> = [
  { id: 'shared', label: 'Shared charges' },
  { id: 'air', label: 'Air', sku: 'BDAIR' },
  { id: 'surface', label: 'Surface', sku: 'BDFRC' },
  { id: 'domestic_priority', label: 'Domestic Priority', sku: 'BDDP' },
];

const SERVICE_BLURB: Record<BlueDartServiceId, string> = {
  air: 'Express air (Apex). Billed by Zone 1–5 ₹/kg, usually min 10 kg.',
  surface: 'Ground / Surface Band 13. Billed by Zone 1–5 ₹/kg, usually min 10 kg.',
  domestic_priority: 'Priority parcels. Billed in 500 g slabs (Within Kerala A1, then A/B/C).',
};

function VerifyNote(props: {
  note: string;
  keepLabel?: string;
  onKeep: () => void;
}) {
  return (
    <div className="settings-bluedart__verify-note">
      <p>{props.note}</p>
      <button type="button" onClick={props.onKeep}>
        {props.keepLabel ?? 'Keep as is'}
      </button>
    </div>
  );
}

function Field(props: {
  label: string;
  tip?: string;
  hint?: string;
  verifyNote?: string | null;
  keepLabel?: string;
  onKeepDefault?: () => void;
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
      {props.verifyNote && props.onKeepDefault ? (
        <VerifyNote
          note={props.verifyNote}
          keepLabel={props.keepLabel}
          onKeep={props.onKeepDefault}
        />
      ) : null}
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
  verifyNote?: string | null;
  keepLabel?: string;
  onKeepDefault?: () => void;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={props.label}
      tip={props.tip}
      hint={props.hint}
      verifyNote={props.verifyNote}
      keepLabel={props.keepLabel}
      onKeepDefault={props.onKeepDefault}
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
  verifyNote?: string | null;
  keepLabel?: string;
  onKeepDefault?: () => void;
  onChange: (n: number) => void;
}) {
  return (
    <Field
      label={props.label}
      tip={props.tip}
      hint={props.hint}
      verifyNote={props.verifyNote}
      keepLabel={props.keepLabel}
      onKeepDefault={props.onKeepDefault}
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

function KgServiceEditor(props: {
  service: 'air' | 'surface';
  rates: BlueDartKgServiceRates;
  onPatch: (patch: Partial<BlueDartKgServiceRates>) => void;
  verifyNote?: string | null;
  onKeepDefault?: () => void;
}) {
  const { rates, onPatch, service } = props;
  return (
    <div className="settings-bluedart__tab-panel">
      <p className="settings-bluedart__panel-blurb">{SERVICE_BLURB[service]}</p>
      {props.verifyNote && props.onKeepDefault ? (
        <VerifyNote
          note={props.verifyNote}
          keepLabel="Rates look correct"
          onKeep={props.onKeepDefault}
        />
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
          tip="Elevated Freight Stability Surcharge — % after CAF."
          value={rates.efssPercent}
          onChange={efssPercent => onPatch({ efssPercent })}
        />
        <PctInput
          label="PSS"
          tip="Peak Season Surcharge — % on base freight."
          value={rates.pssPercent}
          onChange={pssPercent => onPatch({ pssPercent })}
        />
      </div>

      <div className="settings-bluedart__subhead">Base rate by destination zone</div>
      <p className="settings-bluedart__panel-blurb">
        Zone comes from origin region × destination state (your origin is usually SOUTH / Kerala).
      </p>
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
                    value={rates.perKgInr[z]}
                    aria-label={`Zone ${z} rupees per kg`}
                    onChange={next => {
                      if (next == null) return;
                      onPatch({ perKgInr: { ...rates.perKgInr, [z]: next } });
                    }}
                  />
                </td>
              </tr>
            ))}
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
  const [tab, setTab] = useState<BlueDartTab>('shared');
  const [showAdvancedEdl, setShowAdvancedEdl] = useState(
    shared.edlMode === 'matrix_when_km' || shared.edlFlatFallbackInr > 0,
  );

  const openTasks = useMemo(() => listOpenBlueDartSetupTasks(config), [config]);
  const openByKey = useMemo(() => {
    const map = new Map(openTasks.map(task => [task.key, task]));
    return map;
  }, [openTasks]);

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

  const ack = (key: BlueDartSetupAckKey) => {
    onChange(acknowledgeBlueDartSetup(config, key));
  };

  const verifyNoteFor = (key: BlueDartSetupAckKey): string | null => {
    if (!blueDartFieldNeedsVerifyNote(config, key)) return null;
    return openByKey.get(key)?.detail ?? null;
  };

  const selectTab = (next: BlueDartTab) => {
    setTab(next);
    if (next !== 'shared') onServiceChange(next);
  };

  return (
    <div className="settings-bluedart">
      <p className="settings-bluedart__intro">
        Quotes use the dealer’s shipping <strong>pincode + state</strong>.
        Shared charges apply to every service; open Air, Surface, or Domestic Priority to edit that price table.
      </p>

      {openTasks.length > 0 ? (
        <div className="settings-bluedart__checklist" role="region" aria-label="Blue Dart setup checklist">
          <div className="settings-bluedart__checklist-head">
            <CircleAlert size={16} aria-hidden />
            <div>
              <strong>Finish these so Blue Dart quotes stay accurate</strong>
              <p>
                Items leave this list when you change the value, or when you confirm a seeded default
                is intentionally kept.
              </p>
            </div>
            <span className="settings-bluedart__checklist-count">
              {openTasks.length}
              {' '}
              open
            </span>
          </div>
          <ul className="settings-bluedart__checklist-list">
            {openTasks.map(task => (
              <li key={task.key}>
                <button
                  type="button"
                  className="settings-bluedart__checklist-item"
                  onClick={() => selectTab(task.tab)}
                >
                  <span className={`settings-bluedart__checklist-kind is-${task.kind}`}>
                    {task.kind === 'gap' ? 'Needed' : 'Verify'}
                  </span>
                  <span className="settings-bluedart__checklist-copy">
                    <strong>{task.title}</strong>
                    <em>{task.detail}</em>
                  </span>
                </button>
                <button
                  type="button"
                  className="settings-bluedart__checklist-ack"
                  onClick={() => ack(task.key)}
                >
                  <Check size={14} aria-hidden />
                  {task.kind === 'gap' ? 'Keep ₹0' : 'Looks good'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="settings-bluedart__checklist settings-bluedart__checklist--done">
          <Check size={16} aria-hidden />
          <span>All Blue Dart setup checks are clear.</span>
        </div>
      )}

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
              <span className="settings-bluedart__tab-label">{item.label}</span>
              {item.sku ? (
                <span className="settings-bluedart__tab-sku">{item.sku}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === 'shared' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          <p className="settings-bluedart__panel-blurb">
            Same for Air, Surface, and Domestic Priority.
          </p>

          <div className="settings-bluedart__subhead">Everyday surcharges</div>
          <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
            <PctInput
              label="Fuel (FS)"
              tip="Fuel Surcharge — absolute % you bill (e.g. 92)."
              value={shared.fuelSurchargePercent}
              verifyNote={verifyNoteFor('shared.fuelSurchargePercent')}
              onKeepDefault={() => ack('shared.fuelSurchargePercent')}
              onChange={fuelSurchargePercent => patchShared({ fuelSurchargePercent })}
            />
            <PctInput
              label="CAF"
              tip="Currency Adjustment Factor — absolute % (e.g. 22)."
              value={shared.cafPercent}
              verifyNote={verifyNoteFor('shared.cafPercent')}
              onKeepDefault={() => ack('shared.cafPercent')}
              onChange={cafPercent => patchShared({ cafPercent })}
            />
            <PctInput
              label="GST"
              tip="Tax % on freight subtotal. Set 0 to quote exclusive of GST."
              value={shared.gstPercent}
              verifyNote={verifyNoteFor('shared.gstPercent')}
              onKeepDefault={() => ack('shared.gstPercent')}
              onChange={gstPercent => patchShared({ gstPercent })}
            />
            <InrInput
              label="Remote area (RAS)"
              tip="Remote Area Surcharge — ₹/kg for Bihar, Jharkhand, Kerala, J&K, Ladakh."
              value={shared.rasPerKgInr}
              hint="Only certain states"
              verifyNote={verifyNoteFor('shared.rasPerKgInr')}
              onKeepDefault={() => ack('shared.rasPerKgInr')}
              onChange={rasPerKgInr => patchShared({ rasPerKgInr })}
            />
            <InrInput
              label="Insurance min (FOV)"
              tip="Freight on Value — minimum insurance ₹ per AWB."
              value={shared.fov.minInr}
              verifyNote={verifyNoteFor('shared.fov')}
              onKeepDefault={() => ack('shared.fov')}
              onChange={minInr => patchShared({ fov: { ...shared.fov, minInr } })}
            />
            <PctInput
              label="Insurance % of invoice"
              tip="FOV % of invoice value. Billed as max(min, this %)."
              value={shared.fov.percentOfInvoice}
              hint="e.g. 0.05 = 0.05%"
              verifyNote={verifyNoteFor('shared.fov')}
              onKeepDefault={() => ack('shared.fov')}
              onChange={percentOfInvoice => patchShared({
                fov: { ...shared.fov, percentOfInvoice },
              })}
            />
            <Field
              label="Ship-from region"
              tip="Used with destination state to pick Zone 1–5. Keep SOUTH for Kerala warehouses."
              verifyNote={verifyNoteFor('shared.originRegion')}
              onKeepDefault={() => ack('shared.originRegion')}
            >
              <select
                className="settings-bluedart__select"
                value={shared.originRegion}
                onChange={e => patchShared({
                  originRegion: e.target.value as BlueDartRegion,
                })}
              >
                {BLUE_DART_REGIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <label className="settings-courier-rates__toggle">
              <input
                type="checkbox"
                checked={shared.hideTemPer}
                onChange={e => patchShared({ hideTemPer: e.target.checked })}
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
                onChange={e => {
                  const edlMode = e.target.value as BlueDartEdlMode;
                  patchShared({ edlMode });
                  if (edlMode === 'matrix_when_km') setShowAdvancedEdl(true);
                }}
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
              verifyNote={verifyNoteFor('shared.edlFlatFallbackInr')}
              keepLabel="Keep ₹0 intentionally"
              onKeepDefault={() => ack('shared.edlFlatFallbackInr')}
              onChange={edlFlatFallbackInr => patchShared({ edlFlatFallbackInr })}
            />
            <InrInput
              label="NE / J&K ₹ per kg"
              tip="Special EDL for North-East and J&K — vs floor, higher wins."
              value={shared.edlNeJkPerKgInr}
              onChange={edlNeJkPerKgInr => patchShared({ edlNeJkPerKgInr })}
            />
            <InrInput
              label="NE / J&K minimum ₹"
              tip="Floor for NE / J&K EDL."
              value={shared.edlNeJkFloorInr}
              onChange={edlNeJkFloorInr => patchShared({ edlNeJkFloorInr })}
            />
          </div>

          <button
            type="button"
            className="settings-bluedart__linkish"
            onClick={() => setShowAdvancedEdl(v => !v)}
          >
            {showAdvancedEdl ? 'Hide' : 'Show'}
            {' '}
            rare EDL distance rules
          </button>
          {showAdvancedEdl ? (
            <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
              <InrInput
                label="Beyond 500 km ₹/km"
                tip="Only when pin has edlKm stored."
                value={shared.edlBeyond500KmPerKmInr}
                onChange={edlBeyond500KmPerKmInr => patchShared({ edlBeyond500KmPerKmInr })}
              />
              <InrInput
                label="Beyond 1500 kg ₹/kg"
                tip="Heavy EDL shipments when distance is known."
                value={shared.edlBeyond1500KgPerKgInr}
                onChange={edlBeyond1500KgPerKgInr => patchShared({ edlBeyond1500KgPerKgInr })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'air' || tab === 'surface' ? (
        <div role="tabpanel">
          <KgServiceEditor
            service={tab}
            rates={config[tab]}
            onPatch={patch => patchKg(tab, patch)}
            verifyNote={verifyNoteFor(tab === 'air' ? 'air.rates' : 'surface.rates')}
            onKeepDefault={() => ack(tab === 'air' ? 'air.rates' : 'surface.rates')}
          />
        </div>
      ) : null}

      {tab === 'domestic_priority' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          <p className="settings-bluedart__panel-blurb">
            {SERVICE_BLURB.domestic_priority}
            {' '}
            (
            {BLUE_DART_SERVICE_META.domestic_priority.sku}
            )
          </p>
          {verifyNoteFor('domestic_priority.rates') ? (
            <VerifyNote
              note={verifyNoteFor('domestic_priority.rates')!}
              keepLabel="Slabs look correct"
              onKeep={() => ack('domestic_priority.rates')}
            />
          ) : null}
          <div className="settings-bluedart__subhead">Rules</div>
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

      {/* Keep parent service in sync when landing on shared after a service edit. */}
      <span className="sr-only" aria-hidden>
        Active service context:
        {' '}
        {service}
      </span>
    </div>
  );
};
