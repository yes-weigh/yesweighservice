import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_CD_PERCENT,
  DEFAULT_DEALER_PROFIT_PERCENT,
  DEFAULT_FREIGHT_PERCENT,
  DEFAULT_MARKUP_FEE_INR,
  DEFAULT_USD_TO_INR_RATE,
  SPARE_PRICING_DOC_ID,
  SPARE_PRICING_LIVE_SAVE_MS,
  USD_INR_RATE_API_URL,
} from '../constants/sparePricing';
import type {
  SparePricingLevelAdjust,
  SparePricingSettings,
  SparePricingSettingsDraft,
  UsdInrFetchResult,
} from '../types/sparePricing';
import type { PriceLevelRuleMode } from '../types/priceLevels';

export { SPARE_PRICING_DOC_ID, SPARE_PRICING_LIVE_SAVE_MS, USD_INR_RATE_API_URL };

/**
 * Landing cost in INR.
 * - INR purchase: same amount
 * - USD purchase: (amount × exchangeRate + markupFee) × (1 + (CD% + freight%) / 100)
 */
export function computeSpareLandingCostInr(
  purchase: { amount: number; currencyCode: string },
  settings: Pick<SparePricingSettings, 'usdToInrRate' | 'markupFeeInr' | 'cdPercent' | 'freightPercent'>,
): number {
  const amount = Number(purchase.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const code = String(purchase.currencyCode ?? '').trim().toUpperCase();
  if (code !== 'USD') {
    return Math.round(amount * 100) / 100;
  }
  const rate = Number(settings.usdToInrRate);
  const markup = Number(settings.markupFeeInr);
  const cd = Number(settings.cdPercent);
  const freight = Number(settings.freightPercent);
  const baseInr = amount * (Number.isFinite(rate) && rate > 0 ? rate : 0);
  const withMarkup = baseInr + (Number.isFinite(markup) && markup > 0 ? markup : 0);
  const dutyFreightPct = (Number.isFinite(cd) && cd > 0 ? cd : 0)
    + (Number.isFinite(freight) && freight > 0 ? freight : 0);
  const landing = withMarkup * (1 + dutyFreightPct / 100);
  return Math.round(landing * 100) / 100;
}

export function emptySparePricingSettings(): SparePricingSettings {
  return {
    usdToInrRate: DEFAULT_USD_TO_INR_RATE,
    markupFeeInr: DEFAULT_MARKUP_FEE_INR,
    cdPercent: DEFAULT_CD_PERCENT,
    freightPercent: DEFAULT_FREIGHT_PERCENT,
    dealerProfitPercent: DEFAULT_DEALER_PROFIT_PERCENT,
    levelPriceAdjusts: [],
    exchangeRateFetchedAt: null,
    exchangeRateDate: null,
    updatedAt: null,
    updatedByUid: null,
  };
}

function clampRate(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1_000_000) * 10000) / 10000;
}

function clampInr(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1_000_000) * 100) / 100;
}

function clampPercent(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

function clampDealerProfitPercent(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DEALER_PROFIT_PERCENT;
  return Math.round(Math.min(Math.max(n, 0), 1000) * 10) / 10;
}

function normalizeLevelPriceAdjusts(raw: unknown): SparePricingLevelAdjust[] {
  if (!Array.isArray(raw)) return [];
  const out: SparePricingLevelAdjust[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const levelId = typeof data.levelId === 'string' ? data.levelId.trim() : '';
    if (!levelId || seen.has(levelId)) continue;
    const modeRaw = data.mode;
    const mode: PriceLevelRuleMode | null = modeRaw === 'discount' || modeRaw === 'increment'
      ? modeRaw
      : null;
    if (!mode) continue;
    const percent = clampPercent(data.percent);
    if (!(percent > 0)) continue;
    const levelName = typeof data.levelName === 'string' && data.levelName.trim()
      ? data.levelName.trim()
      : levelId;
    seen.add(levelId);
    out.push({ levelId, levelName, mode, percent });
  }
  return out;
}

export function levelPriceAdjustsEqual(
  a: SparePricingLevelAdjust[],
  b: SparePricingLevelAdjust[],
): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map(row => [row.levelId, row]));
  for (const row of a) {
    const other = byId.get(row.levelId);
    if (!other) return false;
    if (other.mode !== row.mode || other.percent !== row.percent) return false;
  }
  return true;
}

export function normalizeSparePricingSettings(raw: unknown): SparePricingSettings {
  const base = emptySparePricingSettings();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;
  return {
    usdToInrRate: clampRate(data.usdToInrRate ?? data.exchangeRate ?? data.usdInr),
    markupFeeInr: clampInr(data.markupFeeInr ?? data.markupFee ?? data.markup),
    cdPercent: clampPercent(data.cdPercent ?? data.cd ?? data.customsDutyPercent),
    freightPercent: clampPercent(data.freightPercent ?? data.freight ?? data.freightPct),
    dealerProfitPercent: clampDealerProfitPercent(
      data.dealerProfitPercent ?? data.dealerProfitPct ?? DEFAULT_DEALER_PROFIT_PERCENT,
    ),
    levelPriceAdjusts: normalizeLevelPriceAdjusts(
      data.levelPriceAdjusts ?? data.levelAdjusts ?? data.spareLevelAdjusts,
    ),
    exchangeRateFetchedAt: typeof data.exchangeRateFetchedAt === 'string'
      ? data.exchangeRateFetchedAt
      : null,
    exchangeRateDate: typeof data.exchangeRateDate === 'string'
      ? data.exchangeRateDate
      : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : null,
  };
}

export function sparePricingSettingsEqual(
  a: SparePricingSettingsDraft,
  b: SparePricingSettingsDraft,
): boolean {
  return a.usdToInrRate === b.usdToInrRate
    && a.markupFeeInr === b.markupFeeInr
    && a.cdPercent === b.cdPercent
    && a.freightPercent === b.freightPercent
    && a.dealerProfitPercent === b.dealerProfitPercent
    && levelPriceAdjustsEqual(a.levelPriceAdjusts, b.levelPriceAdjusts)
    && a.exchangeRateFetchedAt === b.exchangeRateFetchedAt
    && a.exchangeRateDate === b.exchangeRateDate;
}

export async function loadSparePricingSettings(): Promise<SparePricingSettings> {
  const snap = await getDoc(doc(db, 'appSettings', SPARE_PRICING_DOC_ID));
  if (!snap.exists()) return emptySparePricingSettings();
  return normalizeSparePricingSettings(snap.data());
}

export async function saveSparePricingSettings(
  next: SparePricingSettingsDraft,
  updatedByUid: string | null,
): Promise<SparePricingSettings> {
  const normalized = normalizeSparePricingSettings(next);
  const updatedAt = new Date().toISOString();
  const payload: SparePricingSettings = {
    ...normalized,
    updatedAt,
    updatedByUid: updatedByUid?.trim() || null,
  };
  await setDoc(doc(db, 'appSettings', SPARE_PRICING_DOC_ID), payload, { merge: true });
  return payload;
}

/** Fetch current USD → INR from Frankfurter (browser-safe, no API key). */
export async function fetchUsdToInrRate(): Promise<UsdInrFetchResult> {
  const response = await fetch(USD_INR_RATE_API_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Exchange rate API returned ${response.status}.`);
  }
  const data = await response.json() as Record<string, unknown>;
  const rate = clampRate(data.rate);
  if (!(rate > 0)) {
    throw new Error('Exchange rate API returned an invalid USD→INR value.');
  }
  const date = typeof data.date === 'string' ? data.date : null;
  return {
    rate,
    date,
    fetchedAt: new Date().toISOString(),
    sourceUrl: USD_INR_RATE_API_URL,
  };
}
