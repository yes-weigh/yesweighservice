/** Zoho freight charge items — attach to host SO segment (not classified as spare). */
export const FREIGHT_LINE_OPTIONS = [
  {
    productId: '99381000031675143',
    sku: 'STFRC',
    name: 'ST COURIER FREIGHT',
  },
  {
    productId: '99381000031675164',
    sku: 'TRFRC',
    name: 'TRACKON COURIER FREIGHT',
  },
  {
    productId: '99381000031675199',
    sku: 'DELFRC',
    name: 'DELHIVERY COURIER FREIGHT',
  },
  {
    productId: '99381000031675218',
    sku: 'FRC',
    name: 'OTHERS FREIGHT CHARGES',
  },
  {
    productId: 'BDAIR',
    sku: 'BDAIR',
    name: 'BLUE DART AIR FREIGHT',
  },
  {
    productId: 'BDFRC',
    sku: 'BDFRC',
    name: 'BLUE DART SURFACE FREIGHT',
  },
  {
    productId: 'BDDP',
    sku: 'BDDP',
    name: 'BLUE DART DOMESTIC PRIORITY FREIGHT',
  },
];

const FREIGHT_SKU_SET = new Set(
  FREIGHT_LINE_OPTIONS.map(option => String(option.sku).toUpperCase()),
);

const FREIGHT_PRODUCT_ID_SET = new Set(
  FREIGHT_LINE_OPTIONS.map(option => String(option.productId)),
);

export function isFreightSku(sku) {
  const value = String(sku ?? '').trim().toUpperCase();
  return Boolean(value) && FREIGHT_SKU_SET.has(value);
}

export function isFreightProductId(productId) {
  const value = String(productId ?? '').trim();
  return Boolean(value) && FREIGHT_PRODUCT_ID_SET.has(value);
}

export function isFreightOrderLine(line = {}) {
  return isFreightProductId(line.productId || line.itemId) || isFreightSku(line.sku);
}
