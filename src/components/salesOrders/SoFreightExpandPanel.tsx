import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { OrderFreightPanel } from '../orders/OrderFreightPanel';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
} from '../../constants/logisticsPartners';
import {
  FREIGHT_LINE_OPTIONS,
  freightOptionByProductId,
  freightOptionBySku,
  type FreightLineSku,
} from '../../constants/freightLines';
import { useBlueDartPincode } from '../../hooks/useBlueDartPincode';
import { useDelhiveryLiveFreightQuote } from '../../hooks/useDelhiveryLiveFreightQuote';
import { DelhiveryQuoteStrip } from '../logistics/DelhiveryQuoteStrip';
import { selectedPartnerIsDelhivery } from '../../lib/delhiveryCartFreight';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import {
  freightSkuForPartner,
  isPickupPartner,
  partnerIdForFreightSku,
  PICKUP_PARTNER_ID,
} from '../../lib/orderFreight';
import {
  classifyOrderLineSegment,
  type InventorySite,
} from '../../lib/salesOrderSegments';
import {
  applyCourierSelectionForSite,
  cartLinesAreSpareOnly,
  cartLinesForFreightEstimate,
  estimateStCourierCartFreight,
  type StCourierCartFreightEstimate,
} from '../../lib/stCourierCartFreight';
import { inferStCourierZone, type StCourierDestination } from '../../lib/stCourierZone';
import type { CatalogProduct } from '../../types/catalog';
import type { LogisticsCourierRates } from '../../types/logistics-courier-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../types/logistics-partner-status';
import type { SpareBoxDefinition } from '../../types/spare-box-definitions';
import type { StaffLogisticsSite } from '../../types/staff-logistics';
import { isFreightDraftEditLine, withFreightDraftLinesLast } from './SalesOrderDraftLineEditor';
import type { DraftEditLine } from './SalesOrderDraftLineEditor';
import {
  createEmptySpareFreightPackagingDraft,
  SpareFreightPackagingFields,
  spareFreightPackagingsFromDrafts,
  type SpareFreightPackagingDraft,
  type SpareFreightPartnerQuoteNote,
} from './SpareFreightPackagingFields';
import type { SpareFreightPackaging } from '../../lib/spareFreightQuote';

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
  /** When false, still auto-sync freight into lines but render nothing (keep mounted while editing). */
  showUi?: boolean;
  onPackageInfoSaved?: (productId: string, info: NonNullable<CatalogProduct['packageInfo']>) => void;
  /** Persist admin-entered spare carton LBH + weight for later invoicing/logistics. */
  onSparePackagingChange?: (next: SpareFreightPackaging[] | null) => void;
};

export const SoFreightExpandPanel: React.FC<Props> = ({
  lines,
  onChangeLines,
  catalogById,
  shippingDestination,
  canEditPackage = false,
  disabled = false,
  showUi = true,
  onPackageInfoSaved,
  onSparePackagingChange,
}) => {
  const productLines = useMemo(
    () => lines.filter(line => !isFreightDraftEditLine(line)),
    [lines],
  );
  const productLinesKey = useMemo(
    () => productLines.map(line => `${line.productId}:${line.quantity}:${line.sku || ''}`).join('|'),
    [productLines],
  );
  const destinationKey = useMemo(
    () => [
      shippingDestination?.state ?? '',
      shippingDestination?.city ?? '',
      shippingDestination?.zip ?? '',
    ].join('|'),
    [shippingDestination],
  );
  const freightInputsKey = `${productLinesKey}::${destinationKey}`;

  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [partnerStatuses, setPartnerStatuses] = useState<LogisticsPartnerStatuses | null>(null);
  const [spareBoxDefinitions, setSpareBoxDefinitions] = useState<SpareBoxDefinition[]>([]);
  const [sparePackagingDrafts, setSparePackagingDrafts] = useState<SpareFreightPackagingDraft[]>(
    () => [createEmptySpareFreightPackagingDraft()],
  );
  const [courierBySite, setCourierBySite] = useState<Partial<Record<InventorySite, LogisticsPartnerId>>>({});
  const [fromAddresses, setFromAddresses] = useState<Partial<Record<StaffLogisticsSite, string>>>({});
  const [freightSku, setFreightSku] = useState<string | null>(null);
  const [freightAmount, setFreightAmount] = useState('');
  const [freightAmountManual, setFreightAmountManual] = useState(false);
  const [freightBillingMode, setFreightBillingMode] = useState<'btc' | 'fod'>('btc');
  const hydratedRef = useRef(false);
  const lastAutoKeyRef = useRef('');
  const prevFreightInputsKeyRef = useRef(freightInputsKey);
  /** Wait until existing SO freight/pickup is seeded — otherwise empty courierBySite defaults to ST. */
  const [partnersReady, setPartnersReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadLogisticsCourierRates(), loadLogisticsSettings()])
      .then(([rates, settings]) => {
        if (cancelled) return;
        setCourierRates(rates);
        setDeliveryRules(settings.deliveryRules);
        setPartnerStatuses(settings.partnerStatuses);
        setSpareBoxDefinitions(settings.spareBoxDefinitions || []);
        setFromAddresses(settings.fromAddresses || {});
      })
      .catch(() => { /* optional */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    // Wait until lines hydrate — first paint can be empty on SO detail.
    if (lines.length === 0) return;
    hydratedRef.current = true;
    const freight = lines.find(isFreightDraftEditLine);
    if (!freight) {
      // Dealer customer pickup (and deferred spare freight) leave no freight SKU.
      // Do not fall through to ST — that is only the preferred default for new carts.
      setCourierBySite({
        cochin: PICKUP_PARTNER_ID,
        head_office: PICKUP_PARTNER_ID,
      });
      setPartnersReady(true);
      return;
    }
    const option = freightOptionByProductId(freight.productId)
      || freightOptionBySku(freight.sku);
    // Prefer line.rate — catalogRate can be 0 for freight SKUs in the product catalog.
    const existingRate = Math.round(Number(freight.rate || freight.catalogRate || 0) * 100) / 100;
    setFreightSku(option?.sku ?? null);
    setFreightAmount(Number.isFinite(existingRate) ? String(existingRate) : '');
    // Keep Zoho/manual freight amounts — auto-estimate must not overwrite them with ₹0.
    if (Number.isFinite(existingRate) && existingRate > 0) {
      setFreightAmountManual(true);
    }
    const partner = partnerIdForFreightSku(option?.sku);
    if (partner) {
      setCourierBySite({ cochin: partner, head_office: partner });
    }
    if (partner === 'delhivery' && existingRate === 0) {
      setFreightBillingMode('fod');
      setFreightAmountManual(false);
    } else if (partner === 'delhivery') {
      setFreightBillingMode('btc');
    }
    setPartnersReady(true);
  }, [lines]);

  // Line qty/add/remove or destination change → resume auto freight (don't keep a stale manual ₹).
  useEffect(() => {
    if (prevFreightInputsKeyRef.current === freightInputsKey) return;
    prevFreightInputsKeyRef.current = freightInputsKey;
    const freight = lines.find(isFreightDraftEditLine);
    const existingRate = freight
      ? Math.round(Number(freight.rate || freight.catalogRate || 0) * 100) / 100
      : 0;
    // Destination hydrate must not unlock overwrite of an existing charged freight line.
    if (existingRate > 0) {
      setFreightAmountManual(true);
    } else {
      setFreightAmountManual(false);
    }
    lastAutoKeyRef.current = '';
  }, [freightInputsKey, lines]);

  const inferredZone = useMemo(
    () => inferStCourierZone(shippingDestination),
    [shippingDestination],
  );
  const blueDartPin = useBlueDartPincode(shippingDestination?.zip);

  const goodsSubtotal = useMemo(
    () => productLines.reduce((sum, line) => sum + line.rate * line.quantity, 0),
    [productLines],
  );

  const cartHasSpare = useMemo(
    () => productLines.some((line) => {
      const catalog = catalogById[line.productId];
      return classifyOrderLineSegment({
        productId: line.productId,
        sku: line.sku,
        categoryId: catalog?.categoryId ?? line.categoryId,
        categoryName: catalog?.categoryName ?? line.categoryName,
      }) === 'spare';
    }),
    [productLines, catalogById],
  );

  const sparePackaging = useMemo(
    () => (cartHasSpare ? spareFreightPackagingsFromDrafts(sparePackagingDrafts) : null),
    [cartHasSpare, sparePackagingDrafts],
  );

  useEffect(() => {
    onSparePackagingChange?.(sparePackaging);
  }, [onSparePackagingChange, sparePackaging]);

  const freightEstimateBase = useMemo((): StCourierCartFreightEstimate | null => {
    if (!courierRates || !deliveryRules || !partnerStatuses || productLines.length === 0) return null;
    const freightCartLines = cartLinesForFreightEstimate(productLines, catalogById);
    const spareOnlyCart = cartLinesAreSpareOnly(freightCartLines);
    if (!spareOnlyCart && (!shippingDestination || !inferredZone)) return null;
    return estimateStCourierCartFreight({
      lines: freightCartLines,
      destination: shippingDestination,
      rates: courierRates,
      deliveryRules,
      partnerStatuses,
      courierBySite,
      blueDartPin,
      invoiceValueInr: goodsSubtotal,
      sparePackaging,
      requireSparePackaging: cartHasSpare,
    });
  }, [
    courierRates,
    deliveryRules,
    partnerStatuses,
    productLines,
    catalogById,
    shippingDestination,
    courierBySite,
    inferredZone,
    blueDartPin,
    goodsSubtotal,
    sparePackaging,
    cartHasSpare,
  ]);

  const delhiveryLive = useDelhiveryLiveFreightQuote({
    estimate: freightEstimateBase,
    originAddress: fromAddresses.cochin || fromAddresses.head_office || '',
    destinationPin: shippingDestination?.zip,
    invoiceValueInr: goodsSubtotal,
    freightBillingMode,
  });

  const freightEstimate = delhiveryLive.estimateWithLive ?? freightEstimateBase;

  const spareVolumetricDivisor = useMemo(() => {
    if (!courierRates) return 5000;
    const site = freightEstimateBase?.sites[0];
    const partnerId = site?.partnerId;
    if (!partnerId || isPickupPartner(partnerId)) return 5000;
    if (isBlueDartLogisticsPartnerId(partnerId)) {
      const service = blueDartServiceForPartner(partnerId) ?? 'domestic_priority';
      if (service === 'domestic_priority') {
        return Number(courierRates.bluedart.domestic_priority.volumetricDivisor) || 5000;
      }
      return Number(courierRates.bluedart[service].volumetricDivisor) || 5000;
    }
    if (isTrackonLogisticsPartnerId(partnerId)) {
      return Number(courierRates.trackon.shared.volumetricDivisor) || 5000;
    }
    const origin = partnerId === 'delhivery'
      ? courierRates.delhivery
      : courierRates.st_courier[site?.site ?? 'head_office'];
    return Number(origin?.volumetricDivisor) || 4500;
  }, [courierRates, freightEstimateBase]);

  const sparePartnerQuotes = useMemo((): SpareFreightPartnerQuoteNote[] => {
    const site = freightEstimateBase?.sites[0];
    if (!site?.hasSpare) return [];
    return site.courierOptions
      .filter(opt => !isPickupPartner(opt.partnerId))
      .map(opt => ({
        partnerId: opt.partnerId,
        label: opt.label,
        amountInr: Number(opt.estimatedTotalInr) || 0,
        volumetricKg: opt.estimatedVolumetricKg ?? null,
        chargeableKg: opt.estimatedChargeableKg ?? null,
        enabled: opt.enabled,
      }));
  }, [freightEstimateBase]);

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
    onChangeLines(withFreightDraftLinesLast([...withoutFreight, next]));
  };

  useEffect(() => {
    if (!partnersReady) return;
    if (!freightEstimate?.usable || freightAmountManual || disabled) return;
    const site = freightEstimate.sites[0];
    if (!site) return;
    const withoutFreight = lines.filter(line => !isFreightDraftEditLine(line));
    const current = lines.find(isFreightDraftEditLine);
    const currentAmount = current
      ? Math.round(Number(current.rate || current.catalogRate || 0) * 100) / 100
      : 0;

    if (isPickupPartner(site.partnerId) || site.isPickup) {
      // Hidden SO detail panel: never strip an existing charged freight line.
      if (!showUi && currentAmount > 0) return;
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
    const delhiveryFod = site.partnerId === 'delhivery' && freightBillingMode === 'fod';
    const rate = delhiveryFod
      ? 0
      : (Math.ceil(Number(freightEstimate.totalInr) || 0) || 0);
    const selectedOpt = site.courierOptions.find(o => o.partnerId === site.partnerId);
    // FOD: keep Delhivery freight line at ₹0.
    if (delhiveryFod) {
      const key = `all:delhivery:fod:0`;
      if (lastAutoKeyRef.current === key) return;
      lastAutoKeyRef.current = key;
      setFreightSku(sku);
      setFreightAmount('0');
      if (!(current && String(current.sku || '').toUpperCase() === sku && currentAmount === 0)) {
        applyFreight(sku, '0');
      }
      return;
    }
    // Never clobber an existing freight line with a zero estimate
    // (common for Manual partners like Delhivery with no rate card).
    if (rate === 0 && current) {
      setFreightAmountManual(true);
      setFreightSku(String(current.sku || sku).toUpperCase());
      setFreightAmount(String(currentAmount));
      lastAutoKeyRef.current = `all:${site.partnerId}:keep:${currentAmount}`;
      return;
    }
    // Live Delhivery quote arrives async — don't invent ₹0 while waiting.
    if (rate === 0 && (selectedOpt?.liveApiRate || site.partnerId === 'delhivery')) return;
    // Hidden SO detail panel: only auto-apply real quotes, never invent ₹0 freight.
    if (!showUi && rate === 0) return;
    const key = `all:${site.partnerId}:${rate}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;

    setFreightSku(sku);
    setFreightAmount(String(rate));
    if (
      current
      && String(current.sku || '').toUpperCase() === sku
      && currentAmount === rate
    ) {
      return;
    }
    applyFreight(sku, String(rate));
    // Sync freight from estimate when courier / package / lines change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnersReady, freightEstimate, freightAmountManual, disabled, showUi, freightBillingMode]);

  useEffect(() => {
    if (!partnersReady) return;
    if (freightAmountManual || disabled) return;
    if (!selectedPartnerIsDelhivery(freightEstimate)) return;
    if (freightBillingMode === 'fod') return;
    if (delhiveryLive.preTaxInr == null) return;
    const sku = freightSkuForPartner('delhivery');
    if (!sku) return;
    const rate = Math.ceil(delhiveryLive.preTaxInr) || 0;
    if (rate <= 0) return;
    const key = `delhivery-live:${rate}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;
    setFreightSku(sku);
    setFreightAmount(String(rate));
    applyFreight(sku, String(rate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnersReady, delhiveryLive.preTaxInr, freightEstimate, freightAmountManual, disabled, freightBillingMode]);

  const showDelhiveryQuote = selectedPartnerIsDelhivery(freightEstimate)
    && Boolean(shippingDestination?.zip);

  const needsFreightEntryAlert = Boolean(
    freightEstimate?.usable
    && !freightEstimate.sites.every(site => site.isPickup || isPickupPartner(site.partnerId))
    && !(freightBillingMode === 'fod' && selectedPartnerIsDelhivery(freightEstimate))
    && !(Number(freightAmount) > 0)
    && !disabled,
  );

  if (!showUi) return null;

  return (
    <div className="so-freight-expand" id="so-draft-freight">
      {needsFreightEntryAlert ? (
        <p className="so-freight-expand__alert" role="alert">
          <AlertTriangle size={15} aria-hidden />
          <span>
            Non–Customer Pickup: enter freight data (box / L×B×H for auto calc, or freight ₹)
            before confirming this sales order.
          </span>
        </p>
      ) : null}
      {cartHasSpare && !disabled ? (
        <SpareFreightPackagingFields
          drafts={sparePackagingDrafts}
          definitions={spareBoxDefinitions}
          disabled={disabled}
          volumetricDivisor={spareVolumetricDivisor}
          partnerQuotes={sparePartnerQuotes}
          onChange={next => {
            setSparePackagingDrafts(next);
            setFreightAmountManual(false);
            lastAutoKeyRef.current = '';
          }}
        />
      ) : null}
      {freightEstimate?.usable ? (
        <OrderFreightPanel
          estimate={freightEstimate}
          canEditPackage={canEditPackage && !disabled}
          showFreightChargePlan
          allowManualFreightEntry={!disabled && freightBillingMode !== 'fod'}
          manualFreightAmount={(() => {
            const trimmed = freightAmount.trim();
            if (!trimmed) return null;
            const n = Number(trimmed);
            return Number.isFinite(n) ? n : null;
          })()}
          freightBillingMode={freightBillingMode}
          onFreightBillingModeChange={mode => {
            setFreightBillingMode(mode);
            setFreightAmountManual(false);
            lastAutoKeyRef.current = '';
            if (mode === 'fod') {
              const sku = freightSkuForPartner('delhivery');
              if (sku) {
                setFreightSku(sku);
                setFreightAmount('0');
                applyFreight(sku, '0');
              }
            }
          }}
          catalogById={catalogById}
          destinationLabel={[
            shippingDestination?.city,
            shippingDestination?.state,
          ].filter(Boolean).join(', ') || null}
          footerNote="One freight line per draft SO. Delhivery BTC uses the live B2B estimate; FOD keeps the Delhivery line at ₹0."
          onManualFreightAmountChange={next => {
            const sku = freightSku
              || freightSkuForPartner(freightEstimate.sites[0]?.partnerId)
              || null;
            if (!sku) return;
            setFreightAmountManual(true);
            const value = next == null ? '' : String(next);
            setFreightSku(sku);
            setFreightAmount(value);
            applyFreight(sku, value);
          }}
          onCourierChange={(site, partnerId) => {
            setFreightAmountManual(false);
            lastAutoKeyRef.current = '';
            if (partnerId !== 'delhivery') setFreightBillingMode('btc');
            setCourierBySite(prev => applyCourierSelectionForSite(
              prev,
              site,
              partnerId,
              freightEstimate?.sites.map(s => s.site),
            ));
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
      {showDelhiveryQuote ? (
        <DelhiveryQuoteStrip
          originPin={delhiveryLive.originPin || null}
          destinationPin={delhiveryLive.destinationPin}
          weightKg={freightEstimate?.totalChargeableKg || 5}
          invAmount={goodsSubtotal}
          freightBillingMode={freightBillingMode}
          includeEstimate={false}
          compact
        />
      ) : null}
      {freightSku && !freightEstimate?.sites.some(site => {
        const opt = site.courierOptions.find(o => o.partnerId === site.partnerId);
        return Boolean(opt?.manualRate || opt?.liveApiRate || site.partnerId === 'delhivery');
      }) ? (
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
