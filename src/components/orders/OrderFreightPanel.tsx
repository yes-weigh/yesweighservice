import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  Eye,
  IndianRupee,
  Info,
  Package,
  Scale,
  X,
} from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import {
  logisticsPartnerImage,
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../../constants/logisticsPartners';
import type {
  FreightLineBreakdown,
  FreightParcelGroup,
  OrderCourierOption,
  StCourierCartFreightEstimate,
} from '../../lib/stCourierCartFreight';
import type { InventorySite } from '../../lib/salesOrderSegments';
import type { CatalogProduct } from '../../types/catalog';
import { ST_COURIER_ZONE_LABELS } from '../../types/logistics-courier-rates';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { ProductPackageInfo } from '../catalog/ProductPackageInfo';

type Props = {
  estimate: StCourierCartFreightEstimate;
  /** Staff/admin can fill missing package dims. */
  canEditPackage?: boolean;
  /** Staff/admin: show auto-selected plan as text. Dealers hide this. */
  showFreightChargePlan?: boolean;
  /** Dealer: hide Cochin/Head Office split; one clubbed estimate. */
  clubSites?: boolean;
  /** Staff/admin: LBH + kg + ₹/kg maths under each freight line. */
  showLineDetails?: boolean;
  /** e.g. "Tamil Nadu, Pondy" for the header. */
  destinationLabel?: string | null;
  /** Footer note under the calc card. */
  footerNote?: string | null;
  catalogById?: Record<string, CatalogProduct | undefined>;
  /**
   * Staff/admin: show ₹ input on partners without a rate card (e.g. Delhivery TBD).
   * Dealers keep read-only TBD.
   */
  allowManualFreightEntry?: boolean;
  /** Manual freight ₹ for the selected manual-rate partner. */
  manualFreightAmount?: number | null;
  onManualFreightAmountChange?: (amount: number | null) => void;
  onCourierChange: (site: InventorySite, partnerId: LogisticsPartnerId) => void;
  onPackageInfoChange?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
};

type ClubbedLine = FreightLineBreakdown & { site: InventorySite };

type ItemFreightCalcView = {
  key: string;
  title: string;
  subtitle: string | null;
  quantity: number;
  masterCartonCount: number;
  singleBoxCount: number;
  boxCount: number;
  lbhLabel: string | null;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  volumetricDivisor: number | null;
  parcelGroups: FreightParcelGroup[];
  ratePerKg: number | null;
  /** Domestic Priority slab rates when not ₹/kg. */
  rateLabel: string | null;
  zoneLabel: string | null;
  calcSteps: Array<{ label: string; detail?: string; amountInr: number }>;
  rawTotal: number;
  amountInr: number;
  isSpare: boolean;
  needsPackage: boolean;
};

function packingSummary(b: FreightLineBreakdown): string {
  const parts: string[] = [];
  if (b.masterCartonCount > 0) {
    parts.push(`${b.masterCartonCount} master carton${b.masterCartonCount === 1 ? '' : 's'}`);
  }
  if (b.singleBoxCount > 0) {
    parts.push(`${b.singleBoxCount} single box${b.singleBoxCount === 1 ? '' : 'es'}`);
  }
  if (b.missingUnits > 0) {
    parts.push(`${b.missingUnits} unit${b.missingUnits === 1 ? '' : 's'} missing dims`);
  }
  if (b.indication === 'spare_default') {
    parts.push('spare freight');
  }
  return parts.join(' · ') || '—';
}

function formatKg(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** Split a line freight ₹ across parcel groups by chargeable kg. */
function allocateParcelGroupAmounts(
  groups: FreightParcelGroup[],
  totalInr: number,
): number[] {
  const total = Number(totalInr) || 0;
  if (!groups.length) return [];
  const weights = groups.map(group => Math.max(0, Number(group.chargeableKgTotal) || 0));
  const sumKg = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (i === groups.length - 1) {
      out.push(Math.max(0, Math.round((total - allocated) * 100) / 100));
      break;
    }
    const share = sumKg > 0 ? weights[i]! / sumKg : 1 / groups.length;
    const amount = Math.round(total * share * 100) / 100;
    out.push(amount);
    allocated = Math.round((allocated + amount) * 100) / 100;
  }
  return out;
}

function ParcelGroupDetailCard({
  group,
  index,
  amountInr = 0,
}: {
  group: FreightParcelGroup;
  index: number;
  amountInr?: number;
}) {
  const kindLabel = group.kind === 'master_carton' ? 'Master carton' : 'Single box';
  const amount = Number(amountInr) || 0;
  const chgKg = Number(group.chargeableKgTotal) || 0;

  return (
    <li className="order-freight-panel__calc-packing-card">
      <p className="order-freight-panel__calc-packing-line">
        <span className="order-freight-panel__calc-packing-left">
          <strong>
            {kindLabel}
            {' '}
            #
            {index + 1}
            {group.count > 1 ? ` ×${group.count}` : ''}
          </strong>
          <span aria-hidden>·</span>
          <span className="is-chg">
            {formatKg(chgKg)}
            {' '}
            kg
          </span>
        </span>
        {amount > 0 ? (
          <strong className="order-freight-panel__calc-packing-amt">
            {formatCurrency(amount)}
          </strong>
        ) : null}
      </p>
    </li>
  );
}

function lineCalcSummary(line: FreightLineBreakdown): string | null {
  if (
    line.indication === 'spare_default'
    && (!(line.chargeableKg > 0) || !(line.boxPerKgInr != null && line.boxPerKgInr > 0))
  ) {
    return line.amountInr > 0
      ? `Spare freight ${formatCurrency(line.amountInr)}`
      : null;
  }
  if (!(line.chargeableKg > 0) || !(line.boxPerKgInr != null && line.boxPerKgInr > 0)) {
    return null;
  }
  const base = line.boxPerKgInr * line.chargeableKg;
  const fuelPct = line.fuelSurchargePercent ?? 0;
  const fuel = base * (fuelPct / 100);
  const parts = [
    `₹${formatKg(line.boxPerKgInr)}/kg × ${formatKg(line.chargeableKg)} kg = ${formatCurrency(Math.round(base * 100) / 100)}`,
  ];
  if (fuelPct > 0) {
    parts.push(`fuel ${fuelPct}% = ${formatCurrency(Math.round(fuel * 100) / 100)}`);
  }
  if (line.actualKg != null && line.volumetricKg != null) {
    parts.unshift(
      `act ${formatKg(line.actualKg)} kg · vol ${formatKg(line.volumetricKg)} kg`
      + (line.volumetricDivisor ? ` (÷${line.volumetricDivisor})` : ''),
    );
  }
  return parts.join(' · ');
}

function lineLbhLabel(line: FreightLineBreakdown): string | null {
  let lbh: string | null = null;
  let dominant = 0;
  for (const group of line.parcelGroups ?? []) {
    if (group.count >= dominant && group.lengthCm > 0) {
      dominant = group.count;
      lbh = `${group.lengthCm} × ${group.breadthCm} × ${group.heightCm}`;
    }
  }
  return lbh;
}

function buildItemCalcView(
  line: FreightLineBreakdown,
  key: string,
  siteLabel?: string | null,
): ItemFreightCalcView {
  const masterCartonCount = Math.max(0, Math.floor(Number(line.masterCartonCount) || 0));
  const singleBoxCount = Math.max(0, Math.floor(Number(line.singleBoxCount) || 0));
  const boxCount = masterCartonCount + singleBoxCount;
  const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
  const actualKg = Number(line.actualKg) || 0;
  const volumetricKg = Number(line.volumetricKg) || 0;
  const chargeableKg = Number(line.chargeableKg) || 0;
  const ratePerKg = line.boxPerKgInr != null && line.boxPerKgInr > 0
    ? line.boxPerKgInr
    : null;
  const calcSteps = Array.isArray(line.calcSteps) ? line.calcSteps : [];
  const hasBdStack = calcSteps.length > 0;
  const rateLabel = !ratePerKg && line.first500gInr != null && line.first500gInr > 0
    ? (
      line.addl500gInr != null && line.addl500gInr > 0
        ? `${formatCurrency(line.first500gInr)} / 500 g · addl ${formatCurrency(line.addl500gInr)}`
        : `${formatCurrency(line.first500gInr)} / 500 g`
    )
    : null;
  /** ST-style base; Blue Dart stack uses amountInr (includes surcharges). */
  const rawTotal = hasBdStack
    ? line.amountInr
    : ratePerKg != null && chargeableKg > 0
      ? Math.round(ratePerKg * chargeableKg * 100) / 100
      : line.amountInr;
  const isSpare = line.indication === 'spare_default';
  return {
    key,
    title: isSpare
      ? 'Spares'
      : (line.name || line.sku || 'Item'),
    subtitle: [
      line.sku && !isSpare ? line.sku : null,
      siteLabel || null,
      line.zoneLabel || null,
      isSpare ? 'Spare freight' : null,
    ].filter(Boolean).join(' · ') || null,
    quantity,
    masterCartonCount,
    singleBoxCount,
    boxCount,
    lbhLabel: lineLbhLabel(line),
    actualKg,
    volumetricKg,
    chargeableKg,
    volumetricDivisor: line.volumetricDivisor ?? null,
    parcelGroups: Array.isArray(line.parcelGroups) ? line.parcelGroups : [],
    ratePerKg,
    rateLabel,
    zoneLabel: line.zoneLabel ?? null,
    calcSteps,
    rawTotal,
    amountInr: line.amountInr,
    isSpare,
    needsPackage: line.indication === 'missing_package'
      || line.indication === 'incomplete_package',
  };
}

function CourierOptionCard({
  opt,
  selected,
  name,
  amountInr,
  allowManualFreightEntry,
  manualFreightAmount,
  onManualFreightAmountChange,
  onSelect,
}: {
  opt: OrderCourierOption;
  selected: boolean;
  name: string;
  amountInr: number;
  allowManualFreightEntry?: boolean;
  manualFreightAmount?: number | null;
  onManualFreightAmountChange?: (amount: number | null) => void;
  onSelect: () => void;
}) {
  const logo = logisticsPartnerImage(opt.partnerId);
  const showManualInput = Boolean(
    opt.enabled
    && opt.manualRate
    && !opt.liveApiRate
    && allowManualFreightEntry
    && onManualFreightAmountChange,
  );
  const displayAmount = showManualInput && selected && manualFreightAmount != null && manualFreightAmount > 0
    ? manualFreightAmount
    : (
      selected
      && opt.liveApiRate
      && manualFreightAmount != null
      && manualFreightAmount > 0
        ? manualFreightAmount
        : amountInr
    );

  return (
    <label
      className={`order-freight-panel__courier${selected ? ' is-selected' : ''}${opt.enabled ? '' : ' is-disabled'}`}
      title={opt.disabledReason ?? undefined}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        disabled={!opt.enabled}
        onChange={onSelect}
      />
      {logo ? (
        <span className="order-freight-panel__courier-logo-wrap">
          <img
            src={logo}
            alt=""
            className="order-freight-panel__courier-logo"
            loading="lazy"
            decoding="async"
          />
        </span>
      ) : null}
      <span className="order-freight-panel__courier-copy">
        <strong>{opt.label}</strong>
        {opt.preferred ? (
          <em className="order-freight-panel__courier-preferred">Preferred</em>
        ) : null}
        {opt.enabled && opt.liveApiRate ? (
          <em>{displayAmount > 0 ? 'Live API estimate' : 'Estimating…'}</em>
        ) : null}
        {opt.enabled && opt.manualRate && !opt.liveApiRate ? (
          <em>{showManualInput ? 'Enter freight ₹' : 'Enter ₹ on sales order'}</em>
        ) : null}
        {!opt.enabled && opt.disabledReason ? <em>{opt.disabledReason}</em> : null}
      </span>
      {showManualInput ? (
        <span
          className="order-freight-panel__courier-manual"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <span className="order-freight-panel__courier-manual-prefix" aria-hidden>₹</span>
          <DecimalAmountInput
            className="order-freight-panel__courier-manual-input"
            min={0}
            decimals={2}
            allowEmpty
            placeholder="0.00"
            value={selected ? (manualFreightAmount ?? null) : null}
            aria-label={`${opt.label} freight amount`}
            onChange={next => {
              if (!selected) onSelect();
              onManualFreightAmountChange?.(next);
            }}
          />
        </span>
      ) : (
        <strong className="order-freight-panel__courier-amt">
          {!opt.enabled
            ? '—'
            : opt.manualRate && !(displayAmount > 0)
              ? 'TBD'
              : formatCurrency(displayAmount)}
        </strong>
      )}
    </label>
  );
}

function ItemFreightCalcTile({
  calc,
  partnerId,
}: {
  calc: ItemFreightCalcView;
  partnerId?: LogisticsPartnerId | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const partnerLogo = partnerId ? logisticsPartnerImage(partnerId) : null;
  const partnerName = partnerId ? logisticsPartnerLabel(partnerId) : null;
  const toggleId = `freight-calc-${calc.key}`;

  const partnerBadge = partnerName ? (
    <span className="order-freight-panel__calc-partner">
      {partnerLogo ? (
        <img
          src={partnerLogo}
          alt=""
          className="order-freight-panel__calc-partner-logo"
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <em>{partnerName}</em>
    </span>
  ) : null;

  if (calc.isSpare) {
    return (
      <article
        className={`order-freight-panel__calc-card${expanded ? '' : ' is-collapsed'}`}
        aria-label={`Freight calculation · ${calc.title}`}
      >
        <header className="order-freight-panel__calc-head">
          <button
            type="button"
            className="order-freight-panel__calc-toggle"
            aria-expanded={expanded}
            aria-controls={toggleId}
            onClick={() => setExpanded(open => !open)}
          >
            <span className="order-freight-panel__calc-head-main">
              <Package size={15} aria-hidden />
              <span>Freight calculation</span>
              {partnerBadge}
            </span>
            <ChevronDown
              size={16}
              className={`order-freight-panel__calc-chevron${expanded ? ' is-open' : ''}`}
              aria-hidden
            />
          </button>
        </header>
        {expanded ? (
          <div id={toggleId} className="order-freight-panel__calc-body">
            <p className="order-freight-panel__calc-item-title">{calc.title}</p>
            {calc.subtitle ? (
              <p className="order-freight-panel__calc-item-sub">{calc.subtitle}</p>
            ) : null}
            <div className="order-freight-panel__calc-formula order-freight-panel__calc-formula--simple">
              <div className="order-freight-panel__calc-formula-left">
                <span>Spare freight</span>
                <strong>Flat charge</strong>
              </div>
              <span className="order-freight-panel__calc-formula-arrow" aria-hidden>→</span>
              <div className="order-freight-panel__calc-formula-right">
                <span>Total freight</span>
                <strong>{formatCurrency(calc.amountInr)}</strong>
              </div>
            </div>
          </div>
        ) : (
          <p className="order-freight-panel__calc-item-title order-freight-panel__calc-item-title--collapsed">
            {calc.title}
            <em>{formatCurrency(calc.amountInr)}</em>
          </p>
        )}
      </article>
    );
  }

  return (
    <article
      className={`order-freight-panel__calc-card${calc.needsPackage ? ' is-warn' : ''}${expanded ? '' : ' is-collapsed'}`}
      aria-label={`Freight calculation · ${calc.title}`}
    >
      <header className="order-freight-panel__calc-head">
        <button
          type="button"
          className="order-freight-panel__calc-toggle"
          aria-expanded={expanded}
          aria-controls={toggleId}
          onClick={() => setExpanded(open => !open)}
        >
          <span className="order-freight-panel__calc-head-main">
            <Package size={15} aria-hidden />
            <span>Freight calculation</span>
            {partnerBadge}
          </span>
          <ChevronDown
            size={16}
            className={`order-freight-panel__calc-chevron${expanded ? ' is-open' : ''}`}
            aria-hidden
          />
        </button>
      </header>

      {!expanded ? (
        <p className="order-freight-panel__calc-item-title order-freight-panel__calc-item-title--collapsed">
          {calc.title}
          <em>{formatCurrency(calc.rawTotal)}</em>
        </p>
      ) : (
        <div id={toggleId} className="order-freight-panel__calc-body">
          <p className="order-freight-panel__calc-item-title">{calc.title}</p>
          {calc.subtitle ? (
            <p className="order-freight-panel__calc-item-sub">{calc.subtitle}</p>
          ) : null}

          <div className="order-freight-panel__calc-grid">
            <div className="order-freight-panel__calc-row">
              <div className="order-freight-panel__calc-cell">
                <Package size={16} aria-hidden />
                <div>
                  <span>Qty</span>
                  <strong>{calc.quantity}</strong>
                  <em>{calc.quantity === 1 ? 'unit' : 'units'}</em>
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <Box size={16} aria-hidden />
                <div>
                  <span>Master cartons</span>
                  <strong>{calc.masterCartonCount}</strong>
                  <em>
                    {calc.masterCartonCount === 1 ? 'carton' : 'cartons'}
                    {calc.boxCount > 0
                      ? ` · ${calc.boxCount} total box${calc.boxCount === 1 ? '' : 'es'}`
                      : ''}
                  </em>
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <Box size={16} aria-hidden />
                <div>
                  <span>Single boxes</span>
                  <strong>{calc.singleBoxCount}</strong>
                  <em>{calc.singleBoxCount === 1 ? 'box' : 'boxes'}</em>
                </div>
              </div>
            </div>

            <div className="order-freight-panel__calc-row">
              <div className="order-freight-panel__calc-cell">
                <Package size={16} aria-hidden />
                <div>
                  <span>LBH (cm) (Per Box)</span>
                  <strong>{calc.lbhLabel || '—'}</strong>
                  {calc.lbhLabel ? <em>( L × B × H )</em> : null}
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <Scale size={16} aria-hidden />
                <div>
                  <span>Actual weight</span>
                  <strong>
                    {formatKg(calc.actualKg)}
                    {' '}
                    kg
                  </strong>
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <Scale size={16} aria-hidden />
                <div>
                  <span>Volumetric weight</span>
                  <strong>
                    {formatKg(calc.volumetricKg)}
                    {' '}
                    kg
                  </strong>
                  {calc.volumetricDivisor
                    ? (
                      <em>
                        ÷
                        {calc.volumetricDivisor}
                      </em>
                    )
                    : null}
                </div>
              </div>
            </div>

            <div className="order-freight-panel__calc-row">
              <div className="order-freight-panel__calc-cell">
                <Scale size={16} aria-hidden />
                <div>
                  <span>Chargeable weight</span>
                  <strong>
                    {formatKg(calc.chargeableKg)}
                    {' '}
                    kg
                  </strong>
                  <em>max(actual, volumetric)</em>
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <IndianRupee size={16} aria-hidden />
                <div>
                  <span>Rate</span>
                  <strong>
                    {calc.ratePerKg != null
                      ? `${formatCurrency(calc.ratePerKg)} / kg`
                      : (calc.rateLabel ?? '—')}
                  </strong>
                  {calc.zoneLabel ? <em>{calc.zoneLabel}</em> : null}
                </div>
              </div>
              <div className="order-freight-panel__calc-cell">
                <IndianRupee size={16} aria-hidden />
                <div>
                  <span>Line freight</span>
                  <strong>{formatCurrency(calc.rawTotal)}</strong>
                </div>
              </div>
            </div>
          </div>

          {calc.parcelGroups.length > 0 ? (
            <div className="order-freight-panel__calc-packing">
              <div className="order-freight-panel__calc-packing-head">
                <p className="order-freight-panel__calc-packing-title">Packing detail</p>
                <em className="order-freight-panel__calc-packing-summary">
                  {calc.parcelGroups.reduce((sum, group) => sum + group.count, 0)}
                  {' '}
                  box
                  {calc.parcelGroups.reduce((sum, group) => sum + group.count, 0) === 1 ? '' : 'es'}
                  {' · '}
                  {formatKg(calc.chargeableKg)}
                  {' '}
                  kg chargeable
                  {calc.rawTotal > 0 ? ` · ${formatCurrency(calc.rawTotal)}` : ''}
                </em>
              </div>
              <ul className="order-freight-panel__calc-packing-list">
                {(() => {
                  const groupAmounts = allocateParcelGroupAmounts(
                    calc.parcelGroups,
                    calc.rawTotal,
                  );
                  return calc.parcelGroups.map((group, index) => (
                    <ParcelGroupDetailCard
                      key={`${group.kind}:${group.lengthCm}:${group.breadthCm}:${group.heightCm}:${index}`}
                      group={group}
                      index={index}
                      amountInr={groupAmounts[index] ?? 0}
                    />
                  ));
                })()}
              </ul>
            </div>
          ) : null}

          {calc.needsPackage ? (
            <p className="order-freight-panel__hint">
              <AlertTriangle size={12} aria-hidden />
              No LBH/weight — freight ₹0 for these units
            </p>
          ) : null}

          {calc.calcSteps.length > 0 ? (
            <div className="order-freight-panel__calc-stack">
              <p className="order-freight-panel__calc-packing-title">Charge stack</p>
              <ul className="order-freight-panel__calc-stack-list">
                {calc.calcSteps.map(step => (
                  <li key={`${step.label}:${step.detail ?? ''}`}>
                    <span>
                      {step.label}
                      {step.detail ? <em>{step.detail}</em> : null}
                    </span>
                    <strong>{formatCurrency(step.amountInr)}</strong>
                  </li>
                ))}
              </ul>
              <div className="order-freight-panel__calc-stack-total">
                <span>Total freight</span>
                <strong>{formatCurrency(calc.rawTotal)}</strong>
              </div>
            </div>
          ) : (
            <div className="order-freight-panel__calc-formula">
              <div className="order-freight-panel__calc-formula-labels">
                <span>Chargeable Weight</span>
                <span>×</span>
                <span>Rate</span>
              </div>
              <div className="order-freight-panel__calc-formula-values">
                <strong>
                  {formatKg(calc.chargeableKg)}
                  {' '}
                  kg
                </strong>
                <strong>
                  ×
                  {' '}
                  {calc.ratePerKg != null
                    ? `${formatCurrency(calc.ratePerKg)} / kg`
                    : (calc.rateLabel ?? '—')}
                </strong>
              </div>
              <span className="order-freight-panel__calc-formula-arrow" aria-hidden>→</span>
              <div className="order-freight-panel__calc-formula-right">
                <span>Total freight</span>
                <strong>{formatCurrency(calc.rawTotal)}</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function FreightLineRow({
  line,
  canEditPackage,
  showLineDetails,
  catalog,
  onPackageInfoChange,
}: {
  line: FreightLineBreakdown;
  canEditPackage: boolean;
  showLineDetails: boolean;
  catalog?: CatalogProduct;
  onPackageInfoChange?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
}) {
  const needsPackage = line.indication === 'missing_package'
    || line.indication === 'incomplete_package';
  const calc = showLineDetails ? lineCalcSummary(line) : null;
  const parcelGroups = showLineDetails ? (line.parcelGroups ?? []) : [];
  return (
    <li
      className={`order-freight-panel__line${needsPackage ? ' is-warn' : ''}${line.indication === 'spare_default' ? ' is-spare' : ''}${showLineDetails ? ' has-details' : ''}`}
    >
      <div className="order-freight-panel__line-main">
        <Package size={14} aria-hidden />
        <div>
          {line.indication === 'spare_default' && line.itemNames && line.itemNames.length > 0 ? (
            <>
              <strong>Spares</strong>
              <ul className="order-freight-panel__spare-names text-muted text-sm">
                {line.itemNames.map((itemName, index) => (
                  <li key={`${index}:${itemName}`}>{itemName}</li>
                ))}
              </ul>
            </>
          ) : (
            <strong>{line.name || line.sku || 'Item'}</strong>
          )}
          <p className="text-muted text-sm">{packingSummary(line)}</p>
          {parcelGroups.length > 0 ? (
            <ul className="order-freight-panel__calc-packing-list order-freight-panel__parcel-details">
              {(() => {
                const groupAmounts = allocateParcelGroupAmounts(parcelGroups, line.amountInr);
                return parcelGroups.map((group, index) => (
                  <ParcelGroupDetailCard
                    key={`${group.kind}:${index}:${group.lengthCm}x${group.breadthCm}x${group.heightCm}`}
                    group={group}
                    index={index}
                    amountInr={groupAmounts[index] ?? 0}
                  />
                ));
              })()}
            </ul>
          ) : null}
          {calc ? (
            <p className="order-freight-panel__calc text-muted text-sm">{calc}</p>
          ) : null}
          {needsPackage && (
            <p className="order-freight-panel__hint">
              <AlertTriangle size={12} aria-hidden />
              No LBH/weight — freight ₹0 for these units
            </p>
          )}
          {line.indication === 'spare_default' && line.amountInr > 0 && !showLineDetails && (
            <p className="order-freight-panel__hint">
              Spare default freight applied
            </p>
          )}
        </div>
        <strong className="order-freight-panel__line-amt">
          {formatCurrency(line.amountInr)}
        </strong>
      </div>
      {canEditPackage && needsPackage && catalog && (
        <div className="order-freight-panel__package">
          <ProductPackageInfo
            product={catalog}
            packageInfo={catalog.packageInfo}
            canEdit
            embedded
            defaultEditing
            onPackageInfoChange={info => onPackageInfoChange?.(line.productId, info)}
          />
        </div>
      )}
    </li>
  );
}

export const OrderFreightPanel: React.FC<Props> = ({
  estimate,
  canEditPackage = false,
  showFreightChargePlan = true,
  clubSites = false,
  showLineDetails: _showLineDetails,
  destinationLabel = null,
  footerNote = null,
  catalogById = {},
  allowManualFreightEntry = false,
  manualFreightAmount = null,
  onManualFreightAmountChange,
  onCourierChange,
  onPackageInfoChange,
}) => {
  const [splitupOpen, setSplitupOpen] = useState(false);

  const planLabel = ST_COURIER_ZONE_LABELS[estimate.zone] || estimate.inferredZoneLabel;
  const headerPlace = destinationLabel?.trim() || planLabel;

  const clubbedLines = useMemo((): ClubbedLine[] => {
    if (!clubSites || !estimate.usable) return [];
    return estimate.sites.flatMap(site =>
      site.lineBreakdowns.map(line => ({ ...line, site: site.site })),
    );
  }, [clubSites, estimate]);

  const clubbedNotes = useMemo(() => {
    if (!clubSites || !estimate.usable) return [] as string[];
    const notes = new Set<string>();
    for (const site of estimate.sites) {
      for (const note of site.indications) notes.add(note);
    }
    return [...notes];
  }, [clubSites, estimate]);

  const clubCourierOptions = useMemo(() => {
    if (!clubSites || !estimate.usable || estimate.sites.length === 0) return [];
    const primary = estimate.sites[0].courierOptions;
    return primary.map(opt => {
      const enabledEverywhere = estimate.sites.every(site =>
        site.courierOptions.some(o => o.partnerId === opt.partnerId && o.enabled),
      );
      const estimatedTotalInr = estimate.sites.reduce((sum, site) => {
        const siteOpt = site.courierOptions.find(o => o.partnerId === opt.partnerId);
        return sum + (siteOpt?.estimatedTotalInr ?? 0);
      }, 0);
      return {
        ...opt,
        enabled: enabledEverywhere,
        disabledReason: enabledEverywhere
          ? opt.disabledReason
          : (opt.disabledReason || 'Not available for all ship-from locations'),
        estimatedTotalInr,
      };
    });
  }, [clubSites, estimate]);

  const clubSelectedPartner = estimate.usable
    && estimate.sites.length > 0
    && estimate.sites.every(site => site.partnerId === estimate.sites[0].partnerId)
    ? estimate.sites[0].partnerId
    : null;

  const selectedUsesManualRate = useMemo(() => {
    if (!estimate.usable) return false;
    if (clubSites) {
      const opt = clubCourierOptions.find(o => o.partnerId === clubSelectedPartner);
      return Boolean(opt?.manualRate);
    }
    return estimate.sites.some(site => {
      const opt = site.courierOptions.find(o => o.partnerId === site.partnerId);
      return Boolean(opt?.manualRate);
    });
  }, [estimate, clubSites, clubCourierOptions, clubSelectedPartner]);

  const displayTotalInr = allowManualFreightEntry
    && selectedUsesManualRate
    && manualFreightAmount != null
    && Number.isFinite(manualFreightAmount)
    ? Math.round(manualFreightAmount * 100) / 100
    : estimate.totalInr;

  const clubItemCalcs = useMemo(() => {
    if (!clubSites) return [] as ItemFreightCalcView[];
    return clubbedLines.map(line => buildItemCalcView(
      line,
      line.indication === 'spare_default'
        ? `${line.site}:spare_default`
        : `${line.site}:${line.productId}:${line.indication}`,
    ));
  }, [clubSites, clubbedLines]);

  useEffect(() => {
    if (!splitupOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSplitupOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [splitupOpen]);

  if (!estimate.usable) return null;

  const splitupPopup = clubSites && splitupOpen
    ? createPortal(
      <>
        <button
          type="button"
          className="order-freight-panel__splitup-backdrop"
          aria-label="Close freight splitup"
          onClick={() => setSplitupOpen(false)}
        />
        <div
          className="order-freight-panel__splitup-dialog panel glass"
          role="dialog"
          aria-modal="true"
          aria-label="Freight splitup"
        >
          <header className="order-freight-panel__splitup-head">
            <div>
              <h4 className="order-freight-panel__splitup-title">Freight splitup</h4>
              <p className="order-freight-panel__splitup-total text-muted text-sm">
                Total {formatCurrency(estimate.totalInr)}
              </p>
            </div>
            <button
              type="button"
              className="order-freight-panel__splitup-close"
              onClick={() => setSplitupOpen(false)}
              aria-label="Close"
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <ul className="order-freight-panel__lines">
            {clubbedLines.map(line => (
              <FreightLineRow
                key={
                  line.indication === 'spare_default'
                    ? `${line.site}:spare_default`
                    : `${line.site}:${line.productId}:${line.indication}`
                }
                line={line}
                canEditPackage={false}
                showLineDetails
                catalog={catalogById[line.productId]}
              />
            ))}
          </ul>
          {clubbedNotes.length > 0 && (
            <ul className="order-freight-panel__notes text-muted text-sm">
              {clubbedNotes.map(note => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </>,
      document.body,
    )
    : null;

  return (
    <div className="order-freight-panel">
      <header className="order-freight-panel__head">
        <div className="order-freight-panel__head-copy">
          <strong>
            Freight
            {headerPlace ? ` · ${headerPlace}` : ''}
          </strong>
          {showFreightChargePlan && destinationLabel ? (
            <span className="text-muted text-sm">
              Charge plan ·
              {' '}
              {planLabel}
            </span>
          ) : null}
        </div>
        <div className="order-freight-panel__head-total">
          {clubSites && clubbedLines.length > 0 ? (
            <button
              type="button"
              className="order-freight-panel__splitup-btn"
              onClick={() => setSplitupOpen(true)}
              aria-label="View freight splitup"
              title="View freight splitup"
            >
              <Eye size={15} aria-hidden />
            </button>
          ) : null}
          <em>{formatCurrency(displayTotalInr)}</em>
        </div>
      </header>

      {clubSites ? (
        <section className="order-freight-panel__site">
          {clubCourierOptions.length > 0 ? (
            <div className="order-freight-panel__couriers" role="radiogroup" aria-label="Courier">
              {clubCourierOptions.map(opt => (
                <CourierOptionCard
                  key={opt.partnerId}
                  opt={opt}
                  selected={clubSelectedPartner === opt.partnerId}
                  name="courier-clubbed"
                  amountInr={opt.estimatedTotalInr ?? 0}
                  allowManualFreightEntry={allowManualFreightEntry}
                  manualFreightAmount={manualFreightAmount}
                  onManualFreightAmountChange={onManualFreightAmountChange}
                  onSelect={() => {
                    for (const site of estimate.sites) {
                      onCourierChange(site.site, opt.partnerId);
                    }
                  }}
                />
              ))}
            </div>
          ) : null}
          {estimate.sites.every(site => site.isPickup) ? (
            <p className="order-freight-panel__calc-pickup text-muted text-sm">
              Customer pickup — no courier freight.
            </p>
          ) : (
            <div className="order-freight-panel__calc-list">
              {clubItemCalcs.map(calc => (
                <ItemFreightCalcTile
                  key={calc.key}
                  calc={calc}
                  partnerId={clubSelectedPartner}
                />
              ))}
            </div>
          )}
          {estimate.sites.length > 0 && !estimate.sites.every(site => site.isPickup) ? (
            <div className="order-freight-panel__calc-rounded">
              <div>
                <strong>Total freight (rounded)</strong>
                <span>
                  {selectedUsesManualRate && allowManualFreightEntry
                    ? 'Manual freight for this shipment'
                    : 'Final amount for this shipment'}
                </span>
              </div>
              <em>{formatCurrency(displayTotalInr)}</em>
            </div>
          ) : null}
          {splitupPopup}
        </section>
      ) : (
        estimate.sites.map(site => {
          const itemCalcs = site.lineBreakdowns.map(line => buildItemCalcView(
            line,
            `${site.site}:${line.productId}:${line.indication}`,
            estimate.sites.length > 1 ? site.siteLabel : null,
          ));
          const packageLines = canEditPackage
            ? site.lineBreakdowns.filter(line => (
              line.indication === 'missing_package' || line.indication === 'incomplete_package'
            ))
            : [];
          return (
            <section key={site.site} className="order-freight-panel__site">
              {estimate.sites.length > 1 ? (
                <header className="order-freight-panel__site-head">
                  <strong>{site.siteLabel}</strong>
                  <span className="text-muted text-sm">{formatCurrency(site.totalInr)}</span>
                </header>
              ) : null}

              <div className="order-freight-panel__couriers" role="radiogroup" aria-label={`${site.siteLabel} courier`}>
                {site.courierOptions.map(opt => (
                  <CourierOptionCard
                    key={opt.partnerId}
                    opt={opt}
                    selected={opt.partnerId === site.partnerId}
                    name={`courier-${site.site}`}
                    amountInr={opt.estimatedTotalInr ?? 0}
                    allowManualFreightEntry={allowManualFreightEntry}
                    manualFreightAmount={manualFreightAmount}
                    onManualFreightAmountChange={onManualFreightAmountChange}
                    onSelect={() => onCourierChange(site.site, opt.partnerId)}
                  />
                ))}
              </div>

              {site.isPickup ? (
                <p className="order-freight-panel__calc-pickup text-muted text-sm">
                  Customer pickup — no courier freight.
                </p>
              ) : (
                <div className="order-freight-panel__calc-list">
                  {itemCalcs.map(calc => (
                    <ItemFreightCalcTile
                      key={calc.key}
                      calc={calc}
                      partnerId={site.partnerId}
                    />
                  ))}
                </div>
              )}

              {packageLines.length > 0 ? (
                <ul className="order-freight-panel__lines">
                  {packageLines.map(line => (
                    <FreightLineRow
                      key={`${site.site}:${line.productId}:${line.indication}`}
                      line={line}
                      canEditPackage={canEditPackage}
                      showLineDetails={false}
                      catalog={catalogById[line.productId]}
                      onPackageInfoChange={onPackageInfoChange}
                    />
                  ))}
                </ul>
              ) : null}

              {site.indications.length > 0 && (
                <ul className="order-freight-panel__notes text-muted text-sm">
                  {site.indications.map(note => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}

      {estimate.warnings.map(warning => (
        <p key={warning} className="orders-page__freight-warn text-muted text-sm">
          {warning}
        </p>
      ))}

      {footerNote ? (
        <p className="order-freight-panel__footer-note">
          <Info size={14} aria-hidden />
          <span>{footerNote}</span>
        </p>
      ) : null}
    </div>
  );
};
