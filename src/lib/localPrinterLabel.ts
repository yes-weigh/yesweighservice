/**
 * TSC TE210 TSPL layout for YesWeigh Genuine Spare bin labels.
 * Default media 75 × 45.5 mm @ 203 dpi, with 2 mm padding on all sides.
 */

export interface BinLabelFields {
  sku: string;
  itemName: string;
  masterSku: string;
  masterProduct: string;
  rack: string;
  /** Store-room row. */
  row: string;
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
  row: '5',
  bin: '3',
  qrPayload: '4pinCW',
  printedOn: new Date(),
};

/** TE210 print head density. */
const DPI = 203;

/** Clear margin from physical label edge to outer border / content. */
const PAD_MM = 2;

function mmToDots(mm: number): number {
  return Math.round((mm * DPI) / 25.4);
}

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

/** Approximate horizontal center for built-in font glyphs. */
function centerX(left: number, width: number, text: string, charWidth: number): number {
  const textWidth = text.length * charWidth;
  return Math.max(left, Math.round(left + (width - textWidth) / 2));
}

/**
 * Build a TSPL job matching the Genuine Spare mockup.
 * 2 mm padding on all sides; footer kept inside the border.
 */
export function buildGenuineSpareLabelTspl(
  fields: BinLabelFields,
  media: { labelWidthMm: number; labelHeightMm: number; labelGapMm: number },
): string {
  const sku = escapeTspl(fields.sku, 16);
  const itemName = escapeTspl(fields.itemName, 20);
  const masterSku = escapeTspl(fields.masterSku, 16);
  const masterProduct = escapeTspl(fields.masterProduct, 20);
  const rack = escapeTspl(fields.rack, 4);
  const row = escapeTspl(fields.row, 4);
  const bin = escapeTspl(fields.bin, 4);
  const qr = escapeTspl(fields.qrPayload, 80);
  const printed = escapeTspl(`PRINTED ON ${formatPrintedOn(fields.printedOn)}`, 26);

  const pad = mmToDots(PAD_MM);
  const pageW = mmToDots(media.labelWidthMm);
  const pageH = mmToDots(media.labelHeightMm);

  // Outer border inset by 2 mm from physical edge
  const boxL = pad;
  const boxT = pad;
  const boxR = pageW - pad;
  const boxB = pageH - pad;

  // Inner content inset from the border stroke
  const inset = 8;
  const contentL = boxL + inset;
  const contentT = boxT + inset;
  const contentR = boxR - inset;
  const contentB = boxB - inset;
  const contentW = contentR - contentL;

  // Footer band (date + brand) — keep fully above bottom border
  const footerH = 34;
  const footerTop = contentB - footerH;
  const bodyBottom = footerTop - 6;

  // Split body: left product ~48%, right location ~48%, gap between
  const splitGap = 10;
  const leftW = Math.floor(contentW * 0.48);
  const leftR = contentL + leftW;
  const locLeft = leftR + splitGap;
  const locRight = contentR;
  const locTop = contentT + 26;
  const locBottom = bodyBottom;
  const colW = Math.floor((locRight - locLeft) / 3);
  const c1 = locLeft;
  const c2 = locLeft + colW;
  const c3 = locLeft + colW * 2;
  const headerH = 24;
  const valueY = locTop + headerH + Math.floor((locBottom - locTop - headerH - 40) / 2);

  const headerText = 'YESWEIGH GENUINE SPARE';
  const headerX = centerX(contentL, contentW, headerText, 12);

  // QR cell size 3 ≈ 75–90 dots; keep clear of footer
  const qrY = contentT + 178;
  const qrHintX = contentL + 96;

  const lines: string[] = [
    `SIZE ${formatMm(media.labelWidthMm)} mm,${formatMm(media.labelHeightMm)} mm`,
    `GAP ${formatMm(Math.max(0, media.labelGapMm))} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    'CODEPAGE 850',

    // Outer border (2 mm from edge)
    `BOX ${boxL},${boxT},${boxR},${boxB},2`,

    // Header
    `TEXT ${headerX},${contentT},"2",0,1,1,"${headerText}"`,
    `BAR ${contentL},${contentT + 20},${contentW},2`,

    // --- Left: SKU badge ---
    `TEXT ${contentL + 10},${contentT + 32},"2",0,1,1,"SKU"`,
    `REVERSE ${contentL},${contentT + 26},56,26`,
    `TEXT ${contentL + 64},${contentT + 30},"3",0,1,1,"${sku}"`,
    `BAR ${contentL},${contentT + 56},${leftW},1`,

    // Item name
    `TEXT ${contentL},${contentT + 62},"1",0,1,1,"ITEM NAME"`,
    `TEXT ${contentL},${contentT + 76},"2",0,1,1,"${itemName}"`,
    `BAR ${contentL},${contentT + 98},${leftW},1`,

    // Master SKU
    `TEXT ${contentL},${contentT + 104},"1",0,1,1,"MASTER SKU"`,
    `TEXT ${contentL},${contentT + 118},"2",0,1,1,"${masterSku}"`,
    `BAR ${contentL},${contentT + 140},${leftW},1`,

    // Master product
    `TEXT ${contentL},${contentT + 146},"1",0,1,1,"MASTER PRODUCT"`,
    `TEXT ${contentL},${contentT + 160},"2",0,1,1,"${masterProduct}"`,

    // QR + scan hint
    `QRCODE ${contentL},${qrY},L,3,A,0,"${qr}"`,
    `TEXT ${qrHintX},${qrY + 16},"1",0,1,1,"SCAN FOR SKU INFO"`,
    `TEXT ${contentL},${bodyBottom - 12},"1",0,1,1,"Scan QR for product details"`,

    // --- Right: RACK / ROW / BIN ---
    `BOX ${locLeft},${locTop},${locRight},${locBottom},2`,
    `BAR ${c2},${locTop},2,${locBottom - locTop}`,
    `BAR ${c3},${locTop},2,${locBottom - locTop}`,

    `TEXT ${centerX(c1, colW, 'RACK', 12)},${locTop + 5},"2",0,1,1,"RACK"`,
    `REVERSE ${c1},${locTop},${colW},${headerH}`,
    `TEXT ${centerX(c2, colW, 'ROW', 12)},${locTop + 5},"2",0,1,1,"ROW"`,
    `REVERSE ${c2},${locTop},${colW},${headerH}`,
    `TEXT ${centerX(c3, colW, 'BIN', 12)},${locTop + 5},"2",0,1,1,"BIN"`,
    `REVERSE ${c3},${locTop},${colW},${headerH}`,

    `BAR ${locLeft},${locTop + headerH},${locRight - locLeft},2`,

    `TEXT ${centerX(c1, colW, rack, 24)},${valueY},"5",0,1,1,"${rack}"`,
    `TEXT ${centerX(c2, colW, row, 24)},${valueY},"5",0,1,1,"${row}"`,
    `TEXT ${centerX(c3, colW, bin, 24)},${valueY},"5",0,1,1,"${bin}"`,

    // Footer (inside 2 mm padding / border)
    `BAR ${contentL},${footerTop},${contentW},1`,
    `TEXT ${contentL},${footerTop + 6},"1",0,1,1,"${printed}"`,

    'PRINT 1,1',
    '',
  ];

  return lines.join('\r\n');
}
