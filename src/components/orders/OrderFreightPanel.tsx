import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eye, Package, X } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import {
  logisticsPartnerImage,
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
  catalogById?: Record<string, CatalogProduct | undefined>;
  onCourierChange: (site: InventorySite, partnerId: LogisticsPartnerId) => void;
  onPackageInfoChange?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
};

type ClubbedLine = FreightLineBreakdown & { site: InventorySite };

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
    parts.push('spare minimum');
  }
  return parts.join(' · ') || '—';
}

function formatKg(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

function parcelKindLabel(kind: FreightParcelGroup['kind'], count: number): string {
  if (kind === 'master_carton') {
    return count === 1 ? '1 master carton' : `${count} master cartons`;
  }
  return count === 1 ? '1 single box' : `${count} single boxes`;
}

function parcelGroupDetail(group: FreightParcelGroup): string {
  const lbh = `${group.lengthCm}×${group.breadthCm}×${group.heightCm} cm`;
  const each = group.count > 1
    ? ` · each ${formatKg(group.actualKgEach)} kg act / ${formatKg(group.volumetricKgEach)} kg vol → ${formatKg(group.chargeableKgEach)} kg chg`
    : '';
  const totals = group.count > 1
    ? ` · total chg ${formatKg(group.chargeableKgTotal)} kg`
    : ` · ${formatKg(group.actualKgEach)} kg act / ${formatKg(group.volumetricKgEach)} kg vol → ${formatKg(group.chargeableKgEach)} kg chg`;
  return `${parcelKindLabel(group.kind, group.count)} · ${lbh}${each}${totals}`;
}

function lineCalcSummary(line: FreightLineBreakdown): string | null {
  if (line.indication === 'spare_default') {
    return line.amountInr > 0
      ? `Spare minimum charge ${formatCurrency(line.amountInr)}`
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

function CourierOptionCard({
  opt,
  selected,
  name,
  amountInr,
  onSelect,
}: {
  opt: OrderCourierOption;
  selected: boolean;
  name: string;
  amountInr: number;
  onSelect: () => void;
}) {
  const logo = logisticsPartnerImage(opt.partnerId);
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
        {opt.preferred ? <em>Preferred</em> : null}
        {opt.enabled && opt.manualRate ? <em>Enter ₹ on sales order</em> : null}
        {!opt.enabled && opt.disabledReason ? <em>{opt.disabledReason}</em> : null}
      </span>
      <strong className="order-freight-panel__courier-amt">
        {!opt.enabled
          ? '—'
          : opt.manualRate && !(amountInr > 0)
            ? 'TBD'
            : formatCurrency(amountInr)}
      </strong>
    </label>
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
            <ul className="order-freight-panel__parcel-details">
              {parcelGroups.map((group, index) => (
                <li key={`${group.kind}:${index}:${group.lengthCm}x${group.breadthCm}x${group.heightCm}`}>
                  {parcelGroupDetail(group)}
                </li>
              ))}
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
  showLineDetails,
  catalogById = {},
  onCourierChange,
  onPackageInfoChange,
}) => {
  const [splitupOpen, setSplitupOpen] = useState(false);

  const planLabel = ST_COURIER_ZONE_LABELS[estimate.zone] || estimate.inferredZoneLabel;
  /** Staff/admin default: detailed LBH maths. Dealers (clubbed) stay compact. */
  const lineDetails = showLineDetails ?? !clubSites;

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
    // Prefer options from the first site; mark disabled if not enabled on every site.
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
      {showFreightChargePlan ? (
        <div className="order-freight-panel__zone order-freight-panel__zone--info">
          <strong>Freight charge plan</strong>
          <span>{planLabel}</span>
        </div>
      ) : null}

      <div className="orders-page__summary-row">
        <span className="order-freight-panel__title-row">
          Freight
          {showFreightChargePlan ? (
            <span className="orders-page__freight-meta text-muted">
              {' '}· {planLabel}
            </span>
          ) : null}
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
        </span>
        <strong>{formatCurrency(estimate.totalInr)}</strong>
      </div>

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
                  onSelect={() => {
                    for (const site of estimate.sites) {
                      onCourierChange(site.site, opt.partnerId);
                    }
                  }}
                />
              ))}
            </div>
          ) : null}
          {splitupPopup}
        </section>
      ) : (
        estimate.sites.map(site => (
          <section key={site.site} className="order-freight-panel__site">
            <header className="order-freight-panel__site-head">
              <strong>{site.siteLabel}</strong>
              <span className="text-muted text-sm">{formatCurrency(site.totalInr)}</span>
            </header>

            <div className="order-freight-panel__couriers" role="radiogroup" aria-label={`${site.siteLabel} courier`}>
              {site.courierOptions.map(opt => (
                <CourierOptionCard
                  key={opt.partnerId}
                  opt={opt}
                  selected={opt.partnerId === site.partnerId}
                  name={`courier-${site.site}`}
                  amountInr={opt.estimatedTotalInr ?? 0}
                  onSelect={() => onCourierChange(site.site, opt.partnerId)}
                />
              ))}
            </div>

            <ul className="order-freight-panel__lines">
              {site.lineBreakdowns.map(line => (
                <FreightLineRow
                  key={`${site.site}:${line.productId}:${line.indication}`}
                  line={line}
                  canEditPackage={canEditPackage}
                  showLineDetails={lineDetails}
                  catalog={catalogById[line.productId]}
                  onPackageInfoChange={onPackageInfoChange}
                />
              ))}
            </ul>

            {site.indications.length > 0 && (
              <ul className="order-freight-panel__notes text-muted text-sm">
                {site.indications.map(note => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}

      {estimate.warnings.map(warning => (
        <p key={warning} className="orders-page__freight-warn text-muted text-sm">
          {warning}
        </p>
      ))}
    </div>
  );
};
