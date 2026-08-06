export interface SparePricingSettings {
  /** How many INR for 1 USD. */
  usdToInrRate: number;
  /** Customs duty (CD) as a percentage. */
  cdPercent: number;
  /** ISO timestamp when rate was last fetched from the FX API. */
  exchangeRateFetchedAt: string | null;
  /** FX market date reported by the API (YYYY-MM-DD). */
  exchangeRateDate: string | null;
  updatedAt: string | null;
  updatedByUid: string | null;
}

export type UsdInrFetchResult = {
  rate: number;
  date: string | null;
  fetchedAt: string;
  sourceUrl: string;
};
