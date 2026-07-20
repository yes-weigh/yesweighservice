import {
  LOGISTICS_LABEL_GAP_MM,
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import { isNativePrintAvailable, sendRawToPrinter } from './localPrinterPrint';
import {
  getLabelMediaForUsage,
  getLogisticsLabelPrinter,
  loadLabelStudioDoc,
} from './labelStudio';
import type { ShippingLabelViewModel } from './shippingLabel';
import { buildShippingLabelBitmapJob } from './shippingLabelBitmap';
import { SHIPPING_LABEL_HEADER_STYLES } from './shippingLabelHeader';

function escapeTspl(value: string): string {
  return value.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim();
}

function wrapLines(value: string, maxLen: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLen) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.slice(0, maxLen);
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  while (lines.length < 1) lines.push('—');
  return lines.slice(0, maxLines);
}

/** Build TSPL for one 100×150 mm shipping label. */
export function buildShippingLabelTspl(
  label: ShippingLabelViewModel,
  media = getLabelMediaForUsage('logistics_shipping'),
): string {
  const width = media.labelWidthMm || LOGISTICS_LABEL_WIDTH_MM;
  const height = media.labelHeightMm || LOGISTICS_LABEL_HEIGHT_MM;
  const gap = media.labelGapMm || LOGISTICS_LABEL_GAP_MM;
  const fromLines = wrapLines(`${label.fromName} ${label.fromAddress}`, 28, 4);
  const toLines = wrapLines(`${label.toName} ${label.toAddress}`, 28, 4);
  const boxLabel = label.shipmentMode === 'envelope'
    ? '1/1'
    : `${label.boxIndex}/${label.boxTotal}`;
  const boxCount = label.shipmentMode === 'envelope' ? 'ENV' : String(label.numberOfBoxes);

  const lines = [
    `SIZE ${width} mm,${height} mm`,
    `GAP ${gap} mm,0`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    'TEXT 40,40,"3",0,1,1,"YESWEIGH"',
    'TEXT 320,48,"2",0,1,1,"GENUINE SPARE PART"',
    'BAR 40,90,720,3',
    'TEXT 40,110,"1",0,1,1,"FROM (SHIPPER)"',
    'TEXT 400,110,"1",0,1,1,"TO (CONSIGNEE)"',
    ...fromLines.map((line, i) => `TEXT 40,${140 + i * 28},"2",0,1,1,"${escapeTspl(line)}"`),
    ...toLines.map((line, i) => `TEXT 400,${140 + i * 28},"2",0,1,1,"${escapeTspl(line)}"`),
    'BAR 40,270,720,2',
    `TEXT 40,290,"1",0,1,1,"NUMBER OF BOXES"`,
    `TEXT 40,320,"3",0,1,1,"${escapeTspl(boxCount)}"`,
    `TEXT 400,290,"1",0,1,1,"BOX NUMBER"`,
    `TEXT 400,320,"3",0,1,1,"${escapeTspl(boxLabel)}"`,
    'BAR 40,370,720,2',
    'TEXT 40,390,"1",0,1,1,"GROSS WEIGHT"',
    `TEXT 40,420,"3",0,1,1,"${label.grossWeightKg.toFixed(2)} kg"`,
    'TEXT 400,390,"1",0,1,1,"CHARGEABLE WEIGHT"',
    `TEXT 400,420,"3",0,1,1,"${label.chargeableWeightKg.toFixed(2)} kg"`,
    'BAR 40,470,720,2',
    `TEXT 40,500,"2",0,1,1,"${escapeTspl(label.partnerLabel)}"`,
    `BARCODE 360,490,"128",80,1,0,2,4,"${escapeTspl(label.consignmentNo)}"`,
    `TEXT 360,590,"2",0,1,1,"${escapeTspl(label.consignmentNo)}"`,
    'BAR 40,640,720,3',
    'TEXT 40,660,"1",0,1,1,"DESTINATION CITY"',
    `TEXT 40,690,"3",0,1,1,"${escapeTspl(label.destinationCity)}"`,
    'TEXT 400,660,"1",0,1,1,"BOOKING BRANCH"',
    `TEXT 400,690,"2",0,1,1,"${escapeTspl(label.bookingBranch)}"`,
    'TEXT 400,740,"1",0,1,1,"BOOKING DATE"',
    `TEXT 400,770,"2",0,1,1,"${escapeTspl(label.bookingDate)}"`,
    'TEXT 400,810,"1",0,1,1,"BOOKING TIME"',
    `TEXT 400,840,"2",0,1,1,"${escapeTspl(label.bookingTime)}"`,
    'TEXT 400,880,"1",0,1,1,"BOOKED BY"',
    `TEXT 400,910,"2",0,1,1,"${escapeTspl(label.bookedBy)}"`,
    'PRINT 1,1',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function buildCourierLabelTspl(input: {
  partnerLabel: string;
  consignmentNo: string;
  deliverToName: string;
  deliverToAddress: string;
  serviceType: string;
  branch: string;
  pieces: string;
  weightKg: number;
  media?: ReturnType<typeof getLabelMediaForUsage>;
}): string {
  const media = input.media ?? getLabelMediaForUsage('logistics_courier');
  const width = media.labelWidthMm || LOGISTICS_LABEL_WIDTH_MM;
  const height = media.labelHeightMm || LOGISTICS_LABEL_HEIGHT_MM;
  const gap = media.labelGapMm || LOGISTICS_LABEL_GAP_MM;
  const toLines = wrapLines(`${input.deliverToName} ${input.deliverToAddress}`, 42, 5);

  const lines = [
    `SIZE ${width} mm,${height} mm`,
    `GAP ${gap} mm,0`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
    `TEXT 40,40,"3",0,1,1,"${escapeTspl(input.partnerLabel)}"`,
    'TEXT 40,90,"2",0,1,1,"COURIER LABEL"',
    'BAR 40,130,720,3',
    `BARCODE 80,160,"128",120,1,0,3,6,"${escapeTspl(input.consignmentNo)}"`,
    `TEXT 80,310,"3",0,1,1,"${escapeTspl(input.consignmentNo)}"`,
    'BAR 40,360,720,2',
    'TEXT 40,390,"1",0,1,1,"DELIVER TO"',
    ...toLines.map((line, i) => `TEXT 40,${420 + i * 32},"2",0,1,1,"${escapeTspl(line)}"`),
    'BAR 40,600,720,2',
    'TEXT 40,630,"1",0,1,1,"SERVICE"',
    `TEXT 40,660,"2",0,1,1,"${escapeTspl(input.serviceType || '—')}"`,
    'TEXT 400,630,"1",0,1,1,"BRANCH"',
    `TEXT 400,660,"2",0,1,1,"${escapeTspl(input.branch || '—')}"`,
    'TEXT 40,720,"1",0,1,1,"PIECES"',
    `TEXT 40,750,"3",0,1,1,"${escapeTspl(input.pieces)}"`,
    'TEXT 400,720,"1",0,1,1,"WEIGHT"',
    `TEXT 400,750,"3",0,1,1,"${input.weightKg.toFixed(2)} kg"`,
    'PRINT 1,1',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export async function resolveLogisticsPrinterOrThrow(): Promise<{ host: string; port: number }> {
  const studio = await loadLabelStudioDoc();
  const printer = getLogisticsLabelPrinter(studio);
  if (!printer.host.trim()) {
    throw new Error('Set the logistics label printer IP in Admin → Settings → Label printing.');
  }
  return { host: printer.host.trim(), port: printer.port };
}

/** Native thermal print when APK + IP available; otherwise returns false for browser fallback. */
export async function tryPrintShippingLabelsThermal(
  labels: ShippingLabelViewModel[],
): Promise<{ usedThermal: boolean; bytesSent: number }> {
  if (!isNativePrintAvailable() || !labels.length) {
    return { usedThermal: false, bytesSent: 0 };
  }
  const printer = await resolveLogisticsPrinterOrThrow();
  let bytesSent = 0;
  for (const label of labels) {
    // Bitmap job (catalog-style) — not vector TEXT TSPL.
    const payload = await buildShippingLabelBitmapJob(label);
    const result = await sendRawToPrinter({ ...printer, payload });
    bytesSent += result.bytesSent;
  }
  return { usedThermal: true, bytesSent };
}

export async function tryPrintCourierLabelThermal(input: {
  partnerLabel: string;
  consignmentNo: string;
  deliverToName: string;
  deliverToAddress: string;
  serviceType: string;
  branch: string;
  pieces: string;
  weightKg: number;
}): Promise<{ usedThermal: boolean; bytesSent: number }> {
  if (!isNativePrintAvailable()) {
    return { usedThermal: false, bytesSent: 0 };
  }
  const printer = await resolveLogisticsPrinterOrThrow();
  const payload = buildCourierLabelTspl(input);
  const result = await sendRawToPrinter({ ...printer, payload });
  return { usedThermal: true, bytesSent: result.bytesSent };
}

/** Shared sheet CSS for browser print + standalone shipping-label HTML. */
export const SHIPPING_LABEL_SHEET_STYLES = `
  .sheet {
    width: ${LOGISTICS_LABEL_WIDTH_MM}mm;
    height: ${LOGISTICS_LABEL_HEIGHT_MM}mm;
    margin: 0;
    border: none;
    padding: 2.5mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    gap: 0;
    box-sizing: border-box;
    color: #111;
    background: #fff;
    font-family: Arial, Helvetica, sans-serif;
  }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .sheet__frame {
    flex: 1 1 auto;
    min-height: 0;
    border: 2.5px solid #111;
    border-radius: 3.2mm;
    padding: 2.4mm 2.4mm 2.2mm;
    background: #fff;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  ${SHIPPING_LABEL_HEADER_STYLES}
  .sheet__header { border-bottom: none; margin: 0; padding-bottom: 0; }
  .sheet__label {
    display: block;
    color: #111;
    background: none;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    line-height: 1.15;
    margin-bottom: 0;
  }
  .sheet__glyph { width: 12px; height: 12px; flex-shrink: 0; }
  .sheet__metric-head .sheet__glyph { width: 11px; height: 11px; }
  .sheet__panel {
    border: 1.4px solid #111;
    border-radius: 2.2mm;
    overflow: hidden;
    margin-top: 1.2mm;
  }
  .sheet__parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1.5px solid #111;
    border-bottom: none;
    margin: 1.2mm 0 0;
    max-height: 32mm;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .sheet__party { padding: 6px; min-width: 0; overflow: hidden; }
  .sheet__party .sheet__label { margin-bottom: 3px; }
  .sheet__party + .sheet__party { border-left: 1.5px solid #111; }
  .sheet__party-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    font-size: 11px;
    font-weight: 900;
    line-height: 1.18;
    margin-bottom: 2px;
  }
  .sheet__party-address {
    margin: 0;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.22;
    white-space: pre-line;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    overflow: hidden;
  }
  .sheet__metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: 1fr 1fr;
    margin: 0;
    min-height: 96px;
    flex: 0 0 auto;
  }
  .sheet__metric {
    padding: 5px 4px;
    border-right: 1px solid #111;
    border-bottom: 1px solid #111;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }
  .sheet__metric:nth-child(4n) { border-right: none; }
  .sheet__metric:nth-child(n + 5) { border-bottom: none; }
  .sheet__metric-head { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .sheet__metric-title {
    font-size: 7.5px;
    font-weight: 900;
    text-transform: uppercase;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .sheet__metric-value {
    font-size: 11px;
    font-weight: 900;
    line-height: 1.15;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
  .sheet__courier {
    display: grid;
    grid-template-columns: 0.85fr 1.25fr;
    margin: 0;
    min-height: 80px;
    flex: 1 1 auto;
  }
  .sheet__courier-side {
    padding: 6px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sheet__courier-side + .sheet__courier-side { border-left: 1.4px solid #111; }
  .sheet__courier-side--track { align-items: center; text-align: center; }
  .sheet__courier-side > .sheet__label { margin-bottom: 4px; }
  .sheet__carrier-logo {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .sheet__carrier-logo img { max-width: 100%; max-height: 36px; object-fit: contain; }
  .sheet__carrier-name {
    font-size: 11px;
    font-weight: 900;
    text-align: center;
    text-transform: uppercase;
  }
  .sheet__awb {
    display: block;
    font-family: Arial Black, Arial, Helvetica, sans-serif;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 0.03em;
    margin: 4px 0 5px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sheet__barcode {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: 0;
    height: 24px;
    width: 100%;
    margin-top: auto;
    padding: 0 8px;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .sheet__barcode i {
    display: block;
    min-width: 0;
    height: 100%;
  }
  .sheet__info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin: 0;
    margin-top: auto;
    min-height: 44px;
  }
  .sheet__info-cell {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    border-right: 1.4px solid #111;
  }
  .sheet__info-cell:nth-child(2n) { border-right: none; }
  .sheet__info-head { display: flex; align-items: center; gap: 4px; }
  .sheet__info-cell strong {
    font-size: 14px;
    font-weight: 900;
    line-height: 1.15;
    word-break: break-word;
  }
`;

/** Browser print fallback — clones rendered 100×150 mm sheets into a print window. */
export const SHIPPING_LABEL_BROWSER_PRINT_STYLES = `
  @page { margin: 0; size: ${LOGISTICS_LABEL_WIDTH_MM}mm ${LOGISTICS_LABEL_HEIGHT_MM}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  ${SHIPPING_LABEL_SHEET_STYLES}
`;

export function printShippingLabelElements(
  elements: Array<HTMLElement | null>,
  title = 'Shipping label',
): void {
  const sheets = elements.filter((el): el is HTMLElement => Boolean(el));
  if (!sheets.length || typeof window === 'undefined') return;
  const win = window.open('', '_blank', 'noopener,noreferrer,width=420,height=640');
  if (!win) {
    throw new Error('Pop-up blocked. Allow pop-ups to print the shipping label.');
  }
  win.document.open();
  win.document.write(
    `<!DOCTYPE html><html><head><title>${title}</title>`
    + `<style>${SHIPPING_LABEL_BROWSER_PRINT_STYLES}</style></head>`
    + `<body>${sheets.map(el => el.outerHTML).join('')}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.onload = () => {
    win.print();
  };
  window.setTimeout(() => {
    try { win.print(); } catch { /* ignore */ }
  }, 250);
}
