import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { DelhiveryQuoteDimension } from './delhiveryQuote';
import type {
  FreightLineBreakdown,
  OrderCourierOption,
  SiteFreightBucket,
  StCourierCartFreightEstimate,
} from './stCourierCartFreight';

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
      : undefined,
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

/**
 * Overlay a live Delhivery pre-tax estimate onto cart freight options / site totals
 * so Preferred Delhivery shows a real ₹ next to ST / Blue Dart.
 */
export function mergeDelhiveryLiveQuoteIntoEstimate(
  estimate: StCourierCartFreightEstimate,
  livePreTaxInr: number | null | undefined,
  meta?: {
    loading?: boolean;
    error?: string | null;
    notServiceable?: boolean;
  },
): StCourierCartFreightEstimate {
  const amount = Number(livePreTaxInr);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const rounded = hasAmount ? Math.ceil(amount) : 0;
  const loading = Boolean(meta?.loading);
  const notServiceable = Boolean(meta?.notServiceable);
  const error = String(meta?.error || '').trim() || null;

  const sites = estimate.sites.map(site => {
    const courierOptions: OrderCourierOption[] = site.courierOptions.map(opt => {
      if (opt.partnerId !== 'delhivery') return opt;
      if (notServiceable) {
        return {
          ...opt,
          enabled: false,
          disabledReason: error || 'Destination not serviceable on Delhivery',
          estimatedTotalInr: 0,
          manualRate: false,
          liveApiRate: true,
        };
      }
      if (hasAmount) {
        return {
          ...opt,
          enabled: true,
          disabledReason: null,
          estimatedTotalInr: rounded,
          manualRate: false,
          liveApiRate: true,
        };
      }
      return {
        ...opt,
        enabled: opt.enabled,
        disabledReason: loading
          ? null
          : (error || opt.disabledReason),
        estimatedTotalInr: 0,
        manualRate: false,
        liveApiRate: true,
      };
    });

    const selected = courierOptions.find(o => o.partnerId === site.partnerId)
      ?? courierOptions.find(o => o.enabled)
      ?? courierOptions[0];
    const partnerId = selected?.partnerId ?? site.partnerId;
    return {
      ...site,
      courierOptions,
      partnerId,
      partnerLabel: selected?.label ?? site.partnerLabel,
    };
  });

  // Split one live shipment estimate across Delhivery-selected sites/lines by kg.
  const delhiverySiteIndexes = sites
    .map((site, index) => (site.partnerId === 'delhivery' ? index : -1))
    .filter(index => index >= 0);
  if (hasAmount && delhiverySiteIndexes.length > 0) {
    const siteWeights = delhiverySiteIndexes.map(index => (
      sites[index]!.lineBreakdowns.reduce(
        (sum, line) => sum + (Number(line.chargeableKg) || 0),
        0,
      ) || Number(sites[index]!.chargeableKg) || 0
    ));
    const siteAmounts = allocateByChargeableKg(siteWeights, rounded);
    delhiverySiteIndexes.forEach((siteIndex, i) => {
      sites[siteIndex] = allocateLiveFreightOnSite(
        sites[siteIndex]!,
        siteAmounts[i] ?? 0,
      );
    });
  } else if (!hasAmount) {
    for (let i = 0; i < sites.length; i += 1) {
      if (sites[i]!.partnerId !== 'delhivery') continue;
      sites[i] = {
        ...sites[i]!,
        totalInr: 0,
        productFreightInr: 0,
        spareFreightInr: 0,
        rateMissing: true,
        lineBreakdowns: sites[i]!.lineBreakdowns.map(line => ({
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
