import type { PriceLevelRuleMode } from './priceLevels';

/** Persisted bulk level discount/hike on New sell. */
export type SparePricingLevelAdjust = {
  levelId: string;
  levelName: string;
  mode: PriceLevelRuleMode;
  percent: number;
};

export interface SparePricingSettings {
  /** How many INR for 1 USD. */
  usdToInrRate: number;
  /** Flat markup fee in INR. */
  markupFeeInr: number;
  /** Customs duty as a percentage. */
  cdPercent: number;
  /** Freight as a percentage. */
  freightPercent: number;
  /**
   * Dealer / list profit % on landing → New sell (bulk panel).
   * Used when applying dealer price; persisted across sessions.
   */
  dealerProfitPercent: number;
  /**
   * @deprecated Unused for charge — spare level % lives on
   * appSettings/priceLevels (`__spare_parts__` category rules).
   * Cleared on save; kept for backward-compatible parse only.
   */
  levelPriceAdjusts: SparePricingLevelAdjust[];
  /** ISO timestamp when rate was last fetched from the FX API. */
  exchangeRateFetchedAt: string | null;
  /** FX market date reported by the API (YYYY-MM-DD). */
  exchangeRateDate: string | null;
  updatedAt: string | null;
  updatedByUid: string | null;
}

export type SparePricingSettingsDraft = Pick<
  SparePricingSettings,
  | 'usdToInrRate'
  | 'markupFeeInr'
  | 'cdPercent'
  | 'freightPercent'
  | 'dealerProfitPercent'
  | 'levelPriceAdjusts'
  | 'exchangeRateFetchedAt'
  | 'exchangeRateDate'
>;

export type UsdInrFetchResult = {
  rate: number;
  date: string | null;
  fetchedAt: string;
  sourceUrl: string;
};
