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
  shippingLabelMetricRows,
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

  const pushHard = (chunk: string) => {
    if (!chunk || lines.length >= maxLines) return;
    lines.push(chunk);
  };

  const breakLongWord = (word: string): string[] => {
    const parts: string[] = [];
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk && ctx.measureText(next).width > maxWidth) {
        parts.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    if (chunk) parts.push(chunk);
    return parts.length ? parts : [word];
  };

  for (const word of words) {
    if (lines.length >= maxLines) break;
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) {
      pushHard(current);
      current = '';
    }
    if (lines.length >= maxLines) break;
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    const parts = breakLongWord(word);
    for (let i = 0; i < parts.length; i += 1) {
      if (lines.length >= maxLines) break;
      if (i < parts.length - 1) pushHard(parts[i]!);
      else current = parts[i]!;
    }
  }
  if (current && lines.length < maxLines) pushHard(current);
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

  // —— Parties: all leftover height after metrics/courier/info goes here ——
  const metricH = mmToDots(24, LABEL_DPI);
  const courierHTarget = mmToDots(22, LABEL_DPI);
  const infoHFixed = mmToDots(11.5, LABEL_DPI);
  const contentBottomEarly = frameY + frameH - borderW - pad;
  const reservedBelow = metricH + courierHTarget + infoHFixed + gap * 3;
  const partyH = Math.max(mmToDots(28, LABEL_DPI), contentBottomEarly - y - reservedBelow);
  ctx.fillStyle = INK;
  ctx.fillRect(contentX, y, contentW, line);
  ctx.fillRect(contentX + colW, y, line, partyH);

  const drawParty = (
    x: number,
    labelText: string,
    name: string,
    address: string,
    phone = '',
  ) => {
    const inner = mmToDots(1.8, LABEL_DPI);
    const maxW = colW - inner * 2;
    const topPad = mmToDots(1.5, LABEL_DPI);
    const bottomPad = mmToDots(1.5, LABEL_DPI);
    const usableH = Math.max(1, partyH - topPad - bottomPad);
    const phoneText = phone.trim();
    const sectionLabelH = Math.min(mmToDots(2.8, LABEL_DPI), Math.max(mmToDots(2.5, LABEL_DPI), usableH * 0.072));

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, colW - 2, partyH - 2);
    ctx.clip();

    const buildAddrLines = (fontPx: number, maxLines: number): string[] => {
      ctx.font = `900 ${fontPx}px Arial Black, Arial, Helvetica, sans-serif`;
      const raw = formatShippingAddressLines(address, 8).split('\n').filter(Boolean);
      const out: string[] = [];
      for (const rawLine of raw) {
        if (out.length >= maxLines) break;
        for (const wl of wrapCanvasText(ctx, rawLine, maxW, maxLines - out.length)) {
          if (out.length >= maxLines) break;
          out.push(wl);
        }
      }
      return out.length ? out : ['—'];
    };

    // Prefer large bold type; shrink only if content would overflow.
    let nameFont = Math.min(mmToDots(4.5, LABEL_DPI), Math.max(mmToDots(3.5, LABEL_DPI), usableH * 0.13));
    let addrFont = Math.min(mmToDots(3.7, LABEL_DPI), Math.max(mmToDots(3.0, LABEL_DPI), usableH * 0.105));
    let nameLines: string[] = [];
    let addrLines: string[] = [];
    let nameLineH = 0;
    let addrLineH = 0;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      nameLineH = nameFont * 1.16;
      addrLineH = addrFont * 1.2;
      ctx.font = `900 ${nameFont}px Arial Black, Arial, Helvetica, sans-serif`;
      nameLines = wrapCanvasText(ctx, name, maxW, 3);
      const fixed = sectionLabelH * 1.15
        + mmToDots(1.2, LABEL_DPI)
        + nameLines.length * nameLineH
        + mmToDots(1.1, LABEL_DPI)
        + (phoneText ? addrLineH + mmToDots(1.2, LABEL_DPI) : 0);
      const maxAddrLines = Math.max(2, Math.floor((usableH - fixed) / addrLineH));
      addrLines = buildAddrLines(addrFont, maxAddrLines);
      const used = fixed + addrLines.length * addrLineH;
      if (used <= usableH || nameFont <= mmToDots(3.2, LABEL_DPI)) break;
      nameFont *= 0.93;
      addrFont *= 0.93;
    }

    // Pack from the top, then stretch line spacing so the column fills evenly.
    const baseLabelGap = mmToDots(1.2, LABEL_DPI);
    const baseNameGap = mmToDots(1.1, LABEL_DPI);
    const basePhoneGap = phoneText ? mmToDots(1.2, LABEL_DPI) : 0;
    const packed = sectionLabelH * 1.15
      + baseLabelGap
      + nameLines.length * nameLineH
      + baseNameGap
      + addrLines.length * addrLineH
      + basePhoneGap
      + (phoneText ? addrLineH : 0);
    const slack = Math.max(0, usableH - packed);
    const stretchSlots = nameLines.length + addrLines.length + (phoneText ? 1 : 0) + 2;
    const bump = slack / Math.max(1, stretchSlots);
    nameLineH += bump;
    addrLineH += bump;
    const labelGap = baseLabelGap + bump;
    const nameGap = baseNameGap + bump;
    const phoneGap = basePhoneGap + (phoneText ? bump : 0);

    let py = y + topPad;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    drawLabel(ctx, labelText, x + inner, py, sectionLabelH);
    py += sectionLabelH * 1.15 + labelGap;

    ctx.font = `900 ${nameFont}px Arial Black, Arial, Helvetica, sans-serif`;
    for (const nl of nameLines) {
      ctx.fillText(nl, x + inner, py);
      py += nameLineH;
    }
    py += nameGap;

    ctx.font = `900 ${addrFont}px Arial Black, Arial, Helvetica, sans-serif`;
    for (const al of addrLines) {
      ctx.fillText(al, x + inner, py);
      py += addrLineH;
    }

    if (phoneText) {
      py += phoneGap;
      const phoneLine = wrapCanvasText(ctx, `Ph: ${phoneText}`, maxW, 1)[0] ?? `Ph: ${phoneText}`;
      ctx.fillText(phoneLine, x + inner, py);
    }
    ctx.restore();
  };
  drawParty(contentX, 'FROM (SHIPPER)', label.fromName, label.fromAddress);
  drawParty(contentX + colW, 'TO (CONSIGNEE)', label.toName, label.toAddress, label.toPhone);
  y += partyH + gap;

  // —— Metrics panel: top 3 cols (no CONTENTS), bottom 4 cols ——
  const metricRows = shippingLabelMetricRows(label);
  const cellH = metricH / metricRows.length;
  drawRoundedRectStroke(ctx, contentX, y, contentW, metricH, panelR, line);
  for (let r = 1; r < metricRows.length; r += 1) {
    ctx.fillRect(contentX, y + cellH * r, contentW, line);
  }

  metricRows.forEach((rowCells, row) => {
    const cols = rowCells.length;
    const cellW = contentW / cols;
    for (let c = 1; c < cols; c += 1) {
      ctx.fillRect(contentX + cellW * c, y + cellH * row, line, cellH);
    }
    rowCells.forEach(({ title, value, icon }, col) => {
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
  });
  y += metricH + gap;

  // —— Courier panel ——
  const contentBottom = frameY + frameH - borderW - pad;
  const courierH = Math.max(
    mmToDots(21, LABEL_DPI),
    Math.min(courierHTarget, contentBottom - y - infoHFixed - gap),
  );
  const courierSplit = contentW * 0.38;
  drawRoundedRectStroke(ctx, contentX, y, contentW, courierH, panelR, line);
  ctx.fillRect(contentX + courierSplit, y, line, courierH);

  // Courier cell: logo only, edge-to-edge inside the panel border.
  const partnerImg = label.partnerImage ? await loadImage(label.partnerImage) : null;
  const logoInset = Math.max(1, line); // stay just inside the stroke
  const logoBoxX = contentX + logoInset;
  const logoBoxY = y + logoInset;
  const logoBoxW = courierSplit - logoInset * 2 - line;
  const logoBoxH = courierH - logoInset * 2;
  if (partnerImg && partnerImg.width > 0 && partnerImg.height > 0) {
    // Cover the cell (crops asset padding) so the mark fills the courier panel.
    ctx.save();
    ctx.beginPath();
    ctx.rect(logoBoxX, logoBoxY, logoBoxW, logoBoxH);
    ctx.clip();
    const scale = Math.max(logoBoxW / partnerImg.width, logoBoxH / partnerImg.height);
    const pw = partnerImg.width * scale;
    const ph = partnerImg.height * scale;
    ctx.drawImage(
      partnerImg,
      logoBoxX + (logoBoxW - pw) / 2,
      logoBoxY + (logoBoxH - ph) / 2,
      pw,
      ph,
    );
    ctx.restore();
  } else {
    // Fallback when partner art is missing — keep a short name so the cell is not blank.
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${mmToDots(3.2, LABEL_DPI)}px Arial Black, Arial, Helvetica, sans-serif`;
    const fallback = wrapCanvasText(ctx, label.partnerLabel.toUpperCase(), logoBoxW, 2);
    const lineH = mmToDots(3.6, LABEL_DPI);
    let ply = y + courierH / 2 - ((fallback.length - 1) * lineH) / 2;
    for (const pl of fallback) {
      ctx.fillText(pl, contentX + courierSplit / 2, ply);
      ply += lineH;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
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

  // —— Info panel: booking time | booked by (fixed height — no empty stretch) ——
  const infoH = Math.min(infoHFixed, Math.max(mmToDots(11, LABEL_DPI), contentBottom - y));
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
