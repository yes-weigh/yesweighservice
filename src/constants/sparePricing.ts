export const SPARE_PRICING_DOC_ID = 'sparePricing';

/** Default USD → INR when nothing saved yet. */
export const DEFAULT_USD_TO_INR_RATE = 0;

/** Default customs duty (CD) percentage. */
export const DEFAULT_CD_PERCENT = 0;

/** Debounce for type-to-autosave on the Spare pricing tab. */
export const SPARE_PRICING_LIVE_SAVE_MS = 450;

/** Free public FX API (no key, open CORS) — Frankfurter v2. */
export const USD_INR_RATE_API_URL = 'https://api.frankfurter.dev/v2/rate/USD/INR';
