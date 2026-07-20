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
  shippingLabelMetricCells,
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

/** Black-on-white section label (no inverted pills). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
): { w: number; h: number } {
  ctx.font = `900 ${fontPx}px Arial Black, Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillText(text, x, y);
  return { w: ctx.measureText(text).width, h: fontPx * 1.2 };
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

  const outerMargin = mmToDots(2.5, LABEL_DPI); // white pad outside the border
  const borderW = Math.max(2, mmToDots(0.55, LABEL_DPI));
  const pad = mmToDots(2.2, LABEL_DPI); // pad inside the border
  const gap = mmToDots(1.2, LABEL_DPI);
  const line = Math.max(1, mmToDots(0.32, LABEL_DPI));
  const cornerR = mmToDots(3.2, LABEL_DPI);
  const panelR = mmToDots(2.2, LABEL_DPI);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  const frameX = outerMargin;
  const frameY = outerMargin;
  const frameW = width - outerMargin * 2;
  const frameH = height - outerMargin * 2;
  drawRoundedRectStroke(ctx, frameX + borderW / 2, frameY + borderW / 2, frameW - borderW, frameH - borderW, cornerR, borderW);

  let y = frameY + borderW + pad;
  const contentX = frameX + borderW + pad;
  const contentW = frameW - borderW * 2 - pad * 2;
  const colW = contentW / 2;

  y = await drawShippingLabelHeader(ctx, {
    x: contentX,
    y,
    width: contentW,
    firmName: label.firmName,
    dpiScale: LABEL_DPI / 203,
  });

  // —— Parties (no bottom rule — metrics panel owns its top border) ——
  const partyH = mmToDots(30, LABEL_DPI);
  ctx.fillStyle = INK;
  ctx.fillRect(contentX, y, contentW, line);
  ctx.fillRect(contentX + colW, y, line, partyH);

  const drawParty = (x: number, labelText: string, name: string, address: string) => {
    const inner = mmToDots(1.6, LABEL_DPI);
    const maxW = colW - inner * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, colW - 2, partyH - 2);
    ctx.clip();

    let py = y + mmToDots(1.6, LABEL_DPI);
    const { h: labelH } = drawLabel(ctx, labelText, x + inner, py, mmToDots(2.3, LABEL_DPI));
    py += labelH + mmToDots(0.8, LABEL_DPI);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.font = `900 ${mmToDots(2.9, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
    for (const nl of wrapCanvasText(ctx, name, maxW, 2)) {
      ctx.fillText(nl, x + inner, py);
      py += mmToDots(3.3, LABEL_DPI);
    }
    py += mmToDots(0.3, LABEL_DPI);
    ctx.font = `700 ${mmToDots(2.45, LABEL_DPI)}px Arial, Helvetica, sans-serif`;
    const addrBottom = y + partyH - mmToDots(1.2, LABEL_DPI);
    const lineH = mmToDots(2.85, LABEL_DPI);
    for (const al of formatShippingAddressLines(address, 4).split('\n')) {
      if (py + lineH > addrBottom) break;
      ctx.fillText(wrapCanvasText(ctx, al, maxW, 1)[0] ?? al, x + inner, py);
      py += lineH;
    }
    ctx.restore();
  };
  drawParty(contentX, 'FROM (SHIPPER)', label.fromName, label.fromAddress);
  drawParty(contentX + colW, 'TO (CONSIGNEE)', label.toName, label.toAddress);
  y += partyH + gap;

  // —— Metrics panel (short titles + stacked value — no overlap) ——
  const metrics = shippingLabelMetricCells(label);
  const metricH = mmToDots(26, LABEL_DPI);
  const cellW = contentW / 4;
  const cellH = metricH / 2;
  drawRoundedRectStroke(ctx, contentX, y, contentW, metricH, panelR, line);
  for (let c = 1; c < 4; c += 1) ctx.fillRect(contentX + cellW * c, y, line, metricH);
  ctx.fillRect(contentX, y + cellH, contentW, line);

  metrics.forEach(({ title, value, icon }, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const cx = contentX + col * cellW;
    const cy = y + row * cellH;
    const inset = mmToDots(1.1, LABEL_DPI);
    const iconSize = mmToDots(3.1, LABEL_DPI);
    const maxW = cellW - inset * 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx + 1, cy + 1, cellW - 2, cellH - 2);
    ctx.clip();

    drawShippingIcon(ctx, icon, cx + inset, cy + inset + mmToDots(0.15, LABEL_DPI), iconSize);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.font = `900 ${mmToDots(2.05, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
    const titleX = cx + inset + iconSize + mmToDots(0.6, LABEL_DPI);
    const titleMaxW = Math.max(8, cx + cellW - inset - titleX);
    const titleText = wrapCanvasText(ctx, title, titleMaxW, 1)[0] ?? title;
    ctx.fillText(titleText, titleX, cy + inset + mmToDots(0.35, LABEL_DPI));

    const valueY = cy + inset + iconSize + mmToDots(1.4, LABEL_DPI);
    ctx.font = `900 ${mmToDots(2.95, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
    const valueLineH = mmToDots(3.25, LABEL_DPI);
    const valueLines = wrapCanvasText(ctx, value, maxW, 2);
    let vy = valueY;
    for (const vl of valueLines) {
      ctx.fillText(vl, cx + inset, vy);
      vy += valueLineH;
    }
    ctx.restore();
  });
  y += metricH + gap;

  // —— Courier panel ——
  const contentBottom = frameY + frameH - borderW - pad;
  const infoMinH = mmToDots(11, LABEL_DPI);
  const courierH = Math.max(
    mmToDots(22, LABEL_DPI),
    Math.min(mmToDots(24, LABEL_DPI), contentBottom - y - infoMinH - gap),
  );
  const courierSplit = contentW * 0.38;
  drawRoundedRectStroke(ctx, contentX, y, contentW, courierH, panelR, line);
  ctx.fillRect(contentX + courierSplit, y, line, courierH);

  const partnerImg = label.partnerImage ? await loadImage(label.partnerImage) : null;
  drawLabel(ctx, 'COURIER', contentX + mmToDots(1.4, LABEL_DPI), y + mmToDots(1.3, LABEL_DPI), mmToDots(2.3, LABEL_DPI));
  const logoAreaY = y + mmToDots(6.5, LABEL_DPI);
  const logoMaxH = mmToDots(8, LABEL_DPI);
  if (partnerImg) {
    const pw = Math.min(courierSplit - mmToDots(4, LABEL_DPI), (partnerImg.width / partnerImg.height) * logoMaxH);
    ctx.drawImage(partnerImg, contentX + (courierSplit - pw) / 2, logoAreaY, pw, logoMaxH);
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${mmToDots(2.6, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
  const partnerLines = wrapCanvasText(ctx, label.partnerLabel.toUpperCase(), courierSplit - mmToDots(3.5, LABEL_DPI), 2);
  let ply = partnerImg ? logoAreaY + logoMaxH + mmToDots(0.6, LABEL_DPI) : y + courierH / 2 - mmToDots(1.5, LABEL_DPI);
  for (const pl of partnerLines) {
    if (ply + mmToDots(3, LABEL_DPI) > y + courierH - mmToDots(1, LABEL_DPI)) break;
    ctx.fillText(pl, contentX + courierSplit / 2, ply);
    ply += mmToDots(3, LABEL_DPI);
  }

  const trackX = contentX + courierSplit;
  const trackW = contentW - courierSplit;
  const awbLabel = 'AWB / TRACKING';
  ctx.font = `900 ${mmToDots(2.3, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
  const awbW = ctx.measureText(awbLabel).width;
  drawLabel(ctx, awbLabel, trackX + (trackW - awbW) / 2, y + mmToDots(1.2, LABEL_DPI), mmToDots(2.3, LABEL_DPI));

  const bars = shippingLabelBarcodeBars(label.consignmentNo);
  const barH = mmToDots(6.8, LABEL_DPI);
  const barY = y + courierH - barH - mmToDots(1.4, LABEL_DPI);
  const awbFont = mmToDots(5.4, LABEL_DPI);
  const awbY = y + mmToDots(5.8, LABEL_DPI);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = `900 ${awbFont}px Arial Black, Arial, Helvetica, sans-serif`;
  const awbText = wrapCanvasText(ctx, label.consignmentNo, trackW - mmToDots(3, LABEL_DPI), 1)[0] ?? label.consignmentNo;
  ctx.fillText(awbText, trackX + trackW / 2, awbY);

  const quiet = mmToDots(2.2, LABEL_DPI);
  const usableW = Math.max(1, trackW - quiet * 2);
  const modules = bars.reduce((sum, w) => sum + w, 0);
  const moduleW = usableW / modules;
  let bx = trackX + quiet;
  for (let i = 0; i < bars.length; i += 1) {
    const w = bars[i]! * moduleW;
    if (i % 2 === 0) ctx.fillRect(Math.round(bx), barY, Math.max(1, Math.round(w)), barH);
    bx += w;
  }
  ctx.textAlign = 'left';
  y += courierH + gap;

  // —— Info panel: booking time | booked by ——
  const infoH = Math.max(infoMinH, Math.min(mmToDots(14, LABEL_DPI), contentBottom - y));
  drawRoundedRectStroke(ctx, contentX, y, contentW, infoH, panelR, line);
  ctx.fillRect(contentX + colW, y, line, infoH);

  const drawInfo = (
    x: number,
    labelText: string,
    value: string,
    icon: ShippingCanvasIcon,
  ) => {
    const inset = mmToDots(1.5, LABEL_DPI);
    const iconSize = mmToDots(3.4, LABEL_DPI);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, colW - 2, infoH - 2);
    ctx.clip();
    drawShippingIcon(ctx, icon, x + inset, y + inset + mmToDots(0.1, LABEL_DPI), iconSize);
    const { h: labelH } = drawLabel(
      ctx,
      labelText,
      x + inset + iconSize + mmToDots(0.7, LABEL_DPI),
      y + inset,
      mmToDots(2.3, LABEL_DPI),
    );
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `900 ${mmToDots(3.2, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
    const lines = wrapCanvasText(ctx, value, colW - inset * 2, 1);
    ctx.fillText(lines[0] ?? '—', x + inset, y + inset + labelH + mmToDots(1, LABEL_DPI));
    ctx.restore();
  };

  drawInfo(contentX, 'BOOKING TIME', label.bookingTime, 'time');
  drawInfo(contentX + colW, 'BOOKED BY', label.bookedBy, 'bookedBy');

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
