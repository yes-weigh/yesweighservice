/**
 * Super-admin Blue Dart tariff editor (Settings → Delivery Partners → Blue Dart).
 * Live-saves `appSettings/logisticsCourierRates.bluedart` via saveBlueDartConfig.
 * Tabs: Surface | Air | Domestic Priority.
 * Surface is a single flat editor in quote charge order.
 * Air / DP reuse shared Fuel·CAF·RAS·FOV·EDL + service-specific rates.
 * Does NOT edit blueDartPincodes or zone/EDL matrices (re-seed those from Excel).
 * Zoho product IDs are hardcoded in freightLines.ts — intentionally not shown here.
 * Full architecture notes: src/types/blue-dart-rates.ts
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DecimalAmountInput } from '../../../components/DecimalAmountInput';
import {
  blueDartSurfaceEffectiveDieselFsPercent,
  normalizeBlueDartOversizeSlabs,
} from '../../../constants/blueDartRates';
import {
  BLUE_DART_CAF_URL,
  BLUE_DART_FUEL_SURCHARGE_URL,
  fetchBlueDartAirSurcharges,
} from '../../../lib/blueDartAirSurcharges';
import {
  BLUE_DART_DIESEL_FUEL_SURCHARGE_URL,
  fetchBlueDartDieselFuelSurcharge,
} from '../../../lib/blueDartDieselFuel';
import { previewBlueDartSurfaceStack } from '../../../lib/blueDartQuote';
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
  type BlueDartOversizeSlab,
  type BlueDartSharedRules,
  type BlueDartSurfaceRates,
} from '../../../types/blue-dart-rates';
import {
  BLUE_DART_SERVICE_META,
  type BlueDartServiceId,
} from '../../../types/logistics-courier-rates';
import type { LogisticsPartnerStatus } from '../../../types/logistics-partner-status';
import { PartnerStatusControl } from './PartnerStatusControl';

type Props = {
  config: BlueDartConfig;
  service: BlueDartServiceId;
  onServiceChange: (service: BlueDartServiceId) => void;
  onChange: (next: BlueDartConfig) => void;
  /** Sales-order status per Blue Dart service (Air / Surface / Domestic). */
  serviceStatuses: Record<BlueDartServiceId, LogisticsPartnerStatus>;
  onServiceStatusChange: (
    service: BlueDartServiceId,
    next: LogisticsPartnerStatus,
  ) => void;
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
  onPatch: (patch: Partial<BlueDartConfig['shared']>) => void;
}) {
  const { shared, onPatch } = props;
  const [airFetchBusy, setAirFetchBusy] = useState(false);
  const [airFetchNote, setAirFetchNote] = useState<string | null>(null);
  const [airFetchError, setAirFetchError] = useState<string | null>(null);

  const handleFetchAirFsCaf = async () => {
    if (airFetchBusy) return;
    setAirFetchBusy(true);
    setAirFetchError(null);
    setAirFetchNote(null);
    try {
      const result = await fetchBlueDartAirSurcharges();
      onPatch({
        fuelSurchargePercent: result.fuel.percent,
        cafPercent: result.caf.percent,
      });
      setAirFetchNote(
        `Applied FS ${result.fuel.percent}% (${result.fuel.effectiveLabel}) · CAF ${result.caf.percent}% (${result.caf.effectiveLabel})`,
      );
    } catch (err) {
      setAirFetchError(
        err instanceof Error ? err.message : 'Could not fetch FS / CAF surcharges.',
      );
    } finally {
      setAirFetchBusy(false);
    }
  };

  return (
    <div className="settings-bluedart__shared-block">
      <div className="settings-bluedart__shared-head">
        <strong>Shared charges</strong>
        <em>Fuel, CAF, RAS, insurance, and EDL for Air &amp; Domestic Priority (ex-GST).</em>
      </div>

      <div className="settings-bluedart__subhead">Fuel &amp; tax add-ons</div>
      <div className="settings-bluedart__diesel settings-bluedart__air-surcharges">
        <div className="settings-bluedart__diesel-fields">
          <div className="settings-bluedart__diesel-col">
            <PctInput
              label="Fuel (FS)"
              tip="Domestic Fuel Surcharge from Blue Dart — absolute % you bill (e.g. 99)."
              value={shared.fuelSurchargePercent}
              hint="published domestic"
              onChange={fuelSurchargePercent => onPatch({ fuelSurchargePercent })}
            />
          </div>
          <div className="settings-bluedart__diesel-col">
            <PctInput
              label="CAF"
              tip="Currency Adjustment Factor from Blue Dart — absolute % (e.g. 22.5)."
              value={shared.cafPercent}
              hint="published CAF"
              onChange={cafPercent => onPatch({ cafPercent })}
            />
          </div>
        </div>
        <div className="settings-bluedart__diesel-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={airFetchBusy}
            onClick={() => void handleFetchAirFsCaf()}
          >
            {airFetchBusy
              ? <Loader2 size={14} className="spin-icon" aria-hidden />
              : <RefreshCw size={14} aria-hidden />}
            {airFetchBusy ? 'Fetching…' : 'Fetch current'}
          </button>
          <a
            href={BLUE_DART_FUEL_SURCHARGE_URL}
            target="_blank"
            rel="noreferrer"
            className="settings-bluedart__inline-link"
          >
            FS source
            <ExternalLink size={12} aria-hidden />
          </a>
          <a
            href={BLUE_DART_CAF_URL}
            target="_blank"
            rel="noreferrer"
            className="settings-bluedart__inline-link"
          >
            CAF source
            <ExternalLink size={12} aria-hidden />
          </a>
        </div>
        {airFetchNote ? (
          <p className="settings-bluedart__diesel-note text-sm">{airFetchNote}</p>
        ) : null}
        {airFetchError ? (
          <p className="settings-bluedart__diesel-error text-sm" role="alert">{airFetchError}</p>
        ) : null}
      </div>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
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

type SurfaceStackName = {
  text: string;
  tip: string;
};

function SurfaceStackTip(props: SurfaceStackName) {
  return (
    <span
      className="settings-bluedart__stack-tip"
      data-tip={props.tip}
      tabIndex={0}
    >
      {props.text}
    </span>
  );
}

/** Surface-only editor — fields in quote charge order (ex-GST, no CAF). */
function SurfaceStackRow(props: {
  kind: 'line' | 'subtotal' | 'total';
  /** Leading marker, e.g. "+", "=" */
  prefix?: string;
  names: SurfaceStackName[];
  /** Joiner between tippable names (default space). */
  join?: string;
  /** Trailing text after names, e.g. "0%" or "₹100". */
  suffix?: string;
  detail?: string;
  value?: string;
}) {
  const join = props.join ?? ' ';
  return (
    <div className={`settings-bluedart__stack-row settings-bluedart__stack-row--${props.kind}`}>
      <span className="settings-bluedart__stack-label">
        {props.prefix ? <span className="settings-bluedart__stack-prefix">{props.prefix} </span> : null}
        {props.names.map((name, idx) => (
          <React.Fragment key={`${name.text}-${idx}`}>
            {idx > 0 ? <span className="settings-bluedart__stack-join">{join}</span> : null}
            <SurfaceStackTip text={name.text} tip={name.tip} />
          </React.Fragment>
        ))}
        {props.suffix ? (
          <span className="settings-bluedart__stack-suffix"> {props.suffix}</span>
        ) : null}
      </span>
      {props.detail ? (
        <span className="settings-bluedart__stack-detail">{props.detail}</span>
      ) : (
        <span className="settings-bluedart__stack-detail" aria-hidden />
      )}
      {props.value ? (
        <span className="settings-bluedart__stack-value">{props.value}</span>
      ) : null}
    </div>
  );
}

function formatStackInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Live map of how Surface % compound — mirrors Air sheet style, without CAF. */
function SurfaceChargeStack(props: {
  rates: BlueDartSurfaceRates;
  shared: BlueDartSharedRules;
}) {
  const { rates, shared } = props;
  const dieselPublished = rates.fuelSurchargePercent ?? 0;
  const dieselEffective = blueDartSurfaceEffectiveDieselFsPercent(rates);
  const b2bDiscount = rates.dieselB2bDiscountPercent ?? 0;
  const seasonLabel = `${MONTH_OPTIONS.find(m => m.value === rates.festivalSeasonStartMonth)?.label?.slice(0, 3) ?? '?'}–${MONTH_OPTIONS.find(m => m.value === rates.festivalSeasonEndMonth)?.label?.slice(0, 3) ?? '?'}`;
  const oversizeSlabs = normalizeBlueDartOversizeSlabs(rates.oversizeSlabs);
  const oversizeSummary = oversizeSlabs
    .map(s => `under ${s.upToKg} kg → ₹${s.amountInr}`)
    .join(' · ');
  const statesByZone = useMemo(() => blueDartStatesByAirZone(shared), [shared]);

  const [zone, setZone] = useState<BlueDartAirZone>(1);
  const [actualKg, setActualKg] = useState(10);
  const [lengthCm, setLengthCm] = useState(0);
  const [widthCm, setWidthCm] = useState(0);
  const [heightCm, setHeightCm] = useState(0);
  const [invoiceValueInr, setInvoiceValueInr] = useState(50000);
  const [destState, setDestState] = useState('Karnataka');
  const [isEdl, setIsEdl] = useState(false);
  const [edlKm, setEdlKm] = useState(0);
  const [quoteMonth, setQuoteMonth] = useState(() => new Date().getMonth() + 1);

  const zoneStates = statesByZone[zone] ?? [];

  useEffect(() => {
    if (zoneStates.length === 0) return;
    if (!zoneStates.includes(destState)) {
      setDestState(zoneStates[0]);
    }
  }, [zone, zoneStates, destState]);

  const preview = useMemo(() => {
    const at = new Date();
    at.setMonth(quoteMonth - 1, 15);
    return previewBlueDartSurfaceStack({
      shared,
      surface: rates,
      zone,
      actualKg,
      dims: { lengthCm, widthCm, heightCm },
      invoiceValueInr,
      destState,
      isEdl,
      edlKm: edlKm > 0 ? edlKm : null,
      at,
    });
  }, [
    shared,
    rates,
    zone,
    actualKg,
    lengthCm,
    widthCm,
    heightCm,
    invoiceValueInr,
    destState,
    isEdl,
    edlKm,
    quoteMonth,
  ]);

  return (
    <div className="settings-bluedart__stack" aria-label="Surface rate calculation order">
      <div className="settings-bluedart__stack-head">
        <strong>How Surface adds up</strong>
        <em>
          Same stacking idea as Air (basic → % on basic → fuel on that subtotal → next %),
          but Surface uses Festival instead of PSS, Diesel FS instead of Air fuel, and no CAF.
          Hover any short name for what it means. Use the test area to fill rupee amounts.
        </em>
      </div>

      <div className="settings-bluedart__stack-test">
        <div className="settings-bluedart__stack-test-head">
          <strong>Try a quote</strong>
          <em>
            Chargeable
            {' '}
            {preview.chargeableKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
            {' '}
            kg
            {preview.volumetricKg > 0
              ? ` · vol ${preview.volumetricKg.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
              : ''}
            {' · '}
            ₹
            {preview.perKgInr}
            /kg zone
            {' '}
            {preview.zone}
            {preview.rateMissing ? ' · rate missing' : ''}
          </em>
        </div>
        <div className="settings-bluedart__stack-test-fields">
          <Field label="Zone" tip="Ship-from SOUTH × destination region.">
            <select
              className="settings-bluedart__select"
              value={zone}
              onChange={e => setZone(Number(e.target.value) as BlueDartAirZone)}
            >
              {BLUE_DART_AIR_ZONES.map(z => (
                <option key={z} value={z}>Zone {z}</option>
              ))}
            </select>
          </Field>
          <Field label="Dest state" tip="Used for RAS and EDL specials. Options follow the selected zone.">
            <select
              className="settings-bluedart__select"
              value={destState}
              onChange={e => setDestState(e.target.value)}
            >
              {zoneStates.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </Field>
          <Field label="Actual kg" tip="Actual weight before volumetric / min floors.">
            <DecimalAmountInput
              min={0}
              decimals={1}
              value={actualKg}
              onChange={next => {
                if (next == null) return;
                setActualKg(next);
              }}
            />
          </Field>
          <Field label="L × B × H (cm)" tip="Optional. Volumetric kg = L×B×H ÷ divisor.">
            <div className="settings-bluedart__stack-dims">
              <DecimalAmountInput
                min={0}
                decimals={0}
                value={lengthCm || null}
                aria-label="Length cm"
                onChange={next => setLengthCm(next ?? 0)}
              />
              <span aria-hidden>×</span>
              <DecimalAmountInput
                min={0}
                decimals={0}
                value={widthCm || null}
                aria-label="Width cm"
                onChange={next => setWidthCm(next ?? 0)}
              />
              <span aria-hidden>×</span>
              <DecimalAmountInput
                min={0}
                decimals={0}
                value={heightCm || null}
                aria-label="Height cm"
                onChange={next => setHeightCm(next ?? 0)}
              />
            </div>
          </Field>
          <InrInput
            label="Invoice value"
            tip="For FOV insurance: max(min ₹, % of invoice)."
            value={invoiceValueInr}
            decimals={0}
            onChange={setInvoiceValueInr}
          />
          <Field label="Quote month" tip="Controls whether Festival season applies.">
            <select
              className="settings-bluedart__select"
              value={quoteMonth}
              onChange={e => setQuoteMonth(Number(e.target.value))}
            >
              {MONTH_OPTIONS.map(month => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </Field>
          <label className="settings-courier-rates__toggle settings-bluedart__stack-edl-toggle">
            <input
              type="checkbox"
              checked={isEdl}
              onChange={e => setIsEdl(e.target.checked)}
            />
            <span>
              <span
                className="settings-bluedart__label-tip"
                data-tip="Treat destination pin as Extra Delivery Location."
                tabIndex={0}
              >
                EDL pin
              </span>
              <em>Apply EDL after %</em>
            </span>
          </label>
          {isEdl ? (
            <Field label="EDL hub km" tip="Optional. Enables distance matrix when mode uses km.">
              <DecimalAmountInput
                min={0}
                decimals={0}
                value={edlKm || null}
                onChange={next => setEdlKm(next ?? 0)}
              />
            </Field>
          ) : null}
        </div>
      </div>

      <div className="settings-bluedart__stack-body">
        <SurfaceStackRow
          kind="line"
          names={[{
            text: 'Basic freight',
            tip: 'Starting freight: zone ₹/kg × chargeable kg, after min weight and min freight floors. All % below that say “of basic” multiply this amount.',
          }]}
          detail={`${formatStackInr(preview.perKgInr)}/kg × ${preview.chargeableKg} kg`}
          value={formatStackInr(preview.baseFreightInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[{
            text: 'Festival',
            tip: 'Festival / peak-season surcharge. % of basic freight only, and only when the quote month falls in the configured season (default Sep–Dec @ 3%). Surface’s stand-in for Air PSS.',
          }]}
          suffix={`${rates.festivalSurchargePercent}%`}
          detail={
            preview.festivalPct > 0
              ? `of basic · in season (${seasonLabel})`
              : `of basic · out of season (${seasonLabel})`
          }
          value={formatStackInr(preview.festivalSurchargeInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[{
            text: 'Docket',
            tip: 'Fixed AWB / docket fee once per shipment (not per box). Included in the diesel FS base (Surface rates sample).',
          }]}
          detail="flat · once per shipment · inside FS base"
          value={formatStackInr(preview.docketFeeInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[{
            text: 'FOV',
            tip: 'Freight on Value once per shipment. Higher of min ₹ and % of invoice. Included in the diesel FS base (Surface rates sample).',
          }]}
          detail="flat · once per shipment · inside FS base"
          value={formatStackInr(preview.fovInr)}
        />
        <SurfaceStackRow
          kind="subtotal"
          prefix="="
          names={[{
            text: 'Subtotal A',
            tip: 'Basic + Festival + Docket + FOV. Diesel FS is calculated on this subtotal (Surface rates.xlsx sample). Surface has no IDC.',
          }]}
          detail="Basic + Festival + Docket + FOV"
          value={formatStackInr(preview.subtotalAInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[{
            text: 'Diesel FS',
            tip: 'Published diesel FS after B2B discount. Effective % of Subtotal A. Surface does not use CAF.',
          }]}
          suffix={`${dieselEffective}%`}
          detail={
            b2bDiscount > 0
              ? `effective of Subtotal A · ${dieselPublished}% − ${b2bDiscount}% = ${dieselEffective}%`
              : 'of Subtotal A'
          }
          value={formatStackInr(preview.fuelSurchargeInr)}
        />
        <SurfaceStackRow
          kind="subtotal"
          prefix="="
          names={[{
            text: 'Subtotal B',
            tip: 'Subtotal A + effective Diesel FS. EFSS is calculated on this amount.',
          }]}
          detail="Subtotal A + Diesel FS"
          value={formatStackInr(preview.subtotalBInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[{
            text: 'EFSS',
            tip: 'Elevated Freight Stability Surcharge. % of Subtotal B (after Diesel FS).',
          }]}
          suffix={`${rates.efssPercent}%`}
          detail="of Subtotal B"
          value={formatStackInr(preview.efssInr)}
        />
        <SurfaceStackRow
          kind="line"
          prefix="+"
          names={[
            {
              text: 'OS/OW',
              tip: 'Oversize / overweight flat ₹ per box from that box’s chargeable kg slabs (≤32 Nil, 33–70 ₹100, 71–200 ₹300, 201–700 ₹3500). Not based on combined shipment weight. After % stack — not inside FS/EFSS.',
            },
            {
              text: 'RAS',
              tip: 'Remote Area Surcharge. ₹ per chargeable kg when the destination state is in the RAS list (e.g. Bihar, Jharkhand, Kerala, J&K, Ladakh).',
            },
            {
              text: 'ECC',
              tip: 'Environment Compensation Charge — ₹125 per AWB when destination is Delhi (Surface rates.xlsx).',
            },
            {
              text: 'EDL',
              tip: 'Extra Delivery Location charge when the pincode is outside Blue Dart’s standard coverage (flat, NE/J&K, or distance rules).',
            },
          ]}
          join=" · "
          detail={`flat VAS · ${oversizeSummary || 'OS —'}`}
          value={formatStackInr(
            preview.oversizeInr + preview.rasInr + preview.eccInr + preview.edlInr,
          )}
        />
        <SurfaceStackRow
          kind="total"
          prefix="="
          names={[{
            text: 'Total',
            tip: 'Sum of the stack above, rounded up to a whole rupee. Quoted ex-GST — tax is applied on the sales order, not here.',
          }]}
          detail="ceil to whole ₹ · ex-GST"
          value={formatStackInr(preview.totalInr)}
        />
      </div>
    </div>
  );
}

function SurfaceStep(props: {
  n: number;
  title: string;
  applies?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-bluedart__surface-step">
      <header className="settings-bluedart__surface-step-head">
        <span className="settings-bluedart__surface-step-n">{props.n}</span>
        <div>
          <strong>{props.title}</strong>
          {props.applies ? <em>{props.applies}</em> : null}
        </div>
      </header>
      {props.children}
    </section>
  );
}

type OversizeEditorRow = BlueDartOversizeSlab & { id: string };

let oversizeRowSeq = 0;
function nextOversizeRowId(): string {
  oversizeRowSeq += 1;
  return `os-row-${oversizeRowSeq}`;
}

function rowsFromSlabs(slabs: BlueDartOversizeSlab[]): OversizeEditorRow[] {
  return normalizeBlueDartOversizeSlabs(slabs).map(s => ({
    id: nextOversizeRowId(),
    upToKg: s.upToKg,
    amountInr: s.amountInr,
  }));
}

/**
 * Edit OS/OW slabs without re-sorting on every keystroke.
 * (Sorting/dedupe by upToKg used to jump the typed row to the top mid-edit.)
 */
function OversizeSlabsEditor(props: {
  slabs: BlueDartOversizeSlab[];
  onChange: (next: BlueDartOversizeSlab[]) => void;
}) {
  const [rows, setRows] = useState<OversizeEditorRow[]>(() => rowsFromSlabs(props.slabs));
  const editingRef = useRef(false);
  const propsSig = useMemo(
    () => JSON.stringify(normalizeBlueDartOversizeSlabs(props.slabs)),
    [props.slabs],
  );
  const lastSyncedSig = useRef(propsSig);

  useEffect(() => {
    if (editingRef.current) return;
    if (propsSig === lastSyncedSig.current) return;
    lastSyncedSig.current = propsSig;
    setRows(rowsFromSlabs(props.slabs));
  }, [props.slabs, propsSig]);

  const commit = (next: OversizeEditorRow[]) => {
    setRows(next);
    const payload = next.map(({ upToKg, amountInr }) => ({ upToKg, amountInr }));
    lastSyncedSig.current = JSON.stringify(normalizeBlueDartOversizeSlabs(payload));
    props.onChange(payload);
  };

  return (
    <div className="settings-bluedart__oversize">
      <table className="settings-bluedart__oversize-table">
        <thead>
          <tr>
            <th scope="col">Under kg</th>
            <th scope="col">Flat ₹</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id}>
              <td>
                <div className="settings-courier-rates__suffix-input">
                  <DecimalAmountInput
                    min={0.1}
                    decimals={1}
                    value={row.upToKg}
                    aria-label={`Oversize slab ${idx + 1} under kg`}
                    onFocus={() => {
                      editingRef.current = true;
                    }}
                    onChange={next => {
                      if (next == null) return;
                      editingRef.current = true;
                      const copy = rows.map(r => ({ ...r }));
                      copy[idx] = { ...copy[idx], upToKg: next };
                      commit(copy);
                    }}
                    onBlur={() => {
                      editingRef.current = false;
                    }}
                  />
                  <span aria-hidden>kg</span>
                </div>
              </td>
              <td>
                <div className="settings-courier-rates__suffix-input">
                  <DecimalAmountInput
                    min={0}
                    decimals={2}
                    value={row.amountInr}
                    aria-label={`Oversize slab ${idx + 1} amount`}
                    onFocus={() => {
                      editingRef.current = true;
                    }}
                    onChange={next => {
                      if (next == null) return;
                      editingRef.current = true;
                      const copy = rows.map(r => ({ ...r }));
                      copy[idx] = { ...copy[idx], amountInr: next };
                      commit(copy);
                    }}
                    onBlur={() => {
                      editingRef.current = false;
                    }}
                  />
                  <span aria-hidden>₹</span>
                </div>
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm settings-bluedart__oversize-remove"
                  disabled={rows.length <= 1}
                  aria-label={`Remove oversize slab ${idx + 1}`}
                  title={rows.length <= 1 ? 'Keep at least one slab' : 'Remove slab'}
                  onClick={() => {
                    editingRef.current = false;
                    commit(rows.filter((_, i) => i !== idx));
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          editingRef.current = false;
          const last = rows[rows.length - 1];
          const nextUpTo = Math.max(32, (last?.upToKg ?? 32) + 10);
          commit([
            ...rows,
            { id: nextOversizeRowId(), upToKg: nextUpTo, amountInr: 0 },
          ]);
        }}
      >
        <Plus size={14} aria-hidden />
        Add slab
      </button>
    </div>
  );
}

function SurfaceRatesEditor(props: {
  rates: BlueDartSurfaceRates;
  shared: BlueDartSharedRules;
  onPatchRates: (patch: Partial<BlueDartSurfaceRates>) => void;
  onPatchShared: (patch: Partial<BlueDartConfig['shared']>) => void;
}) {
  const { rates, shared, onPatchRates, onPatchShared } = props;
  const statesByZone = useMemo(() => blueDartStatesByAirZone(shared), [shared]);
  const [dieselFetchBusy, setDieselFetchBusy] = useState(false);
  const [dieselFetchNote, setDieselFetchNote] = useState<string | null>(null);
  const [dieselFetchError, setDieselFetchError] = useState<string | null>(null);

  const handleFetchDieselFs = async () => {
    if (dieselFetchBusy) return;
    setDieselFetchBusy(true);
    setDieselFetchError(null);
    setDieselFetchNote(null);
    try {
      const result = await fetchBlueDartDieselFuelSurcharge();
      onPatchRates({ fuelSurchargePercent: result.percent, cafPercent: null });
      setDieselFetchNote(`Applied ${result.percent}% · ${result.effectiveLabel}`);
    } catch (err) {
      setDieselFetchError(
        err instanceof Error ? err.message : 'Could not fetch diesel fuel surcharge.',
      );
    } finally {
      setDieselFetchBusy(false);
    }
  };

  const dieselPct = rates.fuelSurchargePercent ?? 0;
  const dieselB2bDiscountPct = rates.dieselB2bDiscountPercent ?? 0;
  const dieselEffectivePct = blueDartSurfaceEffectiveDieselFsPercent(rates);

  return (
    <div className="settings-bluedart__service-block settings-bluedart__surface">
      <SurfaceChargeStack rates={rates} shared={shared} />

      <SurfaceStep
        n={1}
        title="Basic freight"
        applies="Starting amount before any %"
      >
        <div className="settings-courier-rates__zone-table-wrap">
          <table className="settings-courier-rates__zone-table settings-bluedart__zone-table">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">Destination states</th>
                <th scope="col">₹ / kg</th>
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
                          onPatchRates({ perKgInr: { ...rates.perKgInr, [z]: next } });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <Field label="Min weight (kg)" tip="Chargeable weight floor.">
            <DecimalAmountInput
              min={0}
              decimals={1}
              value={rates.minimumChargeableWeightKg}
              onChange={next => {
                if (next == null) return;
                onPatchRates({ minimumChargeableWeightKg: next });
              }}
            />
          </Field>
          <InrInput
            label="Min freight"
            tip="Floor for basic freight before % surcharges."
            value={rates.minimumFreightInr}
            onChange={minimumFreightInr => onPatchRates({ minimumFreightInr })}
          />
          <Field
            label="Volumetric divisor"
            tip="Volumetric kg = L × B × H (cm) ÷ divisor."
          >
            <DecimalAmountInput
              min={1}
              decimals={0}
              value={rates.volumetricDivisor}
              onChange={next => {
                if (next == null) return;
                onPatchRates({ volumetricDivisor: next });
              }}
            />
          </Field>
        </div>
      </SurfaceStep>

      <SurfaceStep
        n={2}
        title="Festival / peak season"
        applies="% of basic freight only · Sep–Dec by default · no IDC on Surface"
      >
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <PctInput
            label="Festival"
            tip="Replaces Air PSS on Surface. % of basic freight, only inside the season."
            value={rates.festivalSurchargePercent}
            hint="of basic · season only"
            onChange={festivalSurchargePercent => onPatchRates({ festivalSurchargePercent })}
          />
          <Field label="Season starts" tip="First month of festival season.">
            <select
              className="settings-bluedart__select"
              value={rates.festivalSeasonStartMonth}
              onChange={e => onPatchRates({
                festivalSeasonStartMonth: Number(e.target.value),
              })}
            >
              {MONTH_OPTIONS.map(month => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Season ends" tip="Last month (inclusive; may wrap year).">
            <select
              className="settings-bluedart__select"
              value={rates.festivalSeasonEndMonth}
              onChange={e => onPatchRates({
                festivalSeasonEndMonth: Number(e.target.value),
              })}
            >
              {MONTH_OPTIONS.map(month => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <p className="settings-bluedart__stack-footnote">
          → then Docket + FOV join Subtotal A (FS base)
        </p>
      </SurfaceStep>

      <SurfaceStep
        n={3}
        title="Oversize per box"
        applies="Flat ₹ per box from that box’s chargeable kg · first matching slab wins (sorted at quote time)"
      >
        <OversizeSlabsEditor
          slabs={rates.oversizeSlabs}
          onChange={oversizeSlabs => onPatchRates({ oversizeSlabs })}
        />
        <p className="settings-bluedart__stack-footnote">
          → OS/OW is charged per box (not on combined shipment kg), after EFSS
        </p>
      </SurfaceStep>

      <SurfaceStep
        n={4}
        title="Diesel fuel surcharge"
        applies="% of Subtotal A · after B2B discount"
      >
        <div className="settings-bluedart__diesel">
          <div className="settings-bluedart__diesel-fields">
            <div className="settings-bluedart__diesel-col">
              <PctInput
                label="Diesel FS"
                tip="Published Blue Dart diesel FS. B2B discount reduces the rate actually applied to Subtotal A. No CAF on Surface."
                value={dieselPct}
                hint="published rate"
                onChange={fuelSurchargePercent => onPatchRates({
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
                <a
                  href={BLUE_DART_DIESEL_FUEL_SURCHARGE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="settings-bluedart__inline-link"
                >
                  Source
                  <ExternalLink size={12} aria-hidden />
                </a>
              </div>
              {dieselFetchNote ? (
                <p className="settings-bluedart__diesel-note text-sm">{dieselFetchNote}</p>
              ) : null}
              {dieselFetchError ? (
                <p className="settings-bluedart__diesel-error text-sm" role="alert">{dieselFetchError}</p>
              ) : null}
            </div>
            <div className="settings-bluedart__diesel-col">
              <PctInput
                label="B2B discount"
                tip="Percentage points subtracted from published Diesel FS. Effective FS = published − B2B (e.g. 52 − 10 = 42)."
                value={dieselB2bDiscountPct}
                hint="points off published"
                onChange={dieselB2bDiscountPercent => onPatchRates({
                  dieselB2bDiscountPercent: Math.max(0, dieselB2bDiscountPercent),
                })}
              />
            </div>
          </div>
          <p className="settings-bluedart__diesel-effective">
            Effective Diesel FS: {dieselEffectivePct}%
            {dieselB2bDiscountPct > 0
              ? ` = ${dieselPct}% − ${dieselB2bDiscountPct}%`
              : ''}
          </p>
        </div>
        <p className="settings-bluedart__stack-footnote">
          → Subtotal B = Subtotal A + effective Diesel FS · (Air would add CAF next; Surface skips CAF)
        </p>
      </SurfaceStep>

      <SurfaceStep
        n={5}
        title="EFSS"
        applies={`% of Subtotal B · currently ${rates.efssPercent}%`}
      >
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <PctInput
            label="EFSS"
            tip="Elevated Freight Stability Surcharge — % of Subtotal B (after diesel FS)."
            value={rates.efssPercent}
            hint="of Subtotal B"
            onChange={efssPercent => onPatchRates({ efssPercent })}
          />
        </div>
      </SurfaceStep>

      <SurfaceStep
        n={6}
        title="Flat adds after %"
        applies="Not inside Diesel FS / EFSS bases"
      >
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <InrInput
            label="Docket fee"
            tip="Fixed AWB fee once per shipment. Added after percentages (unlike the Air sample sheet where docket sits before fuel)."
            value={rates.docketFeeInr}
            hint="₹ / shipment"
            onChange={docketFeeInr => onPatchRates({ docketFeeInr })}
          />
          <InrInput
            label="RAS ₹ / kg"
            tip="Remote Area Surcharge for listed states × chargeable kg."
            value={shared.rasPerKgInr}
            hint="when dest is RAS state"
            onChange={rasPerKgInr => onPatchShared({ rasPerKgInr })}
          />
          <InrInput
            label="Insurance min (FOV)"
            tip="Minimum insurance ₹ once per shipment (AWB)."
            value={shared.fov.minInr}
            hint="₹ / shipment floor"
            onChange={minInr => onPatchShared({ fov: { ...shared.fov, minInr } })}
          />
          <PctInput
            label="Insurance % of invoice"
            tip="FOV once per shipment: max(min ₹, this % of invoice)."
            value={shared.fov.percentOfInvoice}
            hint="of invoice · not of freight"
            onChange={percentOfInvoice => onPatchShared({
              fov: { ...shared.fov, percentOfInvoice },
            })}
          />
          <InrInput
            label="ECC (Delhi)"
            tip="Environment Compensation Charge — flat ₹ per AWB when destination is Delhi / NCT of Delhi (Surface rates.xlsx)."
            value={rates.eccPerShipmentInr}
            hint="₹ / shipment · Delhi only"
            onChange={eccPerShipmentInr => onPatchRates({ eccPerShipmentInr })}
          />
        </div>
      </SurfaceStep>

      <SurfaceStep
        n={7}
        title="Extra delivery (EDL)"
        applies="Only when pin is outside standard coverage · after %"
      >
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <Field label="EDL mode" tip="How to charge pins outside standard coverage.">
            <select
              className="settings-bluedart__select"
              value={shared.edlMode}
              onChange={e => onPatchShared({ edlMode: e.target.value as BlueDartEdlMode })}
            >
              {BLUE_DART_EDL_MODES.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <InrInput
            label="EDL flat ₹"
            tip="When hub-km is unknown."
            value={shared.edlFlatFallbackInr}
            onChange={edlFlatFallbackInr => onPatchShared({ edlFlatFallbackInr })}
          />
          <InrInput
            label="NE / J&K ₹ / kg"
            tip="Special EDL for North-East and J&K."
            value={shared.edlNeJkPerKgInr}
            onChange={edlNeJkPerKgInr => onPatchShared({ edlNeJkPerKgInr })}
          />
          <InrInput
            label="NE / J&K min ₹"
            tip="Floor for NE / J&K EDL."
            value={shared.edlNeJkFloorInr}
            onChange={edlNeJkFloorInr => onPatchShared({ edlNeJkFloorInr })}
          />
          <InrInput
            label="Beyond 500 km ₹/km"
            tip="When pin has edlKm stored."
            value={shared.edlBeyond500KmPerKmInr}
            onChange={edlBeyond500KmPerKmInr => onPatchShared({ edlBeyond500KmPerKmInr })}
          />
          <InrInput
            label="Beyond 1500 kg ₹/kg"
            tip="Heavy EDL when distance is known."
            value={shared.edlBeyond1500KgPerKgInr}
            onChange={edlBeyond1500KgPerKgInr => onPatchShared({ edlBeyond1500KgPerKgInr })}
          />
        </div>
      </SurfaceStep>

      <SurfaceStep n={8} title="Pin rules">
        <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
          <label className="settings-courier-rates__toggle">
            <input
              type="checkbox"
              checked={shared.hideTemPer}
              onChange={e => onPatchShared({ hideTemPer: e.target.checked })}
            />
            <span>
              <span
                className="settings-bluedart__label-tip"
                data-tip="TEM = temporary exclusion, PER = permanent."
                tabIndex={0}
              >
                Hide TEM / PER pins
              </span>
              <em>Skip pins Blue Dart marked unavailable</em>
            </span>
          </label>
        </div>
      </SurfaceStep>
    </div>
  );
}

function AirRatesEditor(props: {
  rates: BlueDartKgServiceRates;
  shared: BlueDartSharedRules;
  onPatch: (patch: Partial<BlueDartKgServiceRates>) => void;
}) {
  const { rates, onPatch, shared } = props;
  const statesByZone = useMemo(() => blueDartStatesByAirZone(shared), [shared]);

  return (
    <div className="settings-bluedart__service-block">
      <div className="settings-bluedart__subhead">Air rates</div>
      <p className="settings-bluedart__panel-blurb">{SERVICE_BLURB.air}</p>

      <div className="settings-bluedart__subhead">Weight &amp; fees</div>
      <div className="settings-courier-rates__inline-fields settings-bluedart__grid">
        <Field label="Min weight (kg)" tip="Chargeable weight floor.">
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
          tip="Fixed AWB fee once per shipment."
          value={rates.docketFeeInr}
          onChange={docketFeeInr => onPatch({ docketFeeInr })}
        />
        <Field
          label="Volumetric divisor"
          tip="Volumetric kg = L × B × H (cm) ÷ divisor."
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
        Zone from ship-from SOUTH × destination state.
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
  serviceStatuses,
  onServiceStatusChange,
}) => {
  const shared = config.shared;
  const [tab, setTab] = useState<BlueDartServiceId>(service);

  useEffect(() => {
    setTab(service);
  }, [service]);

  const patchShared = (patch: Partial<BlueDartConfig['shared']>) => {
    onChange({ ...config, shared: { ...shared, ...patch } });
  };

  const patchKg = (
    svc: 'air' | 'surface',
    patch: Partial<BlueDartKgServiceRates> | Partial<BlueDartSurfaceRates>,
  ) => {
    onChange({
      ...config,
      [svc]: {
        ...config[svc],
        ...patch,
        /** Surface never stores/applies IDC. */
        ...(svc === 'surface' ? { idcPercent: 0 } : null),
      },
    });
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

  const activeTabMeta = TABS.find(item => item.id === tab) ?? TABS[0]!;
  const statusControl = (
    <PartnerStatusControl
      status={serviceStatuses[tab]}
      ariaLabel={`Status for Blue Dart ${activeTabMeta.label}`}
      onChange={next => {
        onServiceStatusChange(tab, next);
      }}
    />
  );

  return (
    <div className="settings-bluedart">
      <p className="settings-bluedart__intro">
        Quotes use the dealer’s shipping <strong>pincode + state</strong>
        {' '}
        (ship-from SOUTH). Surface is laid out in charge order; Air &amp; DP share Fuel / CAF.
        Each service has its own Active / Inactive / Manual status for sales orders.
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

      {tab === 'surface' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          {statusControl}
          <SurfaceRatesEditor
            rates={config.surface}
            shared={shared}
            onPatchRates={patch => patchKg('surface', patch)}
            onPatchShared={patchShared}
          />
        </div>
      ) : null}

      {tab === 'air' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          {statusControl}
          <SharedChargesEditor shared={shared} onPatch={patchShared} />
          <AirRatesEditor
            rates={config.air}
            shared={shared}
            onPatch={patch => patchKg('air', patch)}
          />
        </div>
      ) : null}

      {tab === 'domestic_priority' ? (
        <div className="settings-bluedart__tab-panel" role="tabpanel">
          {statusControl}
          <SharedChargesEditor shared={shared} onPatch={patchShared} />
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
