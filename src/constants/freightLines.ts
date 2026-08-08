/** Zoho freight charge items — staff/admin SO preview can add these with custom rates. */
export const FREIGHT_LINE_OPTIONS = [
  {
    productId: '99381000031675143',
    sku: 'STFRC',
    name: 'ST COURIER FREIGHT',
    label: 'ST Courier',
    image: '/logistics/st-courier.png',
  },
  {
    productId: '99381000032106054',
    sku: 'TRAIR',
    name: 'TRACKON AIR FREIGHT',
    label: 'Trackon Air',
    image: '/logistics/trackon.png',
  },
  {
    productId: '99381000031675164',
    sku: 'TRFRC',
    name: 'TRACKON COURIER FREIGHT',
    label: 'Trackon Surface',
    image: '/logistics/trackon.png',
  },
  {
    productId: '99381000031675199',
    sku: 'DELFRC',
    name: 'DELHIVERY COURIER FREIGHT',
    label: 'Delhivery',
    image: '/logistics/delhivery.png',
  },
  {
    productId: '99381000031675218',
    sku: 'FRC',
    name: 'OTHERS FREIGHT CHARGES',
    label: 'Others',
    image: '/logistics/own-vehicle.png',
  },
  // Blue Dart Zoho items — HARDCODED (not shown in Settings). Keep in sync with
  // functions/lib/freight-lines.js and defaults in src/constants/blueDartRates.ts.
  {
    productId: '99381000031970648',
    sku: 'BDAIR',
    name: 'Blue Dart Air',
    label: 'Blue Dart Air',
    image: '/logistics/bluedart-air.webp',
  },
  {
    productId: '99381000031970559',
    sku: 'BDFRC',
    name: 'Blue Dart Surface',
    label: 'Blue Dart Surface',
    image: '/logistics/bluedart-surface.webp',
  },
  {
    productId: '99381000031970625',
    sku: 'BDDP',
    name: 'Blue Dart Domestic Priority',
    label: 'Blue Dart Domestic Priority',
    image: '/logistics/bluedart-domestic-priority.webp',
  },
] as const;

export type FreightLineSku = (typeof FREIGHT_LINE_OPTIONS)[number]['sku'];

const FREIGHT_SKU_SET = new Set<string>(
  FREIGHT_LINE_OPTIONS.map(option => option.sku.toUpperCase()),
);

const FREIGHT_PRODUCT_ID_SET = new Set<string>(
  FREIGHT_LINE_OPTIONS.map(option => option.productId),
);

export function isFreightSku(sku: string | null | undefined): boolean {
  const value = String(sku ?? '').trim().toUpperCase();
  return Boolean(value) && FREIGHT_SKU_SET.has(value);
}

export function isFreightProductId(productId: string | null | undefined): boolean {
  const value = String(productId ?? '').trim();
  return Boolean(value) && FREIGHT_PRODUCT_ID_SET.has(value);
}

export function freightOptionBySku(sku: string | null | undefined) {
  const value = String(sku ?? '').trim().toUpperCase();
  return FREIGHT_LINE_OPTIONS.find(option => option.sku === value) ?? null;
}

export function freightOptionByProductId(productId: string | null | undefined) {
  const value = String(productId ?? '').trim();
  return FREIGHT_LINE_OPTIONS.find(option => option.productId === value) ?? null;
}
