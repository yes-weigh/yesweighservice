import React from 'react';
import { AlertTriangle, Package } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import type { StCourierCartFreightEstimate } from '../../lib/stCourierCartFreight';
import type { InventorySite } from '../../lib/salesOrderSegments';
import type { CatalogProduct } from '../../types/catalog';
import {
  ST_COURIER_ZONE_LABELS,
  ST_COURIER_ZONES,
  type StCourierZone,
} from '../../types/logistics-courier-rates';
import { ProductPackageInfo } from '../catalog/ProductPackageInfo';

type Props = {
  estimate: StCourierCartFreightEstimate;
  /** Staff/admin can fill missing package dims. */
  canEditPackage?: boolean;
  catalogById?: Record<string, CatalogProduct | undefined>;
  onCourierChange: (site: InventorySite, partnerId: LogisticsPartnerId) => void;
  onPackageInfoChange?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
  /** Effective freight charge plan (may differ from address-inferred). */
  selectedZone: StCourierZone;
  zoneOverrideReason: string;
  onZoneChange: (zone: StCourierZone) => void;
  onZoneOverrideReasonChange: (reason: string) => void;
  /** When true, changing zone away from inferred requires a reason. */
  requireZoneOverrideReason?: boolean;
};

function packingSummary(b: StCourierCartFreightEstimate['sites'][number]['lineBreakdowns'][number]): string {
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

export const OrderFreightPanel: React.FC<Props> = ({
  estimate,
  canEditPackage = false,
  catalogById = {},
  onCourierChange,
  onPackageInfoChange,
  selectedZone,
  zoneOverrideReason,
  onZoneChange,
  onZoneOverrideReasonChange,
  requireZoneOverrideReason = true,
}) => {
  if (!estimate.usable) return null;

  const zoneOverridden = selectedZone !== estimate.inferredZone;
  const reasonMissing = requireZoneOverrideReason
    && zoneOverridden
    && !zoneOverrideReason.trim();

  return (
    <div className="order-freight-panel">
      <div className="order-freight-panel__zone">
        <div className="order-freight-panel__zone-head">
          <strong>Freight charge plan</strong>
          <span className="text-muted text-sm">
            From address: {estimate.inferredZoneLabel}
          </span>
        </div>
        <div
          className="order-freight-panel__zone-options"
          role="radiogroup"
          aria-label="Freight charge plan"
        >
          {ST_COURIER_ZONES.map(zone => {
            const selected = zone === selectedZone;
            const fromAddress = zone === estimate.inferredZone;
            return (
              <label
                key={zone}
                className={`order-freight-panel__zone-option${selected ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="freight-charge-plan"
                  checked={selected}
                  onChange={() => onZoneChange(zone)}
                />
                <span>
                  {ST_COURIER_ZONE_LABELS[zone]}
                  {fromAddress ? <em>From address</em> : null}
                </span>
              </label>
            );
          })}
        </div>
        {zoneOverridden ? (
          <label className="order-freight-panel__zone-reason">
            <span>
              Reason for changing plan
              {requireZoneOverrideReason ? ' (required)' : ''}
            </span>
            <textarea
              className="input-field"
              rows={2}
              value={zoneOverrideReason}
              onChange={e => onZoneOverrideReasonChange(e.target.value)}
              placeholder={`Why use ${ST_COURIER_ZONE_LABELS[selectedZone]} instead of ${estimate.inferredZoneLabel}?`}
              maxLength={500}
            />
            {reasonMissing ? (
              <span className="order-freight-panel__zone-reason-error">
                Enter a reason to use a different freight plan.
              </span>
            ) : null}
          </label>
        ) : null}
      </div>

      <div className="orders-page__summary-row">
        <span>
          Freight
          <span className="orders-page__freight-meta text-muted">
            {' '}· {ST_COURIER_ZONE_LABELS[selectedZone]}
            {zoneOverridden ? ' (overridden)' : ''}
          </span>
        </span>
        <strong>{formatCurrency(estimate.totalInr)}</strong>
      </div>

      {estimate.sites.map(site => (
        <section key={site.site} className="order-freight-panel__site">
          <header className="order-freight-panel__site-head">
            <strong>{site.siteLabel}</strong>
            <span className="text-muted text-sm">{formatCurrency(site.totalInr)}</span>
          </header>

          <div className="order-freight-panel__couriers" role="radiogroup" aria-label={`${site.siteLabel} courier`}>
            {site.courierOptions.map(opt => {
              const selected = opt.partnerId === site.partnerId;
              return (
                <label
                  key={opt.partnerId}
                  className={`order-freight-panel__courier${selected ? ' is-selected' : ''}${opt.enabled ? '' : ' is-disabled'}`}
                  title={opt.disabledReason ?? undefined}
                >
                  <input
                    type="radio"
                    name={`courier-${site.site}`}
                    checked={selected}
                    disabled={!opt.enabled}
                    onChange={() => onCourierChange(site.site, opt.partnerId)}
                  />
                  <span>
                    {opt.label}
                    {opt.preferred ? <em>Preferred</em> : null}
                    {!opt.enabled && opt.disabledReason ? <em>{opt.disabledReason}</em> : null}
                  </span>
                </label>
              );
            })}
          </div>

          <ul className="order-freight-panel__lines">
            {site.lineBreakdowns.map(line => {
              const catalog = catalogById[line.productId];
              const needsPackage = line.indication === 'missing_package'
                || line.indication === 'incomplete_package';
              return (
                <li
                  key={`${site.site}:${line.productId}:${line.indication}`}
                  className={`order-freight-panel__line${needsPackage ? ' is-warn' : ''}${line.indication === 'spare_default' ? ' is-spare' : ''}`}
                >
                  <div className="order-freight-panel__line-main">
                    <Package size={14} aria-hidden />
                    <div>
                      <strong>{line.name || line.sku || 'Item'}</strong>
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
            })}
          </ul>

          {site.indications.length > 0 && (
            <ul className="order-freight-panel__notes text-muted text-sm">
              {site.indications.map(note => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {estimate.warnings.map(warning => (
        <p key={warning} className="orders-page__freight-warn text-muted text-sm">
          {warning}
        </p>
      ))}
    </div>
  );
};

/** True when freight plan override needs a non-empty reason before submit. */
export function freightZoneOverrideReasonRequired(
  estimate: StCourierCartFreightEstimate | null | undefined,
  selectedZone: StCourierZone | null | undefined,
  reason: string,
): boolean {
  if (!estimate?.usable || !selectedZone) return false;
  if (selectedZone === estimate.inferredZone) return false;
  return !reason.trim();
}
