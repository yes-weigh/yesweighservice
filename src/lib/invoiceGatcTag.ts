import { parseGatcStampingCapacityKg } from './gatcReports';

/** Appended on stamped weighing-scale SO / invoice lines. */
export const GATC_CERTIFIED_NOTE = 'Verified, Stamped & Certified by GATC';

const LIGHT_GATC_FEE = 200;
const HEAVY_GATC_FEE = 350;

export type GatcPriceLookup = {
  stampingRange: string;
  price: number;
};

export function invoiceLineHasGatcTag(input: {
  description?: string | null;
  gatcStampingPriceId?: string | null;
  gatcFeePerUnit?: number | null;
}): boolean {
  if (Number(input.gatcFeePerUnit) > 0) return true;
  if (String(input.gatcStampingPriceId ?? '').trim()) return true;

  const text = String(input.description ?? '');
  if (!text.trim()) return false;
  const lower = text.toLowerCase();
  if (
    lower.includes('without stamping')
    || lower.includes('no stamping')
    || lower.includes('unstamped')
    || lower.includes('dismantled condition')
  ) {
    return false;
  }
  if (lower.includes('certified by gatc')) return true;
  if (lower.includes('verified, stamped')) return true;
  if (/\bwith\s+stamping\b/.test(lower)) return true;
  if (/stamping\s*:/.test(lower)) return true;
  return false;
}

export function gatcStampingRangeFromDescription(
  description: string | null | undefined,
): string | null {
  const text = String(description ?? '');
  const stamped = text.match(/stamping\s*:\s*([^\n]+)/i)
    ?? text.match(/with\s+stamping\s*\(([^)]+)\)/i);
  const range = stamped?.[1]?.trim() || '';
  return range || null;
}

export function gatcFeeForStampingRange(
  range: string | null | undefined,
  prices: readonly GatcPriceLookup[] = [],
): number {
  const raw = String(range ?? '').trim();
  if (!raw) return 0;
  const key = raw.toLowerCase();
  const exact = prices.find(entry => entry.stampingRange.trim().toLowerCase() === key);
  if (exact && exact.price > 0) return exact.price;
  const partial = prices.find((entry) => {
    const label = entry.stampingRange.trim().toLowerCase();
    return Boolean(label) && (key.includes(label) || label.includes(key));
  });
  if (partial && partial.price > 0) return partial.price;
  const kg = parseGatcStampingCapacityKg(raw);
  if (kg == null) return 0;
  return kg <= 20 ? LIGHT_GATC_FEE : HEAVY_GATC_FEE;
}

/** Fee collected on a tagged invoice line (settings range, else 200 / 350). */
export function gatcFeeFromInvoiceTag(
  input: {
    description?: string | null;
    gatcFeePerUnit?: number | null;
    gatcStampingRange?: string | null;
  },
  prices: readonly GatcPriceLookup[] = [],
): number {
  const inline = Number(input.gatcFeePerUnit) || 0;
  if (inline > 0) return inline;
  const range = String(input.gatcStampingRange ?? '').trim()
    || gatcStampingRangeFromDescription(input.description);
  return gatcFeeForStampingRange(range, prices);
}
