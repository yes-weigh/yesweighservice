import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { DelhiveryQuoteDimension } from './delhiveryQuote';
import type {
  FreightLineBreakdown,
  OrderCourierOption,
  SiteFreightBucket,
  StCourierCartFreightEstimate,
} from './stCourierCartFreight';
import {
  isPickupPartner,
  PICKUP_PARTNER_ID,
} from './orderFreight';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Split a total across items by chargeable kg (last item gets remainder). */
function allocateByChargeableKg(
  weightsKg: number[],
  totalInr: number,
): number[] {
  const safe = weightsKg.map(w => Math.max(0, Number(w) || 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < safe.length; i += 1) {
    if (i === safe.length - 1) {
      out.push(Math.max(0, round2(totalInr - allocated)));
      break;
    }
    const share = sum > 0 ? safe[i]! / sum : 1 / Math.max(1, safe.length);
    const amount = round2(totalInr * share);
    out.push(amount);
    allocated = round2(allocated + amount);
  }
  return out;
}

function withLiveDelhiveryLineShare(
  line: FreightLineBreakdown,
  amountInr: number,
  siteChargeableKg: number,
): FreightLineBreakdown {
  const lineKg = Math.max(0, Number(line.chargeableKg) || 0);
  const effectivePerKg = lineKg > 0 ? round2(amountInr / lineKg) : null;
  const pct = siteChargeableKg > 0
    ? Math.round((lineKg / siteChargeableKg) * 1000) / 10
    : null;
  return {
    ...line,
    amountInr,
    boxPerKgInr: effectivePerKg ?? undefined,
    fuelSurchargePercent: 0,
    calcSteps: amountInr > 0
      ? [{
          label: 'Live Delhivery estimate share',
          detail: pct != null
            ? `${pct}% of shipment · ${lineKg} kg chg`
            : 'Allocated from live API total',
          amountInr,
        }]
      : [{
          label: 'FOD — consignee pays freight',
          detail: 'No freight charged on this order',
          amountInr: 0,
        }],
  };
}

function allocateLiveFreightOnSite(
  site: SiteFreightBucket,
  siteTotalInr: number,
): SiteFreightBucket {
  const lines = site.lineBreakdowns;
  if (!lines.length) {
    return {
      ...site,
      totalInr: siteTotalInr,
      productFreightInr: siteTotalInr,
      spareFreightInr: 0,
      rateMissing: !(siteTotalInr > 0),
    };
  }
  const siteKg = lines.reduce((sum, line) => sum + (Number(line.chargeableKg) || 0), 0);
  const amounts = allocateByChargeableKg(
    lines.map(line => Number(line.chargeableKg) || 0),
    siteTotalInr,
  );
  const lineBreakdowns = lines.map((line, index) => (
    withLiveDelhiveryLineShare(line, amounts[index] ?? 0, siteKg)
  ));
  const productFreightInr = lineBreakdowns
    .filter(line => line.indication !== 'spare_default')
    .reduce((sum, line) => sum + line.amountInr, 0);
  const spareFreightInr = lineBreakdowns
    .filter(line => line.indication === 'spare_default')
    .reduce((sum, line) => sum + line.amountInr, 0);
  return {
    ...site,
    lineBreakdowns,
    totalInr: siteTotalInr,
    productFreightInr: round2(productFreightInr),
    spareFreightInr: round2(spareFreightInr),
    rateMissing: !(siteTotalInr > 0),
  };
}

/** Delhivery SO freight is priced via B2B `/freight/estimate`, not the unused ₹/kg card. */
export function partnerUsesLiveDelhiveryQuote(
  partnerId: LogisticsPartnerId | null | undefined,
): boolean {
  return partnerId === 'delhivery';
}

export function estimateOffersDelhivery(
  estimate: StCourierCartFreightEstimate | null | undefined,
): boolean {
  if (!estimate?.usable) return false;
  return estimate.sites.some(site => (
    site.courierOptions.some(opt => opt.partnerId === 'delhivery')
  ));
}

export { estimateAllSitesPickup } from './stCourierCartFreight';

export function selectedPartnerIsDelhivery(
  estimate: StCourierCartFreightEstimate | null | undefined,
): boolean {
  if (!estimate?.usable) return false;
  return estimate.sites.some(site => site.partnerId === 'delhivery');
}

/** Carton dims for a better Delhivery estimate (box_count + LBH). */
export function delhiveryDimensionsFromEstimate(
  estimate: StCourierCartFreightEstimate | null | undefined,
): DelhiveryQuoteDimension[] {
  if (!estimate?.usable) return [];
  /** @type {Map<string, DelhiveryQuoteDimension>} */
  const byKey = new Map<string, DelhiveryQuoteDimension>();
  for (const site of estimate.sites) {
    for (const line of site.lineBreakdowns) {
      for (const group of line.parcelGroups ?? []) {
        const length = Math.round(Number(group.lengthCm) || 0);
        const width = Math.round(Number(group.breadthCm) || 0);
        const height = Math.round(Number(group.heightCm) || 0);
        const count = Math.max(0, Math.floor(Number(group.count) || 0));
        if (!(length > 0 && width > 0 && height > 0 && count > 0)) continue;
        const key = `${length}x${width}x${height}`;
        const prev = byKey.get(key);
        byKey.set(key, {
          box_count: (prev?.box_count || 0) + count,
          length_cm: length,
          width_cm: width,
          height_cm: height,
        });
      }
    }
  }
  return [...byKey.values()];
}

function expandDelhiveryCourierOptions(
  options: OrderCourierOption[],
  btcPreTaxInr: number | null,
  fodPreTaxInr: number | null,
  meta: {
    loading: boolean;
    error: string | null;
    notServiceable: boolean;
  },
): OrderCourierOption[] {
  const out: OrderCourierOption[] = [];
  for (const opt of options) {
    if (opt.partnerId !== 'delhivery') {
      out.push(opt);
      continue;
    }
    // Already split (idempotent).
    if (opt.freightBillingMode === 'btc' || opt.freightBillingMode === 'fod') {
      out.push(opt);
      continue;
    }

    const base = {
      partnerId: 'delhivery' as const,
      freightSku: opt.freightSku,
      preferred: opt.preferred,
      manualRate: false,
      liveApiRate: true as const,
    };

    if (meta.notServiceable) {
      out.push({
        ...base,
        label: 'Delhivery prepaid',
        preferred: opt.preferred,
        freightBillingMode: 'btc',
        enabled: false,
        disabledReason: meta.error || 'Destination not serviceable on Delhivery',
        estimatedTotalInr: 0,
      });
      out.push({
        ...base,
        label: 'Delhivery To Pay',
        preferred: false,
        freightBillingMode: 'fod',
        enabled: false,
        disabledReason: meta.error || 'Destination not serviceable on Delhivery',
        estimatedTotalInr: 0,
      });
      continue;
    }

    const btcAmount = btcPreTaxInr != null && btcPreTaxInr > 0
      ? Math.ceil(btcPreTaxInr)
      : 0;
    // FOD display estimate (info only — never charged on invoice).
    const fodAmount = fodPreTaxInr != null && fodPreTaxInr > 0
      ? Math.ceil(fodPreTaxInr)
      : btcAmount;
    out.push({
      ...base,
      label: 'Delhivery prepaid',
      preferred: opt.preferred,
      freightBillingMode: 'btc',
      enabled: true,
      disabledReason: btcAmount > 0 || meta.loading
        ? null
        : (meta.error || opt.disabledReason),
      estimatedTotalInr: btcAmount,
    });
    out.push({
      ...base,
      label: 'Delhivery To Pay',
      preferred: false,
      freightBillingMode: 'fod',
      enabled: true,
      disabledReason: null,
      estimatedTotalInr: fodAmount,
    });
  }
  return out;
}

/**
 * Overlay live Delhivery estimate and split into prepaid (BTC) + To Pay (FOD) options.
 * FOD option shows estimated ₹ for info; charged site total stays ₹0 when FOD is selected.
 */
export function mergeDelhiveryLiveQuoteIntoEstimate(
  estimate: StCourierCartFreightEstimate,
  livePreTaxInr: number | null | undefined,
  meta?: {
    loading?: boolean;
    error?: string | null;
    notServiceable?: boolean;
    /** Selected Delhivery billing mode (which of the two options is active). */
    freightBillingMode?: 'fod' | 'btc' | null;
    /** FOD lane estimate (display only). Falls back to BTC amount when omitted. */
    fodPreTaxInr?: number | null;
  },
): StCourierCartFreightEstimate {
  const selectedMode = meta?.freightBillingMode === 'fod' ? 'fod' : 'btc';
  const amount = Number(livePreTaxInr);
  const btcRounded = Number.isFinite(amount) && amount > 0 ? Math.ceil(amount) : 0;
  const fodRaw = Number(meta?.fodPreTaxInr);
  const fodRounded = Number.isFinite(fodRaw) && fodRaw > 0 ? Math.ceil(fodRaw) : btcRounded;
  const loading = Boolean(meta?.loading);
  const notServiceable = Boolean(meta?.notServiceable);
  const error = String(meta?.error || '').trim() || null;
  const chargedInr = selectedMode === 'fod' ? 0 : btcRounded;

  const sites = estimate.sites.map(site => {
    const courierOptions = expandDelhiveryCourierOptions(
      site.courierOptions,
      btcRounded || null,
      fodRounded || null,
      {
        loading,
        error,
        notServiceable,
      },
    );

    const wasDelhivery = site.partnerId === 'delhivery';
    let partnerId = site.partnerId;
    let partnerLabel = site.partnerLabel;

    if (isPickupPartner(site.partnerId) || site.isPickup) {
      partnerId = PICKUP_PARTNER_ID;
      partnerLabel = logisticsPartnerLabel(PICKUP_PARTNER_ID);
    } else if (wasDelhivery) {
      const selected = courierOptions.find(o => (
        o.partnerId === 'delhivery'
        && o.freightBillingMode === selectedMode
        && o.enabled
      ))
        ?? courierOptions.find(o => o.partnerId === 'delhivery' && o.enabled)
        ?? courierOptions.find(o => o.enabled)
        ?? courierOptions[0];
      partnerId = selected?.partnerId ?? site.partnerId;
      partnerLabel = selected?.label ?? site.partnerLabel;
    } else {
      const selected = courierOptions.find(o => o.partnerId === site.partnerId)
        ?? courierOptions.find(o => o.enabled)
        ?? courierOptions[0];
      partnerId = selected?.partnerId ?? site.partnerId;
      partnerLabel = selected?.label ?? site.partnerLabel;
    }

    const isPickup = isPickupPartner(partnerId);

    return {
      ...site,
      courierOptions,
      partnerId,
      partnerLabel,
      isPickup,
      ...(isPickup
        ? {
          totalInr: 0,
          productFreightInr: 0,
          spareFreightInr: 0,
          rateMissing: false,
        }
        : {}),
    };
  });

  const delhiverySiteIndexes = sites
    .map((site, index) => (site.partnerId === 'delhivery' ? index : -1))
    .filter(index => index >= 0);

  if (delhiverySiteIndexes.length > 0 && (selectedMode === 'fod' || btcRounded > 0)) {
    const siteWeights = delhiverySiteIndexes.map(index => (
      sites[index]!.lineBreakdowns.reduce(
        (sum, line) => sum + (Number(line.chargeableKg) || 0),
        0,
      ) || Number(sites[index]!.chargeableKg) || 0
    ));
    const siteAmounts = allocateByChargeableKg(siteWeights, chargedInr);
    delhiverySiteIndexes.forEach((siteIndex, i) => {
      const next = allocateLiveFreightOnSite(
        sites[siteIndex]!,
        siteAmounts[i] ?? 0,
      );
      sites[siteIndex] = {
        ...next,
        rateMissing: selectedMode === 'fod' ? false : next.rateMissing,
      };
    });
  } else if (delhiverySiteIndexes.length > 0 && btcRounded <= 0 && selectedMode === 'btc') {
    for (const siteIndex of delhiverySiteIndexes) {
      sites[siteIndex] = {
        ...sites[siteIndex]!,
        totalInr: 0,
        productFreightInr: 0,
        spareFreightInr: 0,
        rateMissing: true,
        lineBreakdowns: sites[siteIndex]!.lineBreakdowns.map(line => ({
          ...line,
          amountInr: 0,
          boxPerKgInr: undefined,
          calcSteps: undefined,
        })),
      };
    }
  }

  const totalInr = sites.reduce((sum, site) => sum + (Number(site.totalInr) || 0), 0);
  const warnings = [...estimate.warnings];
  if (loading && estimateOffersDelhivery(estimate)) {
    warnings.push('Fetching live Delhivery freight estimate…');
  } else if (error && !notServiceable) {
    warnings.push(error);
  }

  return {
    ...estimate,
    sites,
    totalInr,
    warnings,
  };
}
