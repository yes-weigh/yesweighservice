import React, { useMemo } from 'react';
import { AlertTriangle, Package } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import {
  logisticsPartnerImage,
  type LogisticsPartnerId,
} from '../../constants/logisticsPartners';
import type {
  FreightLineBreakdown,
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
        {!opt.enabled && opt.disabledReason ? <em>{opt.disabledReason}</em> : null}
      </span>
      <strong className="order-freight-panel__courier-amt">
        {opt.enabled ? formatCurrency(amountInr) : '—'}
      </strong>
    </label>
  );
}

function FreightLineRow({
  line,
  canEditPackage,
  catalog,
  onPackageInfoChange,
}: {
  line: FreightLineBreakdown;
  canEditPackage: boolean;
  catalog?: CatalogProduct;
  onPackageInfoChange?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
}) {
  const needsPackage = line.indication === 'missing_package'
    || line.indication === 'incomplete_package';
  return (
    <li
      className={`order-freight-panel__line${needsPackage ? ' is-warn' : ''}${line.indication === 'spare_default' ? ' is-spare' : ''}`}
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
          {needsPackage && (
            <p className="order-freight-panel__hint">
              <AlertTriangle size={12} aria-hidden />
              No LBH/weight — freight ₹0 for these units
            </p>
          )}
          {line.indication === 'spare_default' && line.amountInr > 0 && (
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
  catalogById = {},
  onCourierChange,
  onPackageInfoChange,
}) => {
  if (!estimate.usable) return null;

  const planLabel = ST_COURIER_ZONE_LABELS[estimate.zone] || estimate.inferredZoneLabel;

  const clubbedLines = useMemo((): ClubbedLine[] => {
    if (!clubSites) return [];
    return estimate.sites.flatMap(site =>
      site.lineBreakdowns.map(line => ({ ...line, site: site.site })),
    );
  }, [clubSites, estimate.sites]);

  const clubbedNotes = useMemo(() => {
    if (!clubSites) return [] as string[];
    const notes = new Set<string>();
    for (const site of estimate.sites) {
      for (const note of site.indications) notes.add(note);
    }
    return [...notes];
  }, [clubSites, estimate.sites]);

  const clubCourierOptions = useMemo(() => {
    if (!clubSites || estimate.sites.length === 0) return [];
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
  }, [clubSites, estimate.sites]);

  const clubSelectedPartner = estimate.sites.length > 0
    && estimate.sites.every(site => site.partnerId === estimate.sites[0].partnerId)
    ? estimate.sites[0].partnerId
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
        <span>
          Freight
          {showFreightChargePlan ? (
            <span className="orders-page__freight-meta text-muted">
              {' '}· {planLabel}
            </span>
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

          <ul className="order-freight-panel__lines">
            {clubbedLines.map(line => (
              <FreightLineRow
                key={
                  line.indication === 'spare_default'
                    ? `${line.site}:spare_default`
                    : `${line.site}:${line.productId}:${line.indication}`
                }
                line={line}
                canEditPackage={canEditPackage}
                catalog={catalogById[line.productId]}
                onPackageInfoChange={onPackageInfoChange}
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
