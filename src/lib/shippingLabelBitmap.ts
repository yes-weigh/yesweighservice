import {
  LOGISTICS_LABEL_GAP_MM,
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import { buildCanvasTsplBitmapJob } from './localPrinterLabelBitmap';
import { LABEL_DPI, mmToDots } from './labelLayouts/units';
import { getLabelMediaForUsage } from './labelStudio';
import {
  shippingLabelBarcodeBars,
  type ShippingLabelViewModel,
} from './shippingLabel';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines.slice(0, maxLines) : ['—'];
}

/** Render one 100×150 mm shipping label to a 203 DPI canvas (WYSIWYG thermal bitmap). */
export async function renderShippingLabelCanvas(
  label: ShippingLabelViewModel,
): Promise<HTMLCanvasElement> {
  const width = mmToDots(LOGISTICS_LABEL_WIDTH_MM, LABEL_DPI);
  const height = mmToDots(LOGISTICS_LABEL_HEIGHT_MM, LABEL_DPI);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create shipping label canvas.');

  const pad = mmToDots(4, LABEL_DPI);
  const ink = '#111111';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, mmToDots(0.5, LABEL_DPI));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);

  let y = pad;
  const contentW = width - pad * 2;
  const colGap = mmToDots(2.5, LABEL_DPI);
  const colW = (contentW - colGap) / 2;

  // Header
  const logo = await loadImage('/logo.png');
  const logoH = mmToDots(7, LABEL_DPI);
  if (logo) {
    const logoW = Math.min(mmToDots(28, LABEL_DPI), (logo.width / logo.height) * logoH);
    ctx.drawImage(logo, pad, y, logoW, logoH);
  } else {
    ctx.fillStyle = ink;
    ctx.font = `bold ${mmToDots(4.5, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('YESWEIGH', pad, y);
  }
  ctx.fillStyle = ink;
  ctx.font = `bold ${mmToDots(3.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('GENUINE SPARE PART', width - pad, y + logoH / 2);
  ctx.textAlign = 'left';
  y += logoH + mmToDots(2, LABEL_DPI);

  ctx.fillStyle = ink;
  ctx.fillRect(pad, y, contentW, Math.max(2, mmToDots(0.6, LABEL_DPI)));
  y += mmToDots(3, LABEL_DPI);

  const drawParty = (x: number, title: string, name: string, address: string) => {
    ctx.fillStyle = ink;
    ctx.font = `bold ${mmToDots(2.4, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(title, x, y);
    let py = y + mmToDots(3.2, LABEL_DPI);
    ctx.font = `bold ${mmToDots(3.3, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const nameLines = wrapCanvasText(ctx, name, colW, 2);
    for (const line of nameLines) {
      ctx.fillText(line, x, py);
      py += mmToDots(3.8, LABEL_DPI);
    }
    ctx.font = `${mmToDots(2.7, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const addrLines = wrapCanvasText(ctx, address.replace(/\n/g, ' '), colW, 4);
    for (const line of addrLines) {
      ctx.fillText(line, x, py);
      py += mmToDots(3.3, LABEL_DPI);
    }
    return py;
  };

  const fromBottom = drawParty(pad, 'FROM (SHIPPER)', label.fromName, label.fromAddress);
  const toBottom = drawParty(pad + colW + colGap, 'TO (CONSIGNEE)', label.toName, label.toAddress);
  y = Math.max(fromBottom, toBottom) + mmToDots(2, LABEL_DPI);

  ctx.fillRect(pad, y, contentW, Math.max(1, mmToDots(0.35, LABEL_DPI)));
  y += mmToDots(2.5, LABEL_DPI);

  const boxLabel = label.shipmentMode === 'envelope'
    ? '1/1'
    : `${label.boxIndex}/${label.boxTotal}`;
  const boxCount = label.shipmentMode === 'envelope' ? 'Envelope' : String(label.numberOfBoxes);

  const drawMetric = (x: number, title: string, value: string) => {
    ctx.font = `bold ${mmToDots(2.3, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(title, x, y);
    ctx.font = `bold ${mmToDots(4.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(value, x, y + mmToDots(3.2, LABEL_DPI));
  };
  drawMetric(pad, 'NUMBER OF BOXES', boxCount);
  drawMetric(pad + colW + colGap, 'BOX NUMBER', boxLabel);
  y += mmToDots(9, LABEL_DPI);

  ctx.fillRect(pad, y, contentW, Math.max(1, mmToDots(0.35, LABEL_DPI)));
  y += mmToDots(2.5, LABEL_DPI);

  drawMetric(pad, 'GROSS WEIGHT', `${label.grossWeightKg.toFixed(2)} kg`);
  drawMetric(pad + colW + colGap, 'CHARGEABLE WEIGHT', `${label.chargeableWeightKg.toFixed(2)} kg`);
  y += mmToDots(9, LABEL_DPI);

  ctx.fillRect(pad, y, contentW, Math.max(1, mmToDots(0.35, LABEL_DPI)));
  y += mmToDots(3, LABEL_DPI);

  // Carrier + barcode
  const partnerImg = label.partnerImage ? await loadImage(label.partnerImage) : null;
  const carrierH = mmToDots(12, LABEL_DPI);
  if (partnerImg) {
    const partnerW = Math.min(colW, (partnerImg.width / partnerImg.height) * carrierH);
    ctx.drawImage(partnerImg, pad, y, partnerW, carrierH);
  } else {
    ctx.font = `bold ${mmToDots(3.5, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(label.partnerLabel, pad, y + mmToDots(2, LABEL_DPI));
  }

  ctx.font = `bold ${mmToDots(3.5, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(label.consignmentNo, width - pad, y);
  ctx.textAlign = 'left';

  const bars = shippingLabelBarcodeBars(label.consignmentNo);
  const barH = mmToDots(10, LABEL_DPI);
  const barY = y + mmToDots(4, LABEL_DPI);
  let bx = width - pad;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const w = Math.max(1, bars[i]);
    bx -= w + 1;
    ctx.fillRect(bx, barY, w, barH);
  }
  y = Math.max(y + carrierH, barY + barH) + mmToDots(3, LABEL_DPI);

  ctx.fillRect(pad, y, contentW, Math.max(2, mmToDots(0.6, LABEL_DPI)));
  y += mmToDots(3, LABEL_DPI);

  ctx.font = `bold ${mmToDots(2.3, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('DESTINATION CITY', pad, y);
  ctx.font = `bold ${mmToDots(4.5, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  ctx.fillText(label.destinationCity, pad, y + mmToDots(3.2, LABEL_DPI));

  const bookingLeft = pad + colW + colGap;
  const bookingRows: Array<[string, string]> = [
    ['BOOKING BRANCH', label.bookingBranch],
    ['BOOKING DATE', label.bookingDate],
    ['BOOKING TIME', label.bookingTime],
    ['BOOKED BY', label.bookedBy],
  ];
  let by = y;
  for (const [title, value] of bookingRows) {
    ctx.font = `bold ${mmToDots(2.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(title, bookingLeft, by);
    ctx.font = `bold ${mmToDots(3.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const lines = wrapCanvasText(ctx, value, colW, 2);
    ctx.fillText(lines[0] ?? '—', bookingLeft, by + mmToDots(2.8, LABEL_DPI));
    by += mmToDots(8, LABEL_DPI);
  }

  return canvas;
}

/** BITMAP TSPL job for one shipping label (same approach as catalog bin labels). */
export async function buildShippingLabelBitmapJob(
  label: ShippingLabelViewModel,
): Promise<Uint8Array> {
  const media = getLabelMediaForUsage('logistics_shipping');
  const canvas = await renderShippingLabelCanvas(label);
  return buildCanvasTsplBitmapJob(canvas, {
    labelWidthMm: media.labelWidthMm || LOGISTICS_LABEL_WIDTH_MM,
    labelHeightMm: media.labelHeightMm || LOGISTICS_LABEL_HEIGHT_MM,
    labelGapMm: media.labelGapMm || LOGISTICS_LABEL_GAP_MM,
  });
}
