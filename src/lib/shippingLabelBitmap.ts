import QRCode from 'qrcode';
import {
  LOGISTICS_LABEL_GAP_MM,
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import {
  applyThermalMonochrome,
  buildCanvasTsplBitmapJob,
} from './localPrinterLabelBitmap';
import { LABEL_DPI, mmToDots } from './labelLayouts/units';
import { getLabelMediaForUsage } from './labelStudio';
import { resolveLogisticsPhotoUrl } from './logisticsPhotos';
import {
  buildShippingLabelTrackingUrl,
  formatShippingAddressLines,
  publicInsidePhotoUrl,
  shippingLabelBarcodeBars,
  shippingLabelMetricRows,
  type ShippingLabelViewModel,
} from './shippingLabel';
import {
  drawRoundedRectStroke,
  drawShippingLabelHeader,
  roundedRectPath,
} from './shippingLabelHeader';
import {
  drawShippingIcon,
  type ShippingCanvasIcon,
} from './shippingLabelIconsCanvas';

const INK = '#000000';
const PAPER = '#ffffff';
/**
 * Verdana regular — open counters, designed for low-res clarity.
 * Bold fills letter holes after 203 DPI thermal thresholding.
 */
const FONT = 'Verdana, Tahoma, Geneva, sans-serif';

function fontPx(size: number): number {
  return Math.max(8, Math.round(size));
}

/** Regular weight — sharpest for body text on 203 DPI BITMAP. */
function thermalFont(size: number): string {
  return `${fontPx(size)}px ${FONT}`;
}

/** Bold for titles / section labels only. */
function thermalFontBold(size: number): string {
  return `bold ${fontPx(size)}px ${FONT}`;
}

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
  size: number,
  bold = false,
): { w: number; h: number } {
  const px = fontPx(size);
  ctx.font = bold ? thermalFontBold(px) : thermalFont(px);
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillText(text, Math.round(x), Math.round(y));
  return { w: ctx.measureText(text).width, h: px * 1.2 };
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
  // Crisp BITMAP text/logos — smoothing softens edges before 1-bit threshold.
  ctx.imageSmoothingEnabled = false;

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

  // Party-column QRs — sized at draw time to fill leftover height after the address.
  const qrGap = mmToDots(1.4, LABEL_DPI);
  const qrMin = mmToDots(12, LABEL_DPI);
  const qrMax = mmToDots(36, LABEL_DPI);

  const makeQrImage = async (payload: string | null): Promise<HTMLImageElement | null> => {
    const text = payload?.trim();
    if (!text) return null;
    try {
      const dataUrl = await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
        color: { dark: '#111111', light: '#ffffff' },
      });
      return await loadImage(dataUrl);
    } catch {
      return null;
    }
  };

  // FROM: short /lp/{bookingId}/{box} link (dense Storage token URLs scan poorly on thermal).
  let packageContentsQrUrl = label.packageContentsUrl?.trim() || null;
  if (!packageContentsQrUrl) {
    packageContentsQrUrl = publicInsidePhotoUrl(label.insidePhotoUrl);
    if (!packageContentsQrUrl && label.insidePhotoStoragePath) {
      packageContentsQrUrl = await resolveLogisticsPhotoUrl(label.insidePhotoStoragePath);
    }
  }
  const insideQr = await makeQrImage(packageContentsQrUrl);

  // TO: ST Courier tracking URL (dynamic AWB in keyword=).
  const trackingQr = await makeQrImage(buildShippingLabelTrackingUrl(label));

  const partyInner = mmToDots(1.8, LABEL_DPI);
  const partyMaxW = colW - partyInner * 2;
  const partyTopPad = mmToDots(1.8, LABEL_DPI);
  const partyBottomPad = mmToDots(1.8, LABEL_DPI);
  const bodyFont = fontPx(mmToDots(3.0, LABEL_DPI));
  const partyLineH = Math.round(bodyFont * 1.28);
  const partyLabelGap = mmToDots(1.2, LABEL_DPI);
  const partyNameGap = mmToDots(1.0, LABEL_DPI);
  const partyPhoneGap = mmToDots(1.0, LABEL_DPI);
  const qrCaptionGap = mmToDots(0.6, LABEL_DPI);

  /** Max square QR that fits under a party column after its address text. */
  const measurePartyQrSize = (
    name: string,
    address: string,
    phone: string,
    hasQr: boolean,
    hasCaption: boolean,
  ): number => {
    if (!hasQr) return qrMax;
    const captionH = hasCaption ? bodyFont : 0;
    const captionGap = captionH ? qrCaptionGap : 0;
    const bottomReserve = qrMin + qrGap + captionH + captionGap;
    const usableH = Math.max(1, partyH - partyTopPad - partyBottomPad - bottomReserve);
    const phoneText = phone.trim();

    ctx.font = thermalFont(bodyFont);
    const nameLines = wrapCanvasText(ctx, name, partyMaxW, 3);
    const fixed = partyLineH
      + partyLabelGap
      + nameLines.length * partyLineH
      + partyNameGap
      + (phoneText ? partyPhoneGap + partyLineH : 0);
    const maxAddrLines = Math.max(2, Math.floor((usableH - fixed) / partyLineH));

    const raw = formatShippingAddressLines(address, 8).split('\n').filter(Boolean);
    const addrLines: string[] = [];
    for (const rawLine of raw) {
      if (addrLines.length >= maxAddrLines) break;
      for (const wl of wrapCanvasText(ctx, rawLine, partyMaxW, maxAddrLines - addrLines.length)) {
        if (addrLines.length >= maxAddrLines) break;
        addrLines.push(wl);
      }
    }
    const addrCount = addrLines.length || 1;

    let used = partyTopPad
      + partyLineH
      + partyLabelGap
      + nameLines.length * partyLineH
      + partyNameGap
      + addrCount * partyLineH;
    if (phoneText) used += partyPhoneGap + partyLineH;
    used += qrGap + captionH + captionGap;

    const availH = Math.max(qrMin, partyH - partyBottomPad - used);
    return Math.max(qrMin, Math.min(partyMaxW, availH, qrMax));
  };

  // Same size for both QRs — limited by the tighter column.
  const fromQrAvail = measurePartyQrSize(
    label.fromName,
    label.fromAddress,
    '',
    Boolean(insideQr),
    Boolean(insideQr),
  );
  const toQrAvail = measurePartyQrSize(
    label.toName,
    label.toAddress,
    label.toPhone,
    Boolean(trackingQr),
    Boolean(trackingQr),
  );
  const sharedQrSize = (() => {
    const sizes: number[] = [];
    if (insideQr) sizes.push(fromQrAvail);
    if (trackingQr) sizes.push(toQrAvail);
    if (!sizes.length) return qrMin;
    return Math.max(qrMin, Math.min(...sizes));
  })();

  const drawParty = (
    x: number,
    labelText: string,
    name: string,
    address: string,
    phone = '',
    qrImage: HTMLImageElement | null = null,
    qrCaption = '',
    qrSize = sharedQrSize,
  ) => {
    const qrCaptionH = qrImage && qrCaption ? bodyFont : 0;
    const captionGap = qrCaptionH ? qrCaptionGap : 0;
    const bottomReserve = qrImage
      ? qrSize + qrGap + qrCaptionH + captionGap
      : 0;
    const usableH = Math.max(1, partyH - partyTopPad - partyBottomPad - bottomReserve);
    const phoneText = phone.trim();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, colW - 2, partyH - 2);
    ctx.clip();

    const buildAddrLines = (maxLines: number): string[] => {
      ctx.font = thermalFont(bodyFont);
      const raw = formatShippingAddressLines(address, 8).split('\n').filter(Boolean);
      const out: string[] = [];
      for (const rawLine of raw) {
        if (out.length >= maxLines) break;
        for (const wl of wrapCanvasText(ctx, rawLine, partyMaxW, maxLines - out.length)) {
          if (out.length >= maxLines) break;
          out.push(wl);
        }
      }
      return out.length ? out : ['—'];
    };

    ctx.font = thermalFont(bodyFont);
    const nameLines = wrapCanvasText(ctx, name, partyMaxW, 3);
    const fixed = partyLineH
      + partyLabelGap
      + nameLines.length * partyLineH
      + partyNameGap
      + (phoneText ? partyPhoneGap + partyLineH : 0);
    const maxAddrLines = Math.max(2, Math.floor((usableH - fixed) / partyLineH));
    const addrLines = buildAddrLines(maxAddrLines);

    const emitBodyLine = (text: string, lineY: number) => {
      const tx = Math.round(x + partyInner);
      const ty = Math.round(lineY);
      ctx.fillStyle = INK;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = thermalFont(bodyFont);
      ctx.fillText(text, tx, ty);
    };

    let py = y + partyTopPad;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    drawLabel(ctx, labelText, x + partyInner, py, bodyFont, true);
    py += partyLineH + partyLabelGap;

    for (const nl of nameLines) {
      emitBodyLine(nl, py);
      py += partyLineH;
    }
    py += partyNameGap;

    for (const al of addrLines) {
      emitBodyLine(al, py);
      py += partyLineH;
    }

    if (phoneText) {
      py += partyPhoneGap;
      const phoneLine = wrapCanvasText(ctx, `Ph: ${phoneText}`, partyMaxW, 1)[0] ?? `Ph: ${phoneText}`;
      emitBodyLine(phoneLine, py);
      py += partyLineH;
    }

    // Pin caption (above QR) + QR to the bottom; center both horizontally.
    if (qrImage) {
      const captionBlock = qrCaptionH ? qrCaptionH + captionGap : 0;
      let qy = Math.round(y + partyH - partyBottomPad - qrSize);
      const minTop = Math.round(py + qrGap + captionBlock);
      if (qy < minTop) qy = minTop;
      const qx = Math.round(x + (colW - qrSize) / 2);
      if (qrCaptionH && qrCaption) {
        ctx.font = thermalFont(bodyFont);
        const captionW = ctx.measureText(qrCaption).width;
        const captionX = Math.round(x + (colW - captionW) / 2);
        drawLabel(ctx, qrCaption, captionX, qy - captionGap - qrCaptionH, bodyFont);
      }
      ctx.drawImage(qrImage, qx, qy, qrSize, qrSize);
    }
    ctx.restore();
  };
  drawParty(
    contentX,
    'FROM (SHIPPER)',
    label.fromName,
    label.fromAddress,
    '',
    insideQr,
    'VIEW PACKAGE CONTENTS',
  );
  drawParty(
    contentX + colW,
    'TO (CONSIGNEE)',
    label.toName,
    label.toAddress,
    label.toPhone,
    trackingQr,
    'TRACKING',
    sharedQrSize,
  );
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
      ctx.font = thermalFont(mmToDots(2.1, LABEL_DPI));
      const titleX = cx + inset + iconSize + mmToDots(0.6, LABEL_DPI);
      const titleMaxW = Math.max(8, cx + cellW - inset - titleX);
      const titleText = wrapCanvasText(ctx, title, titleMaxW, 1)[0] ?? title;
      ctx.fillText(titleText, titleX, cy + inset + mmToDots(0.35, LABEL_DPI));

      const valueY = cy + inset + iconSize + mmToDots(1.4, LABEL_DPI);
      ctx.font = thermalFont(mmToDots(3.0, LABEL_DPI));
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
  // Divider / logo first; stroke last so rounded corners stay unbroken.
  const panelInset = Math.max(line, Math.ceil(line / 2) + 1);
  ctx.fillStyle = INK;
  ctx.fillRect(
    contentX + courierSplit,
    y + panelInset,
    line,
    Math.max(0, courierH - panelInset * 2),
  );

  // Courier cell: logo only — fill the cell (cover) with a tight inset.
  const partnerImg = label.partnerImage ? await loadImage(label.partnerImage) : null;
  const logoInset = 2;
  const logoBoxX = contentX + logoInset;
  const logoBoxY = y + logoInset;
  const logoBoxW = courierSplit - logoInset * 2;
  const logoBoxH = courierH - logoInset * 2;
  if (partnerImg && partnerImg.width > 0 && partnerImg.height > 0) {
    ctx.save();
    roundedRectPath(
      ctx,
      contentX + panelInset,
      y + panelInset,
      courierSplit - panelInset * 2,
      courierH - panelInset * 2,
      Math.max(0, panelR - panelInset),
    );
    ctx.clip();
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
    ctx.font = thermalFont(mmToDots(3.2, LABEL_DPI));
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
  drawRoundedRectStroke(ctx, contentX, y, contentW, courierH, panelR, line);

  const trackX = contentX + courierSplit;
  const trackW = contentW - courierSplit;
  const trackPad = mmToDots(1.2, LABEL_DPI);
  const awbLabel = 'AWB / TRACKING';
  const awbLabelSize = mmToDots(2.2, LABEL_DPI);
  ctx.font = thermalFont(awbLabelSize);
  const awbLabelW = ctx.measureText(awbLabel).width;
  drawLabel(
    ctx,
    awbLabel,
    trackX + (trackW - awbLabelW) / 2,
    y + trackPad,
    awbLabelSize,
  );

  // Human-readable AWB under the bars (smaller); barcode fills most of the cell.
  const awbFont = fontPx(mmToDots(3.2, LABEL_DPI));
  const awbTextH = Math.round(awbFont * 1.15);
  const textGap = mmToDots(0.8, LABEL_DPI);
  const bottomPad = mmToDots(1.2, LABEL_DPI);
  const topAfterLabel = y + trackPad + awbLabelSize * 1.2 + mmToDots(1.0, LABEL_DPI);
  const barH = Math.max(
    mmToDots(10, LABEL_DPI),
    courierH - (topAfterLabel - y) - textGap - awbTextH - bottomPad,
  );
  const barY = topAfterLabel;
  const awbY = barY + barH + textGap;

  const bars = shippingLabelBarcodeBars(label.consignmentNo);
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

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = thermalFont(awbFont);
  const awbText = wrapCanvasText(ctx, label.consignmentNo, trackW - mmToDots(3, LABEL_DPI), 1)[0] ?? label.consignmentNo;
  ctx.fillText(awbText, trackX + trackW / 2, awbY);
  ctx.textAlign = 'left';
  y += courierH + gap;

  // —— Info panel: booking date | booked by (fixed height — no empty stretch) ——
  const infoH = Math.min(infoHFixed, Math.max(mmToDots(11, LABEL_DPI), contentBottom - y));
  drawRoundedRectStroke(ctx, contentX, y, contentW, infoH, panelR, line);
  ctx.fillRect(
    contentX + colW,
    y + panelInset,
    line,
    Math.max(0, infoH - panelInset * 2),
  );

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
    ctx.font = thermalFont(mmToDots(3.0, LABEL_DPI));
    const lines = wrapCanvasText(ctx, value, colW - inset * 2, 2);
    let vy = y + inset + labelH + mmToDots(1, LABEL_DPI);
    for (const vl of lines) {
      ctx.fillText(vl, x + inset, vy);
      vy += mmToDots(3.2, LABEL_DPI);
    }
    ctx.restore();
  };

  drawInfo(contentX, 'BOOKING DATE', label.bookingTime, 'time');
  drawInfo(contentX + colW, 'BOOKED BY', label.bookedBy, 'bookedBy');

  // Match thermal BITMAP: colored logos/art become pure black & white.
  applyThermalMonochrome(canvas);
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
