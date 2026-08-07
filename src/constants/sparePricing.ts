export const SPARE_PRICING_DOC_ID = 'sparePricing';

/** Default USD → INR when nothing saved yet. */
export const DEFAULT_USD_TO_INR_RATE = 0;

/** Default markup fee in INR. */
export const DEFAULT_MARKUP_FEE_INR = 0;

/** Default customs duty percentage. */
export const DEFAULT_CD_PERCENT = 0;

/** Default freight percentage. */
export const DEFAULT_FREIGHT_PERCENT = 0;

/** Default dealer profit % on landing → New sell (bulk level pricing). */
export const DEFAULT_DEALER_PROFIT_PERCENT = 35;

/** Debounce for type-to-autosave on the Spare pricing tab. */
export const SPARE_PRICING_LIVE_SAVE_MS = 450;

/** Free public FX API (no key, open CORS) — Frankfurter v2. */
export const USD_INR_RATE_API_URL = 'https://api.frankfurter.dev/v2/rate/USD/INR';
