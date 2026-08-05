/** Zoho freight charge items — staff/admin SO preview can add these with custom rates. */
export const FREIGHT_LINE_OPTIONS = [
  {
    productId: '99381000031675143',
    sku: 'STFRC',
    name: 'ST COURIER FREIGHT',
    label: 'ST Courier',
    tagline: 'Kerala & Tamil Nadu',
    image: '/logistics/st-courier.png',
  },
  {
    productId: '99381000031675164',
    sku: 'TRFRC',
    name: 'TRACKON COURIER FREIGHT',
    label: 'Trackon',
    tagline: 'Tamil Nadu',
    image: '/logistics/trackon.png',
  },
  {
    productId: '99381000031675199',
    sku: 'DELFRC',
    name: 'DELHIVERY COURIER FREIGHT',
    label: 'Delhivery',
    tagline: 'All India',
    image: '/logistics/delhivery.png',
  },
  {
    productId: '99381000031675218',
    sku: 'FRC',
    name: 'OTHERS FREIGHT CHARGES',
    label: 'Others',
    tagline: 'Other freight charges',
    image: '/logistics/own-vehicle.png',
  },
  {
    /** Wire Zoho item id when available — SKU is the stable match key. */
    productId: 'BDAIR',
    sku: 'BDAIR',
    name: 'BLUE DART AIR FREIGHT',
    label: 'Blue Dart Air',
    tagline: 'Air',
    image: '/logistics/bluedart.png',
  },
  {
    productId: 'BDFRC',
    sku: 'BDFRC',
    name: 'BLUE DART SURFACE FREIGHT',
    label: 'Blue Dart Surface',
    tagline: 'Surface',
    image: '/logistics/bluedart.png',
  },
  {
    productId: 'BDDP',
    sku: 'BDDP',
    name: 'BLUE DART DOMESTIC PRIORITY FREIGHT',
    label: 'Blue Dart Domestic Priority',
    tagline: 'Domestic Priority',
    image: '/logistics/bluedart.png',
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
