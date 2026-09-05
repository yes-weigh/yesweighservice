import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../types/catalog';
import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  blueDartServiceForPartner,
  isBlueDartLogisticsPartnerId,
  isTrackonLogisticsPartnerId,
  logisticsPartnerLabel,
  normalizeLogisticsPartnerId,
  trackonServiceForPartner,
} from '../constants/logisticsPartners';
import type { BlueDartPincodeDoc } from '../types/blue-dart-rates';
import type { LogisticsDeliveryRulesMatrix } from '../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../types/logistics-partner-status';
import {
  ST_COURIER_ZONE_LABELS,
  isCourierRatePartnerId,
  isStCourierZone,
  type BlueDartServiceId,
  type LogisticsCourierRates,
  type StCourierOriginRates,
  type StCourierZone,
  type TrackonServiceId,
} from '../types/logistics-courier-rates';
import {
  blueDartDpVolumetricKg,
  blueDartFreightCalcSteps,
  blueDartParcelsOversizeInr,
  blueDartPieceChargeableKg,
  ceilBlueDartDpChargeableKg,
  quoteBlueDartParcels,
  type BlueDartFreightCalcStep,
} from './blueDartQuote';
import { quoteTrackonParcels } from './trackonQuote';
import {
  isPickupPartner,
  listOrderCourierOptions,
  partnerAllowsManualFreightRate,
  partnerHasZoneRate,
  PICKUP_PARTNER_ID,
  type OrderCourierOption,
} from './orderFreight';
import {
  classifyOrderLineSegment,
  resolveLineInventorySite,
  segmentAllowsFreight,
  type InventorySite,
  type OrderSegment,
} from './salesOrderSegments';
import {
  ceilChargeableKg,
  ceilCourierChargeInr,
  stCourierVolumetricKg,
  type StCourierQuoteDims,
  type StCourierQuoteResult,
} from './stCourierQuote';
import {
  quoteSpareFreight,
  type SpareFreightPackaging,
} from './spareFreightQuote';
import {
  isTamilNaduDestination,
  inferStCourierZone,
  stCourierTamilNaduMaxChargeableExceeded,
  type StCourierDestination,
} from './stCourierZone';

export type { SpareFreightPackaging };

export type StCourierCartLine = {
  productId: string;
  name?: string | null;
  sku?: string | null;
  quantity: number;
  categoryId?: string | null;
  categoryName?: string | null;
  warehouses?: Array<{ warehouseName?: string; stock?: number }> | null;
  packageInfo?: CatalogPackageInfo | null;
};

export type StCourierParcel = {
  productId: string;
  sku: string | null;
  name: string | null;
  kind: 'master_carton' | 'single_box';
  quantityUnits: number;
  actualKg: number;
  dims: StCourierQuoteDims;
};

export type StCourierCartFreightSkip = {
  productId: string;
  sku: string | null;
  name: string | null;
  reason: 'no_package' | 'incomplete_package' | 'software' | 'zero_qty';
};

/** Grouped identical parcels for staff/admin freight line detail. */
export type FreightParcelGroup = {
  kind: 'master_carton' | 'single_box';
  count: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  actualKgEach: number;
  volumetricKgEach: number;
  chargeableKgEach: number;
  actualKgTotal: number;
  volumetricKgTotal: number;
  chargeableKgTotal: number;
};

/** Per-product packing + ₹ contribution inside a ship-from bucket. */
export type FreightLineBreakdown = {
  productId: string;
  sku: string | null;
  name: string | null;
  /** Spare freight row: all spare product names covered by this charge. */
  itemNames?: string[];
  quantity: number;
  masterCartonCount: number;
  singleBoxCount: number;
  /** Units that could not be cartonized (missing dims). */
  missingUnits: number;
  chargeableKg: number;
  amountInr: number;
  indication: 'ok' | 'missing_package' | 'incomplete_package' | 'spare_default';
  /** Staff/admin detail: LBH + weight maths. */
  actualKg?: number;
  volumetricKg?: number;
  boxPerKgInr?: number;
  fuelSurchargePercent?: number;
  volumetricDivisor?: number;
  parcelGroups?: FreightParcelGroup[];
  /** Blue Dart zone / DP zone label for calc card. */
  zoneLabel?: string | null;
  /** Domestic Priority slab rates (when not ₹/kg). */
  first500gInr?: number | null;
  addl500gInr?: number | null;
  /** Blue Dart surcharge stack (scaled to this line’s share). */
  calcSteps?: BlueDartFreightCalcStep[];
};

export type SiteFreightBucket = {
  site: InventorySite;
  siteLabel: string;
  /** product and/or spare content on this ship-from. */
  hasProduct: boolean;
  hasSpare: boolean;
  partnerId: LogisticsPartnerId;
  partnerLabel: string;
  courierOptions: OrderCourierOption[];
  isPickup: boolean;
  zone: StCourierZone;
  zoneLabel: string;
  lineBreakdowns: FreightLineBreakdown[];
  productFreightInr: number;
  spareFreightInr: number;
  totalInr: number;
  chargeableKg: number;
  parcelCount: number;
  rateMissing: boolean;
  indications: string[];
};

export type StCourierCartFreightEstimate = {
  /** Effective zone used for quoting (override if set, else inferred). */
  zone: StCourierZone;
  zoneLabel: string;
  /** Zone inferred from shipping address state/city. */
  inferredZone: StCourierZone;
  inferredZoneLabel: string;
  zoneOverridden: boolean;
  sites: SiteFreightBucket[];
  totalInr: number;
  totalChargeableKg: number;
  parcelCount: number;
  skipped: StCourierCartFreightSkip[];
  usable: boolean;
  warnings: string[];
};

function cartonDimsComplete(carton: CatalogPackageCarton | null | undefined): boolean {
  if (!carton) return false;
  return [carton.lengthCm, carton.breadthCm, carton.heightCm, carton.weightKg]
    .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

function toQuoteDims(carton: CatalogPackageCarton): StCourierQuoteDims {
  return {
    lengthCm: carton.lengthCm,
    widthCm: carton.breadthCm,
    heightCm: carton.heightCm,
  };
}

function singleBoxes(info: CatalogPackageInfo | null | undefined): CatalogPackageCarton[] {
  if (!info?.singleBox?.length) return [];
  return info.singleBox;
}

export function cartonizeCartLine(line: StCourierCartLine): {
  parcels: StCourierParcel[];
  skip: StCourierCartFreightSkip | null;
  masterCartonCount: number;
  singleBoxCount: number;
  missingUnits: number;
} {
  const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
  const sku = line.sku?.trim() || null;
  const name = line.name?.trim() || null;

  if (qty <= 0) {
    return {
      parcels: [],
      skip: { productId: line.productId, sku, name, reason: 'zero_qty' },
      masterCartonCount: 0,
      singleBoxCount: 0,
      missingUnits: 0,
    };
  }

  const segment = classifyOrderLineSegment(line);
  if (segment === 'software') {
    return {
      parcels: [],
      skip: { productId: line.productId, sku, name, reason: 'software' },
      masterCartonCount: 0,
      singleBoxCount: 0,
      missingUnits: 0,
    };
  }

  const info = line.packageInfo ?? null;
  const master = info?.masterCarton ?? null;
  const singles = singleBoxes(info).filter(cartonDimsComplete);
  const masterOk = cartonDimsComplete(master);
  const masterQty = masterOk && typeof master?.quantity === 'number' && master.quantity > 0
    ? Math.floor(master.quantity)
    : 0;

  if (!masterOk && singles.length === 0) {
    return {
      parcels: [],
      skip: {
        productId: line.productId,
        sku,
        name,
        reason: info ? 'incomplete_package' : 'no_package',
      },
      masterCartonCount: 0,
      singleBoxCount: 0,
      missingUnits: qty,
    };
  }

  const parcels: StCourierParcel[] = [];
  let remaining = qty;
  let masterCartonCount = 0;
  let singleBoxCount = 0;

  if (masterOk && master && masterQty > 0) {
    masterCartonCount = Math.floor(remaining / masterQty);
    for (let i = 0; i < masterCartonCount; i += 1) {
      parcels.push({
        productId: line.productId,
        sku,
        name,
        kind: 'master_carton',
        quantityUnits: masterQty,
        actualKg: Number(master.weightKg),
        dims: toQuoteDims(master),
      });
    }
    remaining -= masterCartonCount * masterQty;
  }

  let missingUnits = 0;
  if (remaining > 0) {
    if (singles.length === 0) {
      missingUnits = remaining;
      return {
        parcels,
        skip: {
          productId: line.productId,
          sku,
          name,
          reason: 'incomplete_package',
        },
        masterCartonCount,
        singleBoxCount,
        missingUnits,
      };
    }
    for (let u = 0; u < remaining; u += 1) {
      for (const box of singles) {
        parcels.push({
          productId: line.productId,
          sku,
          name,
          kind: 'single_box',
          quantityUnits: 1,
          actualKg: Number(box.weightKg),
          dims: toQuoteDims(box),
        });
        singleBoxCount += 1;
      }
    }
  }

  return { parcels, skip: null, masterCartonCount, singleBoxCount, missingUnits };
}

function ratesWithoutMinFloor(rates: StCourierOriginRates): StCourierOriginRates {
  return { ...rates, minimumChargeableWeightKg: 0 };
}

export function quoteStCourierParcels(input: {
  zone: StCourierZone;
  rates: StCourierOriginRates;
  parcels: StCourierParcel[];
}): {
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  quote: StCourierQuoteResult;
  rateMissing: boolean;
  perParcelChargeableKg: number[];
} {
  const perBoxRates = ratesWithoutMinFloor(input.rates);
  let actualKg = 0;
  let volumetricKg = 0;
  let chargeableBeforeMin = 0;
  const perParcelChargeableKg: number[] = [];

  for (const parcel of input.parcels) {
    actualKg += parcel.actualKg;
    const vol = stCourierVolumetricKg(parcel.dims, perBoxRates.volumetricDivisor);
    volumetricKg += vol;
    const base = perBoxRates.useChargeableWeight
      ? Math.max(parcel.actualKg, vol)
      : parcel.actualKg;
    // Per-parcel chargeable always rounds up (LBH / actual).
    const parcelChg = ceilChargeableKg(base);
    perParcelChargeableKg.push(parcelChg);
    chargeableBeforeMin += parcelChg;
  }

  const minKg = typeof input.rates.minimumChargeableWeightKg === 'number'
    && Number.isFinite(input.rates.minimumChargeableWeightKg)
    && input.rates.minimumChargeableWeightKg > 0
    ? input.rates.minimumChargeableWeightKg
    : 0;
  const chargeableKg = ceilChargeableKg(Math.max(chargeableBeforeMin, minKg));
  const boxPerKgInr = Number(input.rates.zones[input.zone]?.boxPerKgInr) || 0;
  const freightInr = boxPerKgInr * chargeableKg;
  const fuelPct = Number(input.rates.fuelSurchargePercent) || 0;
  const fuelSurchargeInr = freightInr * (fuelPct / 100);

  return {
    actualKg,
    volumetricKg,
    chargeableKg,
    quote: {
      volumetricKg,
      chargeableKg,
      envelopeFixedInr: 0,
      boxPerKgInr,
      freightInr,
      fuelSurchargeInr,
      totalInr: ceilCourierChargeInr(freightInr + fuelSurchargeInr),
    },
    rateMissing: !(boxPerKgInr > 0),
    perParcelChargeableKg,
  };
}

function inventoryOriginLabel(site: InventorySite): string {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}

function partnerRates(
  rates: LogisticsCourierRates,
  partnerId: LogisticsPartnerId,
  site: InventorySite,
): StCourierOriginRates | null {
  if (isBlueDartLogisticsPartnerId(partnerId) || isTrackonLogisticsPartnerId(partnerId)) {
    return null;
  }
  if (!isCourierRatePartnerId(partnerId)) return null;
  if (partnerId === 'st_courier') {
    return rates.st_courier[site];
  }
  if (partnerId === 'delhivery') return rates.delhivery;
  return null;
}

function quoteBlueDartPartnerTotal(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  pin: BlueDartPincodeDoc | null | undefined;
  parcels: StCourierParcel[];
  service: BlueDartServiceId;
  invoiceValueInr: number;
}): number {
  if (!input.parcels.length) return 0;
  const quoted = quoteBlueDartParcels({
    config: input.rates.bluedart,
    service: input.service,
    destState: input.destination?.state,
    pin: input.pin,
    parcels: input.parcels.map(p => ({
      actualKg: p.actualKg,
      dims: {
        lengthCm: Number(p.dims.lengthCm) || 0,
        widthCm: Number(p.dims.widthCm) || 0,
        heightCm: Number(p.dims.heightCm) || 0,
      },
    })),
    invoiceValueInr: input.invoiceValueInr,
  });
  if (quoted.notServiceable || quoted.rateMissing) return 0;
  return quoted.totalInr;
}

function quoteTrackonPartnerTotal(input: {
  rates: LogisticsCourierRates;
  destination: StCourierDestination | null | undefined;
  parcels: StCourierParcel[];
  service: TrackonServiceId;
}): number {
  if (!input.parcels.length) return 0;
  const quoted = quoteTrackonParcels({
    config: input.rates.trackon,
    service: input.service,
    destination: input.destination,
    parcels: input.parcels.map(p => ({
      actualKg: p.actualKg,
      dims: {
        lengthCm: Number(p.dims.lengthCm) || 0,
        widthCm: Number(p.dims.widthCm) || 0,
        heightCm: Number(p.dims.heightCm) || 0,
      },
    })),
  });
  if (quoted.notServiceable || quoted.rateMissing) return 0;
  return quoted.totalInr;
}

/**
 * Full cart freight estimate with per-site courier choice and line-level breakdown.
 */
export function estimateStCourierCartFreight(input: {
  lines: StCourierCartLine[];
  destination: StCourierDestination | null | undefined;
  rates: LogisticsCourierRates;
  deliveryRules: LogisticsDeliveryRulesMatrix;
  /** Active / Inactive / Manual — Inactive partners omitted from SO options. */
  partnerStatuses?: LogisticsPartnerStatuses | null;
  /** Selected courier per ship-from site. Missing sites use default. */
  courierBySite?: Partial<Record<InventorySite, LogisticsPartnerId>>;
  /** Override freight charge plan (Kerala / TN-Pondy / Other). */
  zoneOverride?: StCourierZone | null;
  /** Blue Dart pin serviceability (from blueDartPincodes/{zip}). */
  blueDartPin?: BlueDartPincodeDoc | null;
  /**
   * @deprecated Prefer selecting bluedart_air / bluedart_surface / bluedart_domestic.
   * Kept only as a last-resort default when a legacy consolidated partner is passed.
   */
  blueDartService?: BlueDartServiceId;
  /** Invoice / cargo value for FOV. */
  invoiceValueInr?: number;
  /**
   * Staff box / custom LBH + weight for spare freight (one or more boxes).
   * When `requireSparePackaging` is true, spare quotes stay ₹0 until complete.
   */
  sparePackaging?: SpareFreightPackaging | SpareFreightPackaging[] | null;
  /** Staff SO freight: do not fall back to 1 kg flat for spares. */
  requireSparePackaging?: boolean;
}): StCourierCartFreightEstimate | null {
  const spareOnlyCart = cartLinesAreSpareOnly(input.lines);
  const inferredFromAddress = inferStCourierZone(input.destination);
  if (!inferredFromAddress && !spareOnlyCart) return null;
  const inferredZone = inferredFromAddress ?? 'other_states';
  const zone = input.zoneOverride && isStCourierZone(input.zoneOverride)
    ? input.zoneOverride
    : inferredZone;
  const zoneOverridden = zone !== inferredZone;

  const skipped: StCourierCartFreightSkip[] = [];
  const warnings: string[] = [];

  type SiteAcc = {
    productLines: Array<{
      line: StCourierCartLine;
      parcels: StCourierParcel[];
      masterCartonCount: number;
      singleBoxCount: number;
      missingUnits: number;
      skip: StCourierCartFreightSkip | null;
    }>;
    spareLines: StCourierCartLine[];
  };
  const bySite = new Map<InventorySite, SiteAcc>();

  const ensure = (site: InventorySite): SiteAcc => {
    let acc = bySite.get(site);
    if (!acc) {
      acc = { productLines: [], spareLines: [] };
      bySite.set(site, acc);
    }
    return acc;
  };

  for (const line of input.lines) {
    const segment = classifyOrderLineSegment(line) as OrderSegment | null;
    if (!segmentAllowsFreight(segment)) {
      if (segment === 'software') {
        skipped.push({
          productId: line.productId,
          sku: line.sku?.trim() || null,
          name: line.name?.trim() || null,
          reason: 'software',
        });
      }
      continue;
    }
    const site = resolveLineInventorySite(segment, line.warehouses);
    const acc = ensure(site);
    if (segment === 'spare') {
      acc.spareLines.push(line);
      continue;
    }
    const packed = cartonizeCartLine(line);
    if (packed.skip) skipped.push(packed.skip);
    acc.productLines.push({
      line,
      parcels: packed.parcels,
      masterCartonCount: packed.masterCartonCount,
      singleBoxCount: packed.singleBoxCount,
      missingUnits: packed.missingUnits,
      skip: packed.skip,
    });
  }

  const sites: SiteFreightBucket[] = [];

  for (const site of ['cochin', 'head_office'] as InventorySite[]) {
    const acc = bySite.get(site);
    if (!acc) continue;
    const hasProduct = acc.productLines.length > 0;
    const hasSpare = acc.spareLines.length > 0;
    if (!hasProduct && !hasSpare) continue;

    const spareOnly = hasSpare && !hasProduct;
    const { options, defaultPartnerId } = listOrderCourierOptions({
      deliveryRules: input.deliveryRules,
      site,
      destination: input.destination,
      rates: input.rates,
      spareOnly,
      alwaysOfferStCourier: hasSpare,
      partnerStatuses: input.partnerStatuses,
    });

    const allParcels = acc.productLines.flatMap(row => row.parcels);

    const invoiceValueInr = Number(input.invoiceValueInr) || 0;

    const resolveBlueDartService = (partnerId: LogisticsPartnerId): BlueDartServiceId => (
      blueDartServiceForPartner(partnerId) ?? input.blueDartService ?? 'surface'
    );
    const resolveTrackonService = (partnerId: LogisticsPartnerId): TrackonServiceId => (
      trackonServiceForPartner(partnerId) ?? 'surface'
    );

    const quoteSpareForPartner = (partnerId: LogisticsPartnerId): number => {
      if (!hasSpare || isPickupPartner(partnerId)) return 0;
      return quoteSpareFreight({
        partnerId,
        site,
        zone,
        destination: input.destination,
        rates: input.rates,
        pin: input.blueDartPin,
        packaging: input.sparePackaging,
        requirePackaging: input.requireSparePackaging,
      }).totalInr;
    };

    const quotePartnerTotal = (partnerId: LogisticsPartnerId): number => {
      if (isPickupPartner(partnerId)) return 0;
      const spareFreight = quoteSpareForPartner(partnerId);
      if (isBlueDartLogisticsPartnerId(partnerId)) {
        const productFreight = quoteBlueDartPartnerTotal({
          rates: input.rates,
          destination: input.destination,
          pin: input.blueDartPin,
          parcels: allParcels,
          service: resolveBlueDartService(partnerId),
          invoiceValueInr,
        });
        return ceilCourierChargeInr(productFreight + spareFreight);
      }
      if (isTrackonLogisticsPartnerId(partnerId)) {
        const productFreight = quoteTrackonPartnerTotal({
          rates: input.rates,
          destination: input.destination,
          parcels: allParcels,
          service: resolveTrackonService(partnerId),
        });
        return ceilCourierChargeInr(productFreight + spareFreight);
      }
      const originRatesForPartner = partnerRates(input.rates, partnerId, site);
      const quotedForPartner = originRatesForPartner && allParcels.length
        ? quoteStCourierParcels({ zone, rates: originRatesForPartner, parcels: allParcels })
        : null;
      const productFreight = quotedForPartner?.quote.totalInr ?? 0;
      return ceilCourierChargeInr(productFreight + spareFreight);
    };

    const stOriginRates = partnerRates(input.rates, 'st_courier', site);
    const stChargeableKg = stOriginRates && allParcels.length && zone
      ? (quoteStCourierParcels({
        zone,
        rates: stOriginRates,
        parcels: allParcels,
      })?.chargeableKg ?? 0)
      : 0;
    const stBlockedForTamilNadu = isTamilNaduDestination(input.destination)
      && stCourierTamilNaduMaxChargeableExceeded(stChargeableKg);

    const quoteSpareDetailForPartner = (partnerId: LogisticsPartnerId) => {
      if (!hasSpare || isPickupPartner(partnerId)) return null;
      return quoteSpareFreight({
        partnerId,
        site,
        zone,
        destination: input.destination,
        rates: input.rates,
        pin: input.blueDartPin,
        packaging: input.sparePackaging,
        requirePackaging: input.requireSparePackaging,
      });
    };

    const optionsWithTotals: OrderCourierOption[] = [];
    for (const opt of options) {
      if (opt.partnerId === 'st_courier' && stBlockedForTamilNadu && hasProduct) {
        continue;
      }

      if (
        (opt.partnerId === 'bluedart_air' || opt.partnerId === 'bluedart_domestic')
        && allParcels.length > 0
      ) {
        const bdCapQuoted = quoteBlueDartParcels({
          config: input.rates.bluedart,
          service: resolveBlueDartService(opt.partnerId),
          destState: input.destination?.state,
          pin: input.blueDartPin,
          parcels: allParcels.map(p => ({
            actualKg: p.actualKg,
            dims: {
              lengthCm: Number(p.dims.lengthCm) || 0,
              widthCm: Number(p.dims.widthCm) || 0,
              heightCm: Number(p.dims.heightCm) || 0,
            },
          })),
          invoiceValueInr,
        });
        /** Hide when pin/weight rules make Blue Dart not serviceable. */
        if (bdCapQuoted.notServiceable) {
          continue;
        }
      }

      const spareDetail = quoteSpareDetailForPartner(opt.partnerId);
      optionsWithTotals.push({
        ...opt,
        estimatedTotalInr: quotePartnerTotal(opt.partnerId),
        ...(spareDetail && !spareDetail.needsPackaging
          ? {
              estimatedVolumetricKg: spareDetail.volumetricKg,
              estimatedChargeableKg: spareDetail.chargeableKg,
            }
          : {}),
      });
    }

    const requested = normalizeLogisticsPartnerId(input.courierBySite?.[site] ?? null)
      ?? undefined;
    const selectedOpt = optionsWithTotals.find(o => o.partnerId === requested && o.enabled)
      ?? optionsWithTotals.find(o => o.partnerId === defaultPartnerId && o.enabled)
      ?? optionsWithTotals.find(o => o.enabled)
      ?? optionsWithTotals[0];
    const partnerId = selectedOpt?.partnerId ?? defaultPartnerId;
    const isPickup = isPickupPartner(partnerId);
    const isBlueDart = isBlueDartLogisticsPartnerId(partnerId);
    const isTrackon = isTrackonLogisticsPartnerId(partnerId);
    const bdService = resolveBlueDartService(partnerId);
    const trackonService = resolveTrackonService(partnerId);
    const originRates = partnerRates(input.rates, partnerId, site);

    const quoted = !isPickup && !isBlueDart && !isTrackon && originRates && allParcels.length
      ? quoteStCourierParcels({ zone, rates: originRates, parcels: allParcels })
      : null;

    const bdQuoted = !isPickup && isBlueDart && allParcels.length
      ? quoteBlueDartParcels({
        config: input.rates.bluedart,
        service: bdService,
        destState: input.destination?.state,
        pin: input.blueDartPin,
        parcels: allParcels.map(p => ({
          actualKg: p.actualKg,
          dims: {
            lengthCm: Number(p.dims.lengthCm) || 0,
            widthCm: Number(p.dims.widthCm) || 0,
            heightCm: Number(p.dims.heightCm) || 0,
          },
        })),
        invoiceValueInr,
      })
      : null;

    const trackonQuoted = !isPickup && isTrackon && allParcels.length
      ? quoteTrackonParcels({
        config: input.rates.trackon,
        service: trackonService,
        destination: input.destination,
        parcels: allParcels.map(p => ({
          actualKg: p.actualKg,
          dims: {
            lengthCm: Number(p.dims.lengthCm) || 0,
            widthCm: Number(p.dims.widthCm) || 0,
            heightCm: Number(p.dims.heightCm) || 0,
          },
        })),
      })
      : null;

    const boxPerKg = isBlueDart
      ? (bdQuoted && !bdQuoted.notServiceable ? (bdQuoted.perKgInr ?? 0) : 0)
      : isTrackon
        ? 0
        : (quoted?.quote.boxPerKgInr ?? 0);
    const totalProductChargeable = isBlueDart
      ? (bdQuoted && !bdQuoted.notServiceable ? bdQuoted.chargeableKg : 0)
      : isTrackon
        ? (trackonQuoted && !trackonQuoted.notServiceable ? trackonQuoted.chargeableKg : 0)
        : (quoted?.chargeableKg ?? 0);
    const totalProductFreight = isPickup
      ? 0
      : isBlueDart
        ? (bdQuoted && !bdQuoted.notServiceable && !bdQuoted.rateMissing ? bdQuoted.totalInr : 0)
        : isTrackon
          ? (trackonQuoted && !trackonQuoted.notServiceable && !trackonQuoted.rateMissing
            ? trackonQuoted.totalInr
            : 0)
          : (quoted?.quote.totalInr ?? 0);
    // Allocate freight to lines by share of chargeable kg
    let parcelOffset = 0;
    let bdShipmentFeesAssigned = false;
    const lineBreakdowns: FreightLineBreakdown[] = [];
    const volumetricDivisor = isBlueDart
      ? (bdService === 'domestic_priority'
        ? input.rates.bluedart.domestic_priority.volumetricDivisor
        : input.rates.bluedart[bdService].volumetricDivisor)
      : isTrackon
        ? (input.rates.trackon.shared.volumetricDivisor || 5000)
        : (originRates && originRates.volumetricDivisor > 0
          ? originRates.volumetricDivisor
          : 5000);
    const fuelSurchargePercent = isBlueDart
      ? (Number(input.rates.bluedart.shared.fuelSurchargePercent) || 0)
      : isTrackon
        ? (Number(input.rates.trackon.shared.fuelSurchargePercent) || 0)
        : (originRates ? (Number(originRates.fuelSurchargePercent) || 0) : 0);

    const isBlueDartDp = isBlueDart && bdService === 'domestic_priority';
    /**
     * DP share basis = sum of raw max(actual, vol) so ₹ allocation matches the
     * consignment total (billable kg is stepped to 0.5 separately).
     */
    let dpShareWeightTotal = 0;
    if (isBlueDartDp) {
      for (const row of acc.productLines) {
        for (const parcel of row.parcels) {
          const dims = {
            lengthCm: Number(parcel.dims.lengthCm) || 0,
            widthCm: Number(parcel.dims.widthCm) || 0,
            heightCm: Number(parcel.dims.heightCm) || 0,
          };
          const vol = blueDartDpVolumetricKg(dims, volumetricDivisor);
          dpShareWeightTotal += Math.max(parcel.actualKg, vol);
        }
      }
    }
    const shareWeightTotal = isBlueDartDp ? dpShareWeightTotal : totalProductChargeable;

    for (const row of acc.productLines) {
      let lineKg = 0;
      let lineActualKg = 0;
      let lineVolumetricKg = 0;
      const groupMap = new Map<string, FreightParcelGroup>();

      for (let i = 0; i < row.parcels.length; i += 1) {
        const parcel = row.parcels[i];
        const dims = {
          lengthCm: Number(parcel.dims.lengthCm) || 0,
          widthCm: Number(parcel.dims.widthCm) || 0,
          heightCm: Number(parcel.dims.heightCm) || 0,
        };
        /** DP: raw vol (no 1 kg ceil). Share weights are unrounded; shipment billable is 0.5 kg stepped. */
        const vol = isBlueDartDp
          ? blueDartDpVolumetricKg(dims, volumetricDivisor)
          : stCourierVolumetricKg(parcel.dims, volumetricDivisor);
        const chg = isBlueDartDp
          ? Math.max(parcel.actualKg, vol)
          : isBlueDart
            ? blueDartPieceChargeableKg(parcel.actualKg, dims, volumetricDivisor)
            : isTrackon
              ? ceilChargeableKg(Math.max(parcel.actualKg, vol))
              : (quoted?.perParcelChargeableKg[parcelOffset + i] ?? 0);
        lineKg += chg;
        lineActualKg += parcel.actualKg;
        lineVolumetricKg += vol;
        const lengthCm = Number(parcel.dims.lengthCm) || 0;
        const breadthCm = Number(parcel.dims.widthCm) || 0;
        const heightCm = Number(parcel.dims.heightCm) || 0;
        const key = [
          parcel.kind,
          lengthCm,
          breadthCm,
          heightCm,
          Math.round(parcel.actualKg * 1000),
          Math.round(vol * 1000),
          Math.round(chg * 1000),
        ].join(':');
        const existing = groupMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.actualKgTotal = Math.round((existing.actualKgTotal + parcel.actualKg) * 1000) / 1000;
          existing.volumetricKgTotal = Math.round((existing.volumetricKgTotal + vol) * 1000) / 1000;
          existing.chargeableKgTotal = Math.round((existing.chargeableKgTotal + chg) * 1000) / 1000;
        } else {
          groupMap.set(key, {
            kind: parcel.kind,
            count: 1,
            lengthCm,
            breadthCm,
            heightCm,
            actualKgEach: Math.round(parcel.actualKg * 1000) / 1000,
            volumetricKgEach: Math.round(vol * 1000) / 1000,
            chargeableKgEach: Math.round(chg * 1000) / 1000,
            actualKgTotal: Math.round(parcel.actualKg * 1000) / 1000,
            volumetricKgTotal: Math.round(vol * 1000) / 1000,
            chargeableKgTotal: Math.round(chg * 1000) / 1000,
          });
        }
      }
      parcelOffset += row.parcels.length;

      const share = shareWeightTotal > 0 ? lineKg / shareWeightTotal : 0;
      const amountInr = ceilCourierChargeInr(totalProductFreight * share);
      const indication = row.missingUnits > 0 || row.skip
        ? (row.skip?.reason === 'no_package' ? 'missing_package' : 'incomplete_package')
        : 'ok';
      const lineKgRounded = isBlueDartDp
        ? ceilBlueDartDpChargeableKg(lineKg)
        : Math.round(lineKg * 1000) / 1000;
      const includeShipmentFees = Boolean(
        isBlueDart
        && !bdShipmentFeesAssigned
        && row.parcels.length > 0
        && indication === 'ok',
      );
      if (includeShipmentFees) bdShipmentFeesAssigned = true;
      const lineOversizeInr = isBlueDart && bdService === 'surface'
        ? blueDartParcelsOversizeInr(
          input.rates.bluedart.surface.oversizeSlabs,
          row.parcels.map(p => ({
            actualKg: p.actualKg,
            dims: {
              lengthCm: Number(p.dims.lengthCm) || 0,
              widthCm: Number(p.dims.widthCm) || 0,
              heightCm: Number(p.dims.heightCm) || 0,
            },
          })),
          volumetricDivisor,
        )
        : undefined;
      const lineSteps = isBlueDart
        && bdQuoted
        && !bdQuoted.notServiceable
        && !bdQuoted.rateMissing
        ? blueDartFreightCalcSteps(bdQuoted, {
          chargeableKgOverride: isBlueDartDp
            ? totalProductChargeable * share
            : lineKgRounded,
          amountScale: share,
          includeShipmentFees,
          oversizeInrOverride: lineOversizeInr,
        })
        : undefined;

      lineBreakdowns.push({
        productId: row.line.productId,
        sku: row.line.sku?.trim() || null,
        name: row.line.name?.trim() || null,
        quantity: row.line.quantity,
        masterCartonCount: row.masterCartonCount,
        singleBoxCount: row.singleBoxCount,
        missingUnits: row.missingUnits,
        chargeableKg: isBlueDartDp
          ? Math.round(totalProductChargeable * share * 1000) / 1000
          : lineKgRounded,
        amountInr,
        indication,
        actualKg: Math.round(lineActualKg * 1000) / 1000,
        volumetricKg: Math.round(lineVolumetricKg * 1000) / 1000,
        boxPerKgInr: boxPerKg,
        fuelSurchargePercent,
        volumetricDivisor,
        parcelGroups: [...groupMap.values()],
        zoneLabel: isBlueDart ? (bdQuoted?.zoneLabel ?? null) : null,
        first500gInr: isBlueDart ? (bdQuoted?.first500gInr ?? null) : null,
        addl500gInr: isBlueDart ? (bdQuoted?.addl500gInr ?? null) : null,
        calcSteps: lineSteps,
      });
    }

    const spareQuote = !isPickup && hasSpare
      ? quoteSpareFreight({
        partnerId,
        site,
        zone,
        destination: input.destination,
        rates: input.rates,
        pin: input.blueDartPin,
        packaging: input.sparePackaging,
        requirePackaging: input.requireSparePackaging,
      })
      : null;
    const spareFreightInr = spareQuote?.totalInr ?? 0;
    const spareChargeableKg = spareQuote?.chargeableKg ?? 0;
    const spareParcels = (spareQuote?.parcels ?? []).filter(
      row => row.lengthCm > 0 && row.widthCm > 0 && row.heightCm > 0,
    );
    const spareHasDims = spareParcels.length > 0;

    // One row per site: all spare names against the auto spare freight charge.
    if (acc.spareLines.length > 0) {
      const itemNames = acc.spareLines.map(spare => {
        const label = spare.name?.trim() || spare.sku?.trim();
        return label || 'Spare';
      });
      const quantity = acc.spareLines.reduce((sum, spare) => sum + Math.max(0, Number(spare.quantity) || 0), 0);
      const spareActualKg = spareQuote?.actualKg ?? 0;
      const spareVolumetricKg = spareQuote?.volumetricKg ?? 0;
      lineBreakdowns.push({
        productId: acc.spareLines[0].productId,
        sku: null,
        name: itemNames.join(', '),
        itemNames,
        quantity,
        masterCartonCount: 0,
        singleBoxCount: spareParcels.length,
        missingUnits: 0,
        chargeableKg: spareChargeableKg,
        amountInr: spareFreightInr,
        indication: 'spare_default',
        actualKg: spareActualKg,
        volumetricKg: spareVolumetricKg,
        boxPerKgInr: spareQuote?.perKgInr,
        fuelSurchargePercent: spareQuote?.fuelSurchargePercent,
        parcelGroups: spareHasDims
          ? spareParcels.map(parcel => ({
              kind: 'single_box' as const,
              count: 1,
              lengthCm: parcel.lengthCm,
              breadthCm: parcel.widthCm,
              heightCm: parcel.heightCm,
              actualKgEach: parcel.actualKg,
              volumetricKgEach: parcel.volumetricKg,
              chargeableKgEach: parcel.chargeableKg,
              actualKgTotal: parcel.actualKg,
              volumetricKgTotal: parcel.volumetricKg,
              chargeableKgTotal: parcel.chargeableKg,
            }))
          : undefined,
      });
    }

    const indications: string[] = [];
    if (isPickup) indications.push('Customer pickup — no freight');
    if (spareFreightInr > 0) {
      indications.push(`Spare freight ₹${spareFreightInr.toLocaleString('en-IN')}`);
    } else if (hasSpare && !isPickup && spareQuote?.needsPackaging) {
      indications.push('Spare freight — select a box or enter L×B×H');
    } else if (hasSpare && !isPickup && spareQuote?.skipped) {
      indications.push('Spare freight — enter ₹ manually for this partner');
    } else if (hasSpare && !isPickup && spareQuote?.rateMissing) {
      indications.push('Spare freight — rate missing for this destination');
    }
    for (const b of lineBreakdowns) {
      if (b.indication === 'missing_package' || b.indication === 'incomplete_package') {
        indications.push(`${b.name || b.sku || 'Item'} — no package data (₹0)`);
      }
    }

    const allowsManual = partnerAllowsManualFreightRate(partnerId, input.partnerStatuses);
    const hasConfiguredRate = isBlueDart
      ? !bdQuoted?.rateMissing
      : isTrackon
        ? Boolean(trackonQuoted && !trackonQuoted.rateMissing && !trackonQuoted.notServiceable)
        : (Boolean(originRates) && boxPerKg > 0);
    const rateMissing = Boolean(
      !isPickup
      && hasProduct
      && !hasConfiguredRate
      && !allowsManual,
    );
    if (
      !isPickup
      && hasProduct
      && allowsManual
      && !partnerHasZoneRate(input.rates, partnerId, site, zone)
    ) {
      indications.push(
        `${logisticsPartnerLabel(partnerId)} — no rate card yet; staff/admin enter freight ₹ on the sales order`,
      );
    }

    sites.push({
      site,
      siteLabel: inventoryOriginLabel(site),
      hasProduct,
      hasSpare,
      partnerId,
      partnerLabel: logisticsPartnerLabel(partnerId),
      courierOptions: optionsWithTotals,
      isPickup,
      zone,
      zoneLabel: ST_COURIER_ZONE_LABELS[zone],
      lineBreakdowns,
      productFreightInr: totalProductFreight,
      spareFreightInr,
      totalInr: ceilCourierChargeInr(totalProductFreight + spareFreightInr),
      chargeableKg: totalProductChargeable + spareChargeableKg,
      parcelCount: allParcels.length + spareParcels.length,
      rateMissing,
      indications: [...new Set(indications)],
    });
  }

  if (skipped.some(s => s.reason === 'no_package' || s.reason === 'incomplete_package')) {
    warnings.push('Some products lack packaging data — those units are ₹0 until filled.');
  }
  if (zoneOverridden) {
    warnings.push(
      `Freight plan overridden from ${ST_COURIER_ZONE_LABELS[inferredZone]} to ${ST_COURIER_ZONE_LABELS[zone]} — reason required.`,
    );
  }

  const totalInr = sites.reduce((sum, s) => sum + s.totalInr, 0);
  const totalChargeableKg = sites.reduce((sum, s) => sum + s.chargeableKg, 0);
  const parcelCount = sites.reduce((sum, s) => sum + s.parcelCount, 0);

  return {
    zone,
    zoneLabel: ST_COURIER_ZONE_LABELS[zone],
    inferredZone,
    inferredZoneLabel: ST_COURIER_ZONE_LABELS[inferredZone],
    zoneOverridden,
    sites,
    totalInr,
    totalChargeableKg,
    parcelCount,
    skipped,
    usable: sites.length > 0,
    warnings,
  };
}

/** True when freightable lines are only spares (no products). */
export function cartLinesAreSpareOnly(lines: StCourierCartLine[]): boolean {
  let spare = false;
  let product = false;
  for (const line of lines) {
    const segment = classifyOrderLineSegment(line);
    if (segment === 'spare') spare = true;
    else if (segment === 'product') product = true;
  }
  return spare && !product;
}

/** Build cart freight lines from cart items + catalog package snapshots. */
export function cartLinesForFreightEstimate(
  items: Array<{
    productId: string;
    name?: string | null;
    sku?: string | null;
    quantity: number;
    categoryId?: string | null;
    categoryName?: string | null;
  }>,
  catalogById: Record<string, CatalogProduct | undefined>,
): StCourierCartLine[] {
  return items.map(item => {
    const catalog = catalogById[item.productId];
    return {
      productId: item.productId,
      name: item.name ?? catalog?.name ?? null,
      sku: item.sku ?? catalog?.sku ?? null,
      quantity: item.quantity,
      categoryId: item.categoryId ?? catalog?.categoryId ?? null,
      categoryName: item.categoryName ?? catalog?.categoryName ?? null,
      warehouses: catalog?.warehouses ?? null,
      packageInfo: catalog?.packageInfo ?? null,
    };
  });
}

export type MissingFreightPackageLine = {
  productId: string;
  name: string | null;
  sku: string | null;
  reason: 'no_package' | 'incomplete_package';
};

/**
 * Product lines that cannot be freight-quoted (missing or incomplete LBH/weight).
 * Spares and software are ignored — they do not require package dims.
 */
export function listProductsMissingFreightPackageInfo(
  lines: StCourierCartLine[],
): MissingFreightPackageLine[] {
  const out: MissingFreightPackageLine[] = [];
  for (const line of lines) {
    const segment = classifyOrderLineSegment(line) as OrderSegment | null;
    if (segment !== 'product') continue;
    if (!(Number(line.quantity) > 0)) continue;
    const packed = cartonizeCartLine(line);
    if (!packed.skip && packed.missingUnits <= 0) continue;
    out.push({
      productId: line.productId,
      name: line.name?.trim() || null,
      sku: line.sku?.trim() || null,
      reason: packed.skip?.reason === 'no_package' ? 'no_package' : 'incomplete_package',
    });
  }
  return out;
}

/** True when every ship-from bucket on the estimate is customer pickup. */
export function estimateAllSitesPickup(
  estimate: StCourierCartFreightEstimate | null | undefined,
): boolean {
  if (!estimate?.usable || estimate.sites.length === 0) return false;
  return estimate.sites.every(site => site.isPickup || isPickupPartner(site.partnerId));
}

/**
 * Customer pickup applies to the whole order — mirror dealer clubSites behaviour
 * when staff pick pickup on any ship-from bucket.
 */
export function applyCourierSelectionForSite(
  prev: Partial<Record<InventorySite, LogisticsPartnerId>>,
  site: InventorySite,
  partnerId: LogisticsPartnerId,
  allSites?: InventorySite[],
): Partial<Record<InventorySite, LogisticsPartnerId>> {
  const next: Partial<Record<InventorySite, LogisticsPartnerId>> = { ...prev, [site]: partnerId };
  if (isPickupPartner(partnerId) && allSites?.length) {
    for (const bucket of allSites) {
      next[bucket] = 'personal_collection';
    }
  }
  return next;
}

/** Prefer explicit UI courierBySite over estimate defaults when creating/submitting. */
export function resolveSubmitCourierBySite(
  estimate: StCourierCartFreightEstimate | null | undefined,
  courierBySite: Partial<Record<InventorySite, LogisticsPartnerId>>,
): Partial<Record<InventorySite, LogisticsPartnerId>> {
  const pickupOnSelection = Object.values(courierBySite).some(id => isPickupPartner(id));
  if (!estimate?.usable) {
    if (!pickupOnSelection) return { ...courierBySite };
    return { cochin: PICKUP_PARTNER_ID, head_office: PICKUP_PARTNER_ID };
  }
  const out: Partial<Record<InventorySite, LogisticsPartnerId>> = {};
  let anyPickup = pickupOnSelection;
  for (const site of estimate.sites) {
    const id = courierBySite[site.site] ?? site.partnerId;
    out[site.site] = id;
    if (isPickupPartner(id)) anyPickup = true;
  }
  if (anyPickup) {
    for (const site of estimate.sites) {
      out[site.site] = PICKUP_PARTNER_ID;
    }
  }
  return out;
}

export type { OrderCourierOption };
