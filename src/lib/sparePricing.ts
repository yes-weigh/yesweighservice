import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_CD_PERCENT,
  DEFAULT_USD_TO_INR_RATE,
  SPARE_PRICING_DOC_ID,
  SPARE_PRICING_LIVE_SAVE_MS,
  USD_INR_RATE_API_URL,
} from '../constants/sparePricing';
import type { SparePricingSettings, UsdInrFetchResult } from '../types/sparePricing';

export { SPARE_PRICING_DOC_ID, SPARE_PRICING_LIVE_SAVE_MS, USD_INR_RATE_API_URL };

export function emptySparePricingSettings(): SparePricingSettings {
  return {
    usdToInrRate: DEFAULT_USD_TO_INR_RATE,
    cdPercent: DEFAULT_CD_PERCENT,
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

function clampPercent(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1000) * 100) / 100;
}

export function normalizeSparePricingSettings(raw: unknown): SparePricingSettings {
  const base = emptySparePricingSettings();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;
  return {
    usdToInrRate: clampRate(data.usdToInrRate ?? data.exchangeRate ?? data.usdInr),
    cdPercent: clampPercent(data.cdPercent ?? data.cd ?? data.customsDutyPercent),
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
  a: Pick<SparePricingSettings, 'usdToInrRate' | 'cdPercent' | 'exchangeRateFetchedAt' | 'exchangeRateDate'>,
  b: Pick<SparePricingSettings, 'usdToInrRate' | 'cdPercent' | 'exchangeRateFetchedAt' | 'exchangeRateDate'>,
): boolean {
  return a.usdToInrRate === b.usdToInrRate
    && a.cdPercent === b.cdPercent
    && a.exchangeRateFetchedAt === b.exchangeRateFetchedAt
    && a.exchangeRateDate === b.exchangeRateDate;
}

export async function loadSparePricingSettings(): Promise<SparePricingSettings> {
  const snap = await getDoc(doc(db, 'appSettings', SPARE_PRICING_DOC_ID));
  if (!snap.exists()) return emptySparePricingSettings();
  return normalizeSparePricingSettings(snap.data());
}

export async function saveSparePricingSettings(
  next: Pick<SparePricingSettings, 'usdToInrRate' | 'cdPercent' | 'exchangeRateFetchedAt' | 'exchangeRateDate'>,
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
