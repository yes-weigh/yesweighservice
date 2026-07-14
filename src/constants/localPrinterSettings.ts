export const LOCAL_PRINTER_SETTINGS_DOC_ID = 'localPrinterSettings';

/** Unified Printers × Layouts × Labels settings document. */
export const LABEL_STUDIO_DOC_ID = 'labelStudio';

export const DEFAULT_LABEL_PRINTER_PORT = 9100;

/** Default from store-room printer config label (DHCP; reserve on router). */
export const DEFAULT_LABEL_PRINTER_HOST = '192.168.1.39';

/**
 * Catalog bin / item die-cut size (caliper): 75.00 × 45.50 mm.
 * TE210 self-test WIDTH 1.97" was wrong for this stock.
 */
export const STORE_LABEL_WIDTH_MM = 75;
export const STORE_LABEL_HEIGHT_MM = 45.5;
/** ~0.14" from TE210 config; set 0 if Feed already advances one label cleanly. */
export const STORE_LABEL_GAP_MM = 3.5;

/** Logistics shipping / courier thermal label stock. */
export const LOGISTICS_LABEL_WIDTH_MM = 100;
export const LOGISTICS_LABEL_HEIGHT_MM = 150;
export const LOGISTICS_LABEL_GAP_MM = 3;

/** @deprecated Prefer STORE_LABEL_* — kept for existing imports. */
export const DEFAULT_LABEL_WIDTH_MM = STORE_LABEL_WIDTH_MM;
export const DEFAULT_LABEL_HEIGHT_MM = STORE_LABEL_HEIGHT_MM;
export const DEFAULT_LABEL_GAP_MM = STORE_LABEL_GAP_MM;
