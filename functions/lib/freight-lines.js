/** Zoho freight charge items — attach to host SO segment (not classified as spare). */
export const FREIGHT_LINE_OPTIONS = [
  {
    productId: '99381000031675143',
    sku: 'STFRC',
    name: 'ST COURIER FREIGHT',
  },
  {
    productId: '99381000032106054',
    sku: 'TRAIR',
    name: 'TRACKON AIR FREIGHT',
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
  // Blue Dart Zoho items — keep in sync with src/constants/freightLines.ts
  {
    productId: '99381000031970648',
    sku: 'BDAIR',
    name: 'Blue Dart Air',
  },
  {
    productId: '99381000031970559',
    sku: 'BDFRC',
    name: 'Blue Dart Surface',
  },
  {
    productId: '99381000031970625',
    sku: 'BDDP',
    name: 'Blue Dart Domestic Priority',
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

const SKU_TO_PARTNER = {
  STFRC: 'st_courier',
  TRAIR: 'trackon_air',
  TRFRC: 'trackon_surface',
  DELFRC: 'delhivery',
  BDAIR: 'bluedart_air',
  BDFRC: 'bluedart_surface',
  BDDP: 'bluedart_domestic',
};

export function partnerIdForFreightSku(sku) {
  const value = String(sku ?? '').trim().toUpperCase();
  return SKU_TO_PARTNER[value] || null;
}

export function freightOptionForSku(sku) {
  const value = String(sku ?? '').trim().toUpperCase();
  return FREIGHT_LINE_OPTIONS.find(option => String(option.sku).toUpperCase() === value) || null;
}

export function freightSkuFromInvoiceLines(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  let generic = null;
  for (const item of items) {
    const sku = String(item?.sku ?? '').trim().toUpperCase();
    if (isFreightSku(sku)) return sku;
    const productId = String(item?.itemId ?? item?.productId ?? item?.item_id ?? item?.id ?? '').trim();
    if (isFreightProductId(productId)) {
      const option = FREIGHT_LINE_OPTIONS.find(row => String(row.productId) === productId);
      if (option?.sku) return String(option.sku).toUpperCase();
    }
    const name = String(item?.name ?? '').trim().toUpperCase();
    if (name) {
      const byName = FREIGHT_LINE_OPTIONS.find(row => (
        name.includes(String(row.name).toUpperCase()) || name.includes(String(row.sku).toUpperCase())
      ));
      if (byName?.sku) return String(byName.sku).toUpperCase();
    }
    if (!generic && (sku.includes('FREIGHT') || name.includes('FREIGHT'))) generic = 'FRC';
  }
  return generic;
}
