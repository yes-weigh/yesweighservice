import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { OrderFreightPanel } from '../orders/OrderFreightPanel';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import {
  FREIGHT_LINE_OPTIONS,
  freightOptionByProductId,
  freightOptionBySku,
  type FreightLineSku,
} from '../../constants/freightLines';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import {
  freightSkuForPartner,
  isPickupPartner,
  partnerIdForFreightSku,
} from '../../lib/orderFreight';
import type { InventorySite } from '../../lib/salesOrderSegments';
import {
  cartLinesForFreightEstimate,
  estimateStCourierCartFreight,
  type StCourierCartFreightEstimate,
} from '../../lib/stCourierCartFreight';
import { inferStCourierZone, type StCourierDestination } from '../../lib/stCourierZone';
import type { CatalogProduct } from '../../types/catalog';
import type { LogisticsCourierRates } from '../../types/logistics-courier-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../types/logistics-delivery-rules';
import type { DraftEditLine } from './SalesOrderDraftLineEditor';
import { isFreightDraftEditLine } from './SalesOrderDraftLineEditor';

function freightDraftLine(sku: FreightLineSku, rate: number): DraftEditLine {
  const option = FREIGHT_LINE_OPTIONS.find(row => row.sku === sku)!;
  const nextRate = Math.round(rate * 100) / 100;
  return {
    lineId: 'freight-line',
    productId: option.productId,
    name: option.name,
    sku: option.sku,
    description: null,
    imageUrl: option.image,
    catalogRate: nextRate,
    gatcFeePerUnit: 0,
    gatcStampingPriceId: null,
    gatcStampingRange: null,
    rate: nextRate,
    unit: 'pcs',
    quantity: 1,
    stockStatus: null,
    categoryName: null,
    categoryId: null,
  };
}

type Props = {
  lines: DraftEditLine[];
  onChangeLines: (lines: DraftEditLine[]) => void;
  catalogById: Record<string, CatalogProduct | undefined>;
  shippingDestination: StCourierDestination | null;
  canEditPackage?: boolean;
  disabled?: boolean;
  onPackageInfoSaved?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
};

export const SoFreightExpandPanel: React.FC<Props> = ({
  lines,
  onChangeLines,
  catalogById,
  shippingDestination,
  canEditPackage = false,
  disabled = false,
  onPackageInfoSaved,
}) => {
  const productLines = useMemo(
    () => lines.filter(line => !isFreightDraftEditLine(line)),
    [lines],
  );
  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [spareFreightMinimumInr, setSpareFreightMinimumInr] = useState(0);
  const [courierBySite, setCourierBySite] = useState<Partial<Record<InventorySite, LogisticsPartnerId>>>({});
  const [freightSku, setFreightSku] = useState<string | null>(null);
  const [freightAmount, setFreightAmount] = useState('');
  const [freightAmountManual, setFreightAmountManual] = useState(false);
  const hydratedRef = useRef(false);
  const lastAutoKeyRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadLogisticsCourierRates(), loadLogisticsSettings()])
      .then(([rates, settings]) => {
        if (cancelled) return;
        setCourierRates(rates);
        setDeliveryRules(settings.deliveryRules);
        setSpareFreightMinimumInr(settings.spareFreightMinimumInr);
      })
      .catch(() => { /* optional */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const freight = lines.find(isFreightDraftEditLine);
    if (!freight) return;
    const option = freightOptionByProductId(freight.productId)
      || freightOptionBySku(freight.sku);
    setFreightSku(option?.sku ?? null);
    setFreightAmount(String(freight.catalogRate ?? freight.rate ?? ''));
    const partner = partnerIdForFreightSku(option?.sku);
    if (partner) {
      setCourierBySite({ cochin: partner, head_office: partner });
    }
  }, [lines]);

  const inferredZone = useMemo(
    () => inferStCourierZone(shippingDestination),
    [shippingDestination],
  );

  const freightEstimate = useMemo((): StCourierCartFreightEstimate | null => {
    if (!courierRates || !deliveryRules || productLines.length === 0) return null;
    if (!shippingDestination || !inferredZone) return null;
    return estimateStCourierCartFreight({
      lines: cartLinesForFreightEstimate(productLines, catalogById),
      destination: shippingDestination,
      rates: courierRates,
      deliveryRules,
      spareFreightMinimumInr,
      courierBySite,
    });
  }, [
    courierRates,
    deliveryRules,
    spareFreightMinimumInr,
    productLines,
    catalogById,
    shippingDestination,
    courierBySite,
    inferredZone,
  ]);

  const applyFreight = (sku: string | null, amountRaw: string) => {
    const withoutFreight = lines.filter(line => !isFreightDraftEditLine(line));
    const option = freightOptionBySku(sku);
    const trimmed = amountRaw.trim();
    const rate = Math.round(Number(trimmed) * 100) / 100;
    if (!option || trimmed === '' || !Number.isFinite(rate) || rate < 0) {
      onChangeLines(withoutFreight);
      return;
    }
    const existingFreight = lines.find(isFreightDraftEditLine);
    const next = freightDraftLine(option.sku, rate);
    if (existingFreight?.lineId && existingFreight.lineId !== 'freight-line') {
      next.lineId = existingFreight.lineId;
    }
    onChangeLines([...withoutFreight, next]);
  };

  useEffect(() => {
    if (!freightEstimate?.usable || freightAmountManual || disabled) return;
    const site = freightEstimate.sites[0];
    if (!site) return;
    const withoutFreight = lines.filter(line => !isFreightDraftEditLine(line));

    if (isPickupPartner(site.partnerId) || site.isPickup) {
      const key = `${site.site}:pickup`;
      if (lastAutoKeyRef.current === key) return;
      lastAutoKeyRef.current = key;
      setFreightSku(null);
      setFreightAmount('');
      if (lines.some(isFreightDraftEditLine)) onChangeLines(withoutFreight);
      return;
    }

    const sku = freightSkuForPartner(site.partnerId);
    if (!sku) return;
    const rate = Math.round(freightEstimate.totalInr * 100) / 100;
    const key = `all:${site.partnerId}:${rate}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;

    setFreightSku(sku);
    setFreightAmount(String(rate));
    const current = lines.find(isFreightDraftEditLine);
    if (
      current
      && String(current.sku || '').toUpperCase() === sku
      && Math.round((current.catalogRate ?? current.rate) * 100) / 100 === rate
    ) {
      return;
    }
    applyFreight(sku, String(rate));
    // Sync freight from estimate when courier / package / lines change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freightEstimate, freightAmountManual, disabled]);

  return (
    <div className="so-freight-expand" id="so-draft-freight">
      <h4 className="so-freight-expand__title">Freight splitup</h4>
      {freightEstimate?.usable ? (
        <OrderFreightPanel
          estimate={freightEstimate}
          canEditPackage={canEditPackage && !disabled}
          showFreightChargePlan
          catalogById={catalogById}
          onCourierChange={(site, partnerId) => {
            setFreightAmountManual(false);
            lastAutoKeyRef.current = '';
            setCourierBySite(prev => ({ ...prev, [site]: partnerId }));
          }}
          onPackageInfoChange={(productId, info) => {
            setFreightAmountManual(false);
            lastAutoKeyRef.current = '';
            onPackageInfoSaved?.(productId, info);
          }}
        />
      ) : (
        <p className="text-muted text-sm">
          {shippingDestination
            ? 'Freight estimate unavailable for this destination yet.'
            : 'Shipping address needed to calculate courier freight.'}
        </p>
      )}
      {freightSku ? (
        <label className="so-freight-expand__amount">
          <span className="text-muted text-sm">Freight amount (editable)</span>
          <DecimalAmountInput
            className="input-field"
            min={0}
            decimals={2}
            allowEmpty
            placeholder="0.00"
            value={(() => {
              const trimmed = freightAmount.trim();
              if (!trimmed) return null;
              const n = Number(trimmed);
              return Number.isFinite(n) ? n : null;
            })()}
            disabled={disabled}
            aria-label="Freight amount"
            onChange={next => {
              setFreightAmountManual(true);
              const value = next == null ? '' : String(next);
              setFreightAmount(value);
              applyFreight(freightSku, value);
            }}
          />
        </label>
      ) : null}
    </div>
  );
};
