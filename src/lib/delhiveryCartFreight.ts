import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import type { DelhiveryQuoteDimension } from './delhiveryQuote';
import type {
  OrderCourierOption,
  StCourierCartFreightEstimate,
} from './stCourierCartFreight';

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
          manualRate: true,
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
        manualRate: true,
        liveApiRate: true,
      };
    });

    const selected = courierOptions.find(o => o.partnerId === site.partnerId)
      ?? courierOptions.find(o => o.enabled)
      ?? courierOptions[0];
    const partnerId = selected?.partnerId ?? site.partnerId;
    const isDelhivery = partnerId === 'delhivery';
    const totalInr = isDelhivery && hasAmount
      ? rounded
      : (isDelhivery ? 0 : site.totalInr);

    return {
      ...site,
      courierOptions,
      partnerId,
      partnerLabel: selected?.label ?? site.partnerLabel,
      totalInr,
      productFreightInr: isDelhivery && hasAmount ? rounded : site.productFreightInr,
      rateMissing: isDelhivery ? !hasAmount : site.rateMissing,
    };
  });

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
