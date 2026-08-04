import type { CatalogPackageCarton, CatalogPackageInfo, CatalogProduct } from '../types/catalog';
import {
  ST_COURIER_ZONE_LABELS,
  type LogisticsCourierRates,
  type StCourierOriginRates,
  type StCourierZone,
} from '../types/logistics-courier-rates';
import {
  classifyOrderLineSegment,
  resolveLineInventorySite,
  segmentAllowsFreight,
  type InventorySite,
} from './salesOrderSegments';
import {
  stCourierVolumetricKg,
  type StCourierQuoteDims,
  type StCourierQuoteResult,
} from './stCourierQuote';
import { inferStCourierZone, type StCourierDestination } from './stCourierZone';

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

export type StCourierOriginFreightQuote = {
  site: InventorySite;
  /** product = ST carton quote; spare = logistics spare minimum. */
  kind: 'product' | 'spare';
  label: string;
  parcelCount: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  boxPerKgInr: number;
  quote: StCourierQuoteResult;
  /** True when zone box rate is 0 (product quotes only). */
  rateMissing: boolean;
};

export type StCourierCartFreightEstimate = {
  zone: StCourierZone;
  zoneLabel: string;
  partnerLabel: 'ST Courier';
  /** One row per ship-from × product/spare bucket that will get a freight line. */
  origins: StCourierOriginFreightQuote[];
  totalInr: number;
  totalChargeableKg: number;
  parcelCount: number;
  skipped: StCourierCartFreightSkip[];
  /** True when at least one freight line will be placed on the order. */
  usable: boolean;
  warnings: string[];
  spareFreightMinimumInr: number;
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

/**
 * Expand a line qty into physical parcels using master carton + single-box data.
 * Prefers full master cartons, then one (or more) single-box parcels per leftover unit.
 */
export function cartonizeCartLine(line: StCourierCartLine): {
  parcels: StCourierParcel[];
  skip: StCourierCartFreightSkip | null;
} {
  const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
  const sku = line.sku?.trim() || null;
  const name = line.name?.trim() || null;

  if (qty <= 0) {
    return {
      parcels: [],
      skip: { productId: line.productId, sku, name, reason: 'zero_qty' },
    };
  }

  const segment = classifyOrderLineSegment(line);
  if (segment === 'software') {
    return {
      parcels: [],
      skip: { productId: line.productId, sku, name, reason: 'software' },
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
    };
  }

  const parcels: StCourierParcel[] = [];
  let remaining = qty;

  if (masterOk && master && masterQty > 0) {
    const masters = Math.floor(remaining / masterQty);
    for (let i = 0; i < masters; i += 1) {
      parcels.push({
        productId: line.productId,
        sku,
        kind: 'master_carton',
        quantityUnits: masterQty,
        actualKg: Number(master.weightKg),
        dims: toQuoteDims(master),
      });
    }
    remaining -= masters * masterQty;
  }

  if (remaining > 0) {
    if (singles.length === 0) {
      // Master-only catalog: ship leftover units as proportional weight is unknown —
      // fall back to one master-sized box per leftover batch only when leftover equals
      // a full master (already handled). Otherwise skip remainder.
      return {
        parcels,
        skip: {
          productId: line.productId,
          sku,
          name,
          reason: 'incomplete_package',
        },
      };
    }
    for (let u = 0; u < remaining; u += 1) {
      for (const box of singles) {
        parcels.push({
          productId: line.productId,
          sku,
          kind: 'single_box',
          quantityUnits: 1,
          actualKg: Number(box.weightKg),
          dims: toQuoteDims(box),
        });
      }
    }
  }

  return { parcels, skip: null };
}

function ratesWithoutMinFloor(rates: StCourierOriginRates): StCourierOriginRates {
  return { ...rates, minimumChargeableWeightKg: 0 };
}

/** Quote a multi-parcel consignment: sum per-box chargeable, apply min floor once. */
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
} {
  const perBoxRates = ratesWithoutMinFloor(input.rates);
  let actualKg = 0;
  let volumetricKg = 0;
  let chargeableBeforeMin = 0;

  for (const parcel of input.parcels) {
    actualKg += parcel.actualKg;
    const vol = stCourierVolumetricKg(parcel.dims, perBoxRates.volumetricDivisor);
    volumetricKg += vol;
    const base = perBoxRates.useChargeableWeight
      ? Math.max(parcel.actualKg, vol)
      : parcel.actualKg;
    chargeableBeforeMin += base;
  }

  const minKg = typeof input.rates.minimumChargeableWeightKg === 'number'
    && Number.isFinite(input.rates.minimumChargeableWeightKg)
    && input.rates.minimumChargeableWeightKg > 0
    ? input.rates.minimumChargeableWeightKg
    : 0;
  const chargeableKg = Math.max(chargeableBeforeMin, minKg);
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
      totalInr: freightInr + fuelSurchargeInr,
    },
    rateMissing: !(boxPerKgInr > 0),
  };
}

function zeroQuote(amount = 0): StCourierQuoteResult {
  return {
    volumetricKg: 0,
    chargeableKg: 0,
    envelopeFixedInr: 0,
    boxPerKgInr: 0,
    freightInr: amount,
    fuelSurchargeInr: 0,
    totalInr: amount,
  };
}

export function estimateStCourierCartFreight(input: {
  lines: StCourierCartLine[];
  destination: StCourierDestination | null | undefined;
  rates: LogisticsCourierRates;
  spareFreightMinimumInr?: number;
}): StCourierCartFreightEstimate | null {
  const zone = inferStCourierZone(input.destination);
  if (!zone) return null;

  const spareMin = Math.max(0, Number(input.spareFreightMinimumInr) || 0);
  const skipped: StCourierCartFreightSkip[] = [];
  const productParcelsBySite = new Map<InventorySite, StCourierParcel[]>();
  const productSites = new Set<InventorySite>();
  const spareSites = new Set<InventorySite>();

  for (const line of input.lines) {
    const segment = classifyOrderLineSegment(line);
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
    if (segment === 'spare') {
      spareSites.add(site);
      continue;
    }

    productSites.add(site);
    const { parcels, skip } = cartonizeCartLine(line);
    if (skip && parcels.length === 0) {
      skipped.push(skip);
      continue;
    }
    if (skip) skipped.push(skip);
    if (!parcels.length) continue;
    const list = productParcelsBySite.get(site) ?? [];
    list.push(...parcels);
    productParcelsBySite.set(site, list);
  }

  const warnings: string[] = [];
  const origins: StCourierOriginFreightQuote[] = [];

  for (const site of ['cochin', 'head_office'] as InventorySite[]) {
    if (!productSites.has(site)) continue;
    const parcels = productParcelsBySite.get(site) ?? [];
    const originRates = input.rates.st_courier[site];
    const quoted = parcels.length
      ? quoteStCourierParcels({ zone, rates: originRates, parcels })
      : {
          actualKg: 0,
          volumetricKg: 0,
          chargeableKg: 0,
          quote: zeroQuote(0),
          rateMissing: true,
        };

    origins.push({
      site,
      kind: 'product',
      label: `Product · ${inventoryOriginLabel(site)}`,
      parcelCount: parcels.length,
      actualKg: quoted.actualKg,
      volumetricKg: quoted.volumetricKg,
      chargeableKg: quoted.chargeableKg,
      boxPerKgInr: quoted.quote.boxPerKgInr,
      quote: quoted.quote,
      rateMissing: quoted.rateMissing,
    });

    if (quoted.rateMissing) {
      warnings.push(
        `ST ${inventoryOriginLabel(site)} has no ₹/kg rate for ${ST_COURIER_ZONE_LABELS[zone]} (₹0 placeholder).`,
      );
    }
  }

  for (const site of ['cochin', 'head_office'] as InventorySite[]) {
    if (!spareSites.has(site)) continue;
    const amount = Math.round(spareMin * 100) / 100;
    origins.push({
      site,
      kind: 'spare',
      label: `Spare · ${inventoryOriginLabel(site)}`,
      parcelCount: 0,
      actualKg: 0,
      volumetricKg: 0,
      chargeableKg: 0,
      boxPerKgInr: 0,
      quote: zeroQuote(amount),
      rateMissing: false,
    });
  }

  const totalInr = origins.reduce((sum, o) => sum + o.quote.totalInr, 0);
  const totalChargeableKg = origins
    .filter(o => o.kind === 'product')
    .reduce((sum, o) => sum + o.chargeableKg, 0);
  const parcelCount = origins.reduce((sum, o) => sum + o.parcelCount, 0);
  const usable = origins.length > 0;

  if (skipped.some(s => s.reason === 'no_package' || s.reason === 'incomplete_package')) {
    warnings.push('Some products lack packaging data — those units are quoted as ₹0 until filled.');
  }

  return {
    zone,
    zoneLabel: ST_COURIER_ZONE_LABELS[zone],
    partnerLabel: 'ST Courier',
    origins,
    totalInr,
    totalChargeableKg,
    parcelCount,
    skipped,
    usable,
    warnings,
    spareFreightMinimumInr: spareMin,
  };
}

function inventoryOriginLabel(site: InventorySite): string {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
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
