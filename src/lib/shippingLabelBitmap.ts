import {
  LOGISTICS_LABEL_GAP_MM,
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import { buildCanvasTsplBitmapJob } from './localPrinterLabelBitmap';
import { LABEL_DPI, mmToDots } from './labelLayouts/units';
import { getLabelMediaForUsage } from './labelStudio';
import {
  formatShippingAddressLines,
  shippingLabelBarcodeBars,
  type ShippingLabelViewModel,
} from './shippingLabel';
import {
  drawRoundedRectStroke,
  drawShippingLabelHeader,
} from './shippingLabelHeader';
import {
  drawShippingIcon,
  type ShippingCanvasIcon,
} from './shippingLabelIconsCanvas';

const INK = '#111111';
const PAPER = '#ffffff';

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

function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
): { w: number; h: number } {
  ctx.font = `bold ${fontPx}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  const padX = fontPx * 0.55;
  const h = fontPx * 1.55;
  const w = ctx.measureText(text).width + padX * 2;
  const r = h / 2;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.fillText(text, x + padX, y + h / 2 + 0.5);
  ctx.fillStyle = INK;
  return { w, h };
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

  const outer = Math.max(2, mmToDots(0.55, LABEL_DPI));
  const pad = mmToDots(2.6, LABEL_DPI);
  const gap = mmToDots(1.6, LABEL_DPI);
  const line = Math.max(1, mmToDots(0.32, LABEL_DPI));
  const cornerR = mmToDots(4, LABEL_DPI);
  const panelR = mmToDots(2.2, LABEL_DPI);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  drawRoundedRectStroke(ctx, outer / 2, outer / 2, width - outer, height - outer, cornerR, outer);

  let y = pad;
  const contentX = pad;
  const contentW = width - pad * 2;
  const colW = contentW / 2;

  y = drawShippingLabelHeader(ctx, {
    x: contentX,
    y,
    width: contentW,
    firmName: label.firmName,
    dpiScale: LABEL_DPI / 203,
  });

  // —— Parties ——
  const partyH = mmToDots(28, LABEL_DPI);
  ctx.fillStyle = INK;
  ctx.fillRect(contentX, y, contentW, line);
  ctx.fillRect(contentX + colW, y, line, partyH);
  ctx.fillRect(contentX, y + partyH - line, contentW, line);

  const drawParty = (x: number, pill: string, name: string, address: string) => {
    const inner = mmToDots(1.8, LABEL_DPI);
    let py = y + mmToDots(2, LABEL_DPI);
    const { h: pillH } = drawPill(ctx, pill, x + inner, py, mmToDots(2.0, LABEL_DPI));
    py += pillH + mmToDots(1.5, LABEL_DPI);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.font = `bold ${mmToDots(2.7, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    for (const nl of wrapCanvasText(ctx, name, colW - inner * 2, 2)) {
      ctx.fillText(nl, x + inner, py);
      py += mmToDots(3.2, LABEL_DPI);
    }
    ctx.font = `${mmToDots(2.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    for (const al of formatShippingAddressLines(address, 5).split('\n')) {
      ctx.fillText(wrapCanvasText(ctx, al, colW - inner * 2, 1)[0] ?? al, x + inner, py);
      py += mmToDots(2.75, LABEL_DPI);
    }
  };
  drawParty(contentX, 'FROM (SHIPPER)', label.fromName, label.fromAddress);
  drawParty(contentX + colW, 'TO (CONSIGNEE)', label.toName, label.toAddress);
  y += partyH + gap;

  // —— Metrics panel ——
  const boxLabel = label.shipmentMode === 'envelope'
    ? '1/1'
    : `${label.boxIndex}/${label.boxTotal}`;
  const boxCount = label.shipmentMode === 'envelope' ? 'Envelope' : String(label.numberOfBoxes);
  const metrics: Array<[string, string, ShippingCanvasIcon]> = [
    ['NO. OF BOXES', boxCount, 'boxes'],
    ['BOX NUMBER', boxLabel, 'boxNumber'],
    ['BOX DIMENSIONS (L × B × H)', label.boxDimensions, 'dimensions'],
    ['CONTENTS', label.contents, 'contents'],
    ['GROSS WEIGHT', `${label.grossWeightKg.toFixed(2)} kg`, 'weight'],
    ['CHARGEABLE WEIGHT', `${label.chargeableWeightKg.toFixed(2)} kg`, 'weight'],
    ['MODE OF TRANSPORT', label.transportMode, 'transport'],
    ['PAYMENT MODE', label.paymentMode, 'payment'],
  ];
  const metricH = mmToDots(20, LABEL_DPI);
  const cellW = contentW / 4;
  const cellH = metricH / 2;
  drawRoundedRectStroke(ctx, contentX, y, contentW, metricH, panelR, line);
  for (let c = 1; c < 4; c += 1) ctx.fillRect(contentX + cellW * c, y, line, metricH);
  ctx.fillRect(contentX, y + cellH, contentW, line);

  metrics.forEach(([title, value, icon], index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const cx = contentX + col * cellW;
    const cy = y + row * cellH;
    const inset = mmToDots(1.2, LABEL_DPI);
    const iconSize = mmToDots(3.2, LABEL_DPI);
    drawShippingIcon(ctx, icon, cx + inset, cy + inset, iconSize);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.font = `bold ${mmToDots(1.7, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const titleX = cx + inset + iconSize + mmToDots(0.7, LABEL_DPI);
    const titleLines = wrapCanvasText(ctx, title, cellW - (titleX - cx) - inset, 2);
    let ty = cy + inset;
    for (const tl of titleLines) {
      ctx.fillText(tl, titleX, ty);
      ty += mmToDots(2.15, LABEL_DPI);
    }
    ctx.font = `bold ${mmToDots(2.7, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const valueLines = wrapCanvasText(ctx, value, cellW - inset * 2, 2);
    ty = cy + cellH - inset - valueLines.length * mmToDots(3.0, LABEL_DPI);
    for (const vl of valueLines) {
      ctx.fillText(vl, cx + inset, ty);
      ty += mmToDots(3.0, LABEL_DPI);
    }
  });
  y += metricH + gap;

  // —— Courier panel ——
  const courierH = mmToDots(24, LABEL_DPI);
  const courierSplit = contentW * 0.4;
  drawRoundedRectStroke(ctx, contentX, y, contentW, courierH, panelR, line);
  ctx.fillRect(contentX + courierSplit, y, line, courierH);

  const partnerImg = label.partnerImage ? await loadImage(label.partnerImage) : null;
  let cy = y + mmToDots(1.5, LABEL_DPI);
  drawPill(ctx, 'COURIER', contentX + mmToDots(1.5, LABEL_DPI), cy, mmToDots(1.95, LABEL_DPI));
  const logoAreaY = y + mmToDots(7.5, LABEL_DPI);
  const logoMaxH = mmToDots(9, LABEL_DPI);
  if (partnerImg) {
    const pw = Math.min(courierSplit - mmToDots(5, LABEL_DPI), (partnerImg.width / partnerImg.height) * logoMaxH);
    ctx.drawImage(partnerImg, contentX + (courierSplit - pw) / 2, logoAreaY, pw, logoMaxH);
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${mmToDots(2.2, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  const partnerLines = wrapCanvasText(ctx, label.partnerLabel.toUpperCase(), courierSplit - mmToDots(4, LABEL_DPI), 2);
  let ply = partnerImg ? logoAreaY + logoMaxH + mmToDots(0.8, LABEL_DPI) : y + courierH / 2 - mmToDots(2, LABEL_DPI);
  for (const pl of partnerLines) {
    ctx.fillText(pl, contentX + courierSplit / 2, ply);
    ply += mmToDots(2.6, LABEL_DPI);
  }

  const trackX = contentX + courierSplit;
  const trackW = contentW - courierSplit;
  ctx.font = `bold ${mmToDots(1.95, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
  const awbLabel = 'AWB / TRACKING NUMBER';
  const awbPillW = ctx.measureText(awbLabel).width + mmToDots(1.95, LABEL_DPI) * 1.1;
  drawPill(ctx, awbLabel, trackX + (trackW - awbPillW) / 2, y + mmToDots(1.5, LABEL_DPI), mmToDots(1.95, LABEL_DPI));

  ctx.fillStyle = INK;
  ctx.font = `900 ${mmToDots(5.6, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
  ctx.fillText(label.consignmentNo, trackX + trackW / 2, y + mmToDots(7.5, LABEL_DPI));

  const bars = shippingLabelBarcodeBars(label.consignmentNo);
  const barH = mmToDots(7.5, LABEL_DPI);
  const barY = y + courierH - barH - mmToDots(1.8, LABEL_DPI);
  const totalBarW = bars.reduce((sum, w) => sum + w + 1, 0);
  let bx = trackX + (trackW - totalBarW) / 2;
  for (const w of bars) {
    ctx.fillRect(bx, barY, Math.max(1, w), barH);
    bx += w + 1;
  }
  ctx.textAlign = 'left';
  y += courierH + gap;

  // —— Info panel 2×2 ——
  const infoH = Math.max(mmToDots(30, LABEL_DPI), height - pad - y);
  const infoRow1 = infoH * 0.58;
  const infoRow2 = infoH - infoRow1;
  drawRoundedRectStroke(ctx, contentX, y, contentW, infoH, panelR, line);
  ctx.fillRect(contentX + colW, y, line, infoH);
  ctx.fillRect(contentX, y + infoRow1, contentW, line);

  const drawInfo = (
    x: number,
    top: number,
    h: number,
    pill: string,
    value: string,
    icon: ShippingCanvasIcon,
    large: boolean,
  ) => {
    const inset = mmToDots(1.6, LABEL_DPI);
    const iconSize = mmToDots(3.2, LABEL_DPI);
    const pillY = top + inset;
    drawShippingIcon(ctx, icon, x + inset, pillY + mmToDots(0.2, LABEL_DPI), iconSize);
    const { h: pillH } = drawPill(
      ctx,
      pill,
      x + inset + iconSize + mmToDots(0.9, LABEL_DPI),
      pillY,
      mmToDots(1.85, LABEL_DPI),
    );
    ctx.fillStyle = INK;
    ctx.textBaseline = large ? 'bottom' : 'top';
    ctx.font = large
      ? `900 ${mmToDots(4.0, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`
      : `bold ${mmToDots(2.7, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const lines = wrapCanvasText(
      ctx,
      large ? value.toUpperCase() : value,
      colW - inset * 2,
      large ? 2 : 1,
    );
    if (large) {
      let ry = top + h - inset;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        ctx.fillText(lines[i], x + inset, ry);
        ry -= mmToDots(4.4, LABEL_DPI);
      }
    } else {
      ctx.fillText(lines[0] ?? '—', x + inset, top + inset + pillH + mmToDots(1.4, LABEL_DPI));
    }
  };

  drawInfo(contentX, y, infoRow1, 'BOOKING BRANCH', label.bookingBranch, 'branch', true);
  drawInfo(contentX + colW, y, infoRow1, 'DESTINATION', label.destinationCity, 'destination', true);
  drawInfo(contentX, y + infoRow1, infoRow2, 'BOOKING TIME', label.bookingTime, 'time', false);
  drawInfo(contentX + colW, y + infoRow1, infoRow2, 'BOOKED BY', label.bookedBy, 'bookedBy', false);

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
