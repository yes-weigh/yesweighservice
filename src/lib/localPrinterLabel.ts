/**
 * TSC TE210 TSPL layout for YesWeigh Genuine Spare bin labels (75 × 45.5 mm @ 203 dpi).
 * Coordinates are in dots: 75mm ≈ 599, 45.5mm ≈ 364.
 */

export interface BinLabelFields {
  sku: string;
  itemName: string;
  masterSku: string;
  masterProduct: string;
  rack: string;
  /** Store-room row (shown as RAW on the mockup). */
  raw: string;
  bin: string;
  /** Absolute or relative URL / payload encoded in the QR. */
  qrPayload: string;
  printedOn: Date;
}

export const TEST_BIN_LABEL_SAMPLE: BinLabelFields = {
  sku: '4pinCW',
  itemName: 'Loadcell Connector',
  masterSku: 'APCQ',
  masterProduct: 'Bench scale AD',
  rack: 'A',
  raw: '5',
  bin: '3',
  qrPayload: '4pinCW',
  printedOn: new Date(),
};

function formatMm(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function escapeTspl(value: string, maxLen = 28): string {
  return value.replace(/"/g, "'").slice(0, maxLen);
}

function formatPrintedOn(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Approximate horizontal center for built-in font glyphs (8/12/16/24/32 wide). */
function centerX(left: number, width: number, text: string, charWidth: number): number {
  const textWidth = text.length * charWidth;
  return Math.max(left, Math.round(left + (width - textWidth) / 2));
}

/**
 * Build a TSPL job matching the Genuine Spare mockup (boxes, SKU badge, location trio, QR, footer).
 * Icons/logos are omitted — thermal TSPL uses text + bars; layout matches the design structure.
 */
export function buildGenuineSpareLabelTspl(
  fields: BinLabelFields,
  media: { labelWidthMm: number; labelHeightMm: number; labelGapMm: number },
): string {
  const sku = escapeTspl(fields.sku, 16);
  const itemName = escapeTspl(fields.itemName, 22);
  const masterSku = escapeTspl(fields.masterSku, 16);
  const masterProduct = escapeTspl(fields.masterProduct, 22);
  const rack = escapeTspl(fields.rack, 4);
  const raw = escapeTspl(fields.raw, 4);
  const bin = escapeTspl(fields.bin, 4);
  const qr = escapeTspl(fields.qrPayload, 80);
  const printed = escapeTspl(`PRINTED ON ${formatPrintedOn(fields.printedOn)}`, 28);

  // Location panel geometry (dots)
  const locLeft = 318;
  const locRight = 586;
  const locTop = 48;
  const locBottom = 298;
  const colW = Math.floor((locRight - locLeft) / 3);
  const c1 = locLeft;
  const c2 = locLeft + colW;
  const c3 = locLeft + colW * 2;
  const headerH = 26;

  const lines: string[] = [
    `SIZE ${formatMm(media.labelWidthMm)} mm,${formatMm(media.labelHeightMm)} mm`,
    `GAP ${formatMm(Math.max(0, media.labelGapMm))} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    'CODEPAGE 850',

    // Outer border
    'BOX 8,6,590,358,2',

    // Header
    'TEXT 155,14,"2",0,1,1,"YESWEIGH GENUINE SPARE"',
    'BAR 20,40,568,2',

    // --- Left: SKU badge (text then reverse → white on black) ---
    'TEXT 28,52,"2",0,1,1,"SKU"',
    'REVERSE 18,46,58,28',
    `TEXT 86,50,"3",0,1,1,"${sku}"`,
    'BAR 18,78,290,1',

    // Item name
    'TEXT 18,86,"1",0,1,1,"ITEM NAME"',
    `TEXT 18,102,"2",0,1,1,"${itemName}"`,
    'BAR 18,128,290,1',

    // Master SKU
    'TEXT 18,136,"1",0,1,1,"MASTER SKU"',
    `TEXT 18,152,"2",0,1,1,"${masterSku}"`,
    'BAR 18,178,290,1',

    // Master product
    'TEXT 18,186,"1",0,1,1,"MASTER PRODUCT"',
    `TEXT 18,202,"2",0,1,1,"${masterProduct}"`,

    // QR + scan hint
    `QRCODE 18,232,L,3,A,0,"${qr}"`,
    'TEXT 118,248,"1",0,1,1,"SCAN FOR SKU INFO"',
    'TEXT 18,312,"1",0,1,1,"Scan QR for product details"',

    // --- Right: RACK / RAW / BIN panel ---
    `BOX ${locLeft},${locTop},${locRight},${locBottom},2`,
    `BAR ${c2},${locTop},2,${locBottom - locTop}`,
    `BAR ${c3},${locTop},2,${locBottom - locTop}`,

    // Column headers (text + reverse)
    `TEXT ${centerX(c1, colW, 'RACK', 12)},${locTop + 6},"2",0,1,1,"RACK"`,
    `REVERSE ${c1},${locTop},${colW},${headerH}`,
    `TEXT ${centerX(c2, colW, 'RAW', 12)},${locTop + 6},"2",0,1,1,"RAW"`,
    `REVERSE ${c2},${locTop},${colW},${headerH}`,
    `TEXT ${centerX(c3, colW, 'BIN', 12)},${locTop + 6},"2",0,1,1,"BIN"`,
    `REVERSE ${c3},${locTop},${colW},${headerH}`,

    // Divider under headers
    `BAR ${locLeft},${locTop + headerH},${locRight - locLeft},2`,

    // Large location values
    `TEXT ${centerX(c1, colW, rack, 24)},160,"5",0,1,1,"${rack}"`,
    `TEXT ${centerX(c2, colW, raw, 24)},160,"5",0,1,1,"${raw}"`,
    `TEXT ${centerX(c3, colW, bin, 24)},160,"5",0,1,1,"${bin}"`,

    // Footer
    'BAR 20,328,568,1',
    `TEXT 18,338,"1",0,1,1,"${printed}"`,
    'TEXT 400,334,"2",0,1,1,"YESWEIGH"',
    'TEXT 400,352,"1",0,1,1,"PRECISION IN EVERY WEIGH"',

    'PRINT 1,1',
    '',
  ];

  return lines.join('\r\n');
}
