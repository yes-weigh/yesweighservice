export interface SparePricingSettings {
  /** How many INR for 1 USD. */
  usdToInrRate: number;
  /** Flat markup fee in INR. */
  markupFeeInr: number;
  /** Customs duty as a percentage. */
  cdPercent: number;
  /** Freight as a percentage. */
  freightPercent: number;
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
  | 'exchangeRateFetchedAt'
  | 'exchangeRateDate'
>;

export type UsdInrFetchResult = {
  rate: number;
  date: string | null;
  fetchedAt: string;
  sourceUrl: string;
};
