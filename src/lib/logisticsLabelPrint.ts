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
    const payload = buildShippingLabelTspl(label);
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
