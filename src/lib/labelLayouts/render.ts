import QRCode from 'qrcode';
import type { BinLabelFields } from '../localPrinterLabel';
import { LABEL_DPI, LABEL_PAD_MM, mmToDots } from './units';
import {
  applyBindings,
  attr,
  attrBool,
  attrNum,
  buildLabelBindings,
  parseLayoutMedia,
  sanitizeLayoutXml,
} from './bindings';
import {
  fitFontSize,
  inkBounds,
  loadImage,
  roundRect,
  wrapMultiline,
} from './canvasUtils';
import {
  drawFieldIcon,
  drawFooterGlyph,
  drawShieldCheck,
  fillInvertedPill,
} from './productPackIcons';

function parseLayoutXml(xml: string): Element {
  const doc = new DOMParser().parseFromString(sanitizeLayoutXml(xml), 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid label layout XML: ${parseError.textContent?.trim() || 'parse error'}`);
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'label') {
    throw new Error('Label layout XML must have a root <label> element.');
  }
  return root;
}

async function drawQr(
  ctx: CanvasRenderingContext2D,
  payload: string,
  x: number,
  y: number,
  size: number,
): Promise<void> {
  const dataUrl = await QRCode.toDataURL(payload || ' ', {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: Math.max(64, size),
    color: { dark: '#000000', light: '#ffffff' },
  });
  const img = await loadImage(dataUrl);
  if (img) ctx.drawImage(img, x, y, size, size);
}

async function renderGenuineSpareSplit(
  ctx: CanvasRenderingContext2D,
  root: Element,
  bindings: Record<string, string>,
  box: { l: number; t: number; w: number; h: number },
): Promise<void> {
  const split = root.querySelector('split');
  if (!split) throw new Error('genuine-spare layout requires <split>.');

  const leftCol = split.querySelector('column#left') ?? split.querySelector('column');
  const rightCol = split.querySelector('column#right') ?? split.querySelectorAll('column')[1];
  if (!leftCol || !rightCol) throw new Error('genuine-spare layout needs left and right columns.');

  const inset = 5;
  const contentL = box.l + inset;
  const contentR = box.l + box.w - inset;
  const contentB = box.t + box.h - inset;
  const contentW = contentR - contentL;
  const splitGap = attrNum(split, 'gapPx', 6);
  const leftMinRatio = attrNum(split, 'leftMinRatio', 0.62);
  const rightMinRatio = attrNum(split, 'rightMinRatio', 0.34);

  const headerEl = leftCol.querySelector('header');
  const headerH = attrNum(headerEl ?? leftCol, 'heightPx', 39);
  const headerL = box.l + 2;
  const headerT = box.t + 2;
  const headerW = box.w - 4;

  const brand = headerEl?.querySelector('brand');
  const imageEl = brand?.querySelector('image');
  const titleEl = brand?.querySelector('text');
  const logoH = attrNum(imageEl ?? brand ?? leftCol, 'heightPx', headerH - 10);
  const cropInk = attrBool(imageEl ?? brand ?? leftCol, 'cropInk', true);
  const headerTitle = applyBindings(attr(titleEl ?? brand ?? leftCol, 'value', 'YESWEIGH GENUINE SPARE'), bindings);
  const maxHeaderFont = attrNum(titleEl ?? brand ?? leftCol, 'maxFontPx', headerH - 8);
  const minHeaderFont = attrNum(titleEl ?? brand ?? leftCol, 'minFontPx', 11);

  // Only load a logo when <image> is present (text-only layouts omit it).
  const logo = imageEl
    ? await loadImage(attr(imageEl, 'src', '/yesweigh-mark.png'))
    : null;
  const logoX = headerL + 8;
  let logoW = 0;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = cropInk ? inkBounds(logo) : { sx: 0, sy: 0, sw: logo.width, sh: logo.height };
    logoW = (crop.sw / crop.sh) * logoH;
  }

  ctx.font = `bold ${maxHeaderFont}px Arial, Helvetica, sans-serif`;
  const titleW = ctx.measureText(headerTitle).width;
  const headerTextX = logoW > 0 ? logoX + logoW + 8 : headerL + 8;
  const minLocW = Math.floor(contentW * rightMinRatio);
  const titleNeededLeft = Math.ceil(headerTextX + titleW + 6 - contentL);
  const leftW = Math.min(
    Math.max(titleNeededLeft, Math.floor(contentW * leftMinRatio)),
    contentW - minLocW - splitGap,
  );
  const leftL = contentL;
  const leftR = leftL + leftW;
  const locL = leftR + splitGap;
  const locR = contentR;
  const locW = locR - locL;
  const colW = Math.floor(locW / 3);
  const dividerX = leftR + splitGap / 2;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = attrNum(headerEl ?? leftCol, 'strokePx', 2);
  ctx.beginPath();
  ctx.moveTo(headerL, headerT + headerH);
  ctx.lineTo(headerL + headerW, headerT + headerH);
  ctx.stroke();

  const contentT = headerT + headerH + 4;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(dividerX, headerT);
  ctx.lineTo(dividerX, contentB);
  ctx.stroke();

  const logoY = headerT + (headerH - logoH) / 2;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = cropInk ? inkBounds(logo) : { sx: 0, sy: 0, sw: logo.width, sh: logo.height };
    ctx.drawImage(logo, crop.sx, crop.sy, crop.sw, crop.sh, logoX, logoY, logoW, logoH);
  } else if (imageEl) {
    // Placeholder circle only when <image> was requested but failed to load
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(logoX + logoH / 2, logoY + logoH / 2, logoH / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const headerTextMaxW = dividerX - headerTextX - 6;
  const headerFont = fitFontSize(ctx, headerTitle, headerTextMaxW, maxHeaderFont, minHeaderFont, true);
  ctx.fillStyle = '#000';
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(headerTitle, headerTextX, headerT + headerH / 2);

  const locHeadersEl = headerEl?.querySelector('loc-headers');
  const headerLabels = applyBindings(attr(locHeadersEl ?? leftCol, 'labels', 'RACK,ROW,BIN'), bindings)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const hMax = attrNum(locHeadersEl ?? leftCol, 'maxFontPx', Math.floor(headerH * 0.55));
  const hMin = attrNum(locHeadersEl ?? leftCol, 'minFontPx', 11);
  const sharedHeaderFont = attrBool(locHeadersEl ?? leftCol, 'sharedFont', true);
  const headerLabelFont = sharedHeaderFont
    ? Math.min(...headerLabels.map(label => fitFontSize(ctx, label, colW - 4, hMax, hMin, true)))
    : hMax;

  for (let i = 0; i < headerLabels.length; i += 1) {
    const cx = locL + i * colW;
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, headerT);
      ctx.lineTo(cx, headerT + headerH);
      ctx.stroke();
    }
    const font = sharedHeaderFont
      ? headerLabelFont
      : fitFontSize(ctx, headerLabels[i], colW - 4, hMax, hMin, true);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${font}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(headerLabels[i], cx + colW / 2, headerT + headerH / 2);
  }

  const fieldsEl = leftCol.querySelector('fields');
  const fieldNodes = fieldsEl ? [...fieldsEl.querySelectorAll(':scope > field')] : [];
  const leftBodyH = contentB - contentT;
  const totalWeight = fieldNodes.reduce((sum, n) => sum + attrNum(n, 'weight', 1), 0) || 1;
  const unitH = leftBodyH / totalWeight;
  const fieldsStroke = attrNum(fieldsEl ?? leftCol, 'dividerStrokePx', 1.5);

  let rowTop = contentT;
  for (let i = 0; i < fieldNodes.length; i += 1) {
    const node = fieldNodes[i];
    const weight = attrNum(node, 'weight', 1);
    const rowH = Math.floor(unitH * weight);
    const rowBottom = i === fieldNodes.length - 1 ? contentB : rowTop + rowH;
    const rowMid = (rowTop + rowBottom) / 2;
    const label = applyBindings(attr(node, 'label'), bindings);
    const value = applyBindings(attr(node, 'value'), bindings);
    const style = attr(node, 'style', 'inline-badge');

    if (i > 0) {
      ctx.lineWidth = fieldsStroke;
      ctx.beginPath();
      ctx.moveTo(leftL, rowTop);
      ctx.lineTo(leftR, rowTop);
      ctx.stroke();
    }

    ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
    const measured = ctx.measureText(label).width + 20;
    const badgeW = Math.min(Math.max(Math.ceil(measured), 48), Math.floor(leftW * 0.48));

    if (style === 'stacked') {
      const badgeH = Math.min(22, Math.floor((rowBottom - rowTop) * 0.32));
      const badgeY = rowTop + 3;
      roundRect(ctx, leftL, badgeY, badgeW, badgeH, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const labelFont = fitFontSize(ctx, label, badgeW - 8, 12, 8, true);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${labelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, leftL + badgeW / 2, badgeY + badgeH / 2);

      const valueTop = badgeY + badgeH + 2;
      const valueAreaH = rowBottom - valueTop - 2;
      const itemNameFont = attrNum(node, 'fontPx', 30);
      const lineGap = itemNameFont + 2;
      const maxLines = Math.max(1, Math.floor(valueAreaH / lineGap));
      ctx.font = `bold ${itemNameFont}px Arial, Helvetica, sans-serif`;
      const lines = attrBool(node, 'wrap', true)
        ? wrapMultiline(ctx, value, leftW - 4, maxLines)
        : [value];
      ctx.textAlign = 'left';
      const blockH = lines.length * lineGap;
      let y = valueTop + (valueAreaH - blockH) / 2 + lineGap / 2;
      for (const line of lines) {
        ctx.fillText(line, leftL, y);
        y += lineGap;
      }
    } else {
      const badgeH = Math.min(28, Math.floor((rowBottom - rowTop) * 0.55));
      const badgeY = rowMid - badgeH / 2;
      roundRect(ctx, leftL, badgeY, badgeW, badgeH, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const labelFont = fitFontSize(ctx, label, badgeW - 8, 13, 8, true);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${labelFont}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, leftL + badgeW / 2, rowMid);

      const valueMaxW = leftW - badgeW - 10;
      const valueFont = fitFontSize(
        ctx,
        value,
        valueMaxW,
        attrNum(node, 'valueMaxFontPx', 28),
        attrNum(node, 'valueMinFontPx', 12),
        true,
      );
      ctx.textAlign = 'left';
      ctx.font = `bold ${valueFont}px Arial, Helvetica, sans-serif`;
      ctx.fillText(value, leftL + badgeW + 8, rowMid);
    }

    rowTop = rowBottom;
  }

  const bodyH = contentB - contentT;
  const locValuesEl = rightCol.querySelector('loc-values');
  const qrEl = rightCol.querySelector('qr');
  const qrPad = attrNum(qrEl ?? locValuesEl ?? rightCol, 'padPx', 10);
  const qrSize = Math.max(40, locW - 2 * qrPad);
  const qrBlockH = qrSize + 2 * qrPad;
  const locH = Math.max(attrNum(locValuesEl ?? rightCol, 'minHeightPx', 32), bodyH - qrBlockH);
  const locT = contentT;
  const locB = locT + locH;
  const qrAreaT = locB;
  const qrAreaH = contentB - qrAreaT;
  const padX = Math.floor((locW - qrSize) / 2);
  const padY = Math.floor((qrAreaH - qrSize) / 2);

  const values = applyBindings(attr(locValuesEl ?? rightCol, 'values', '{{rack}},{{row}},{{bin}}'), bindings)
    .split(',')
    .map(s => s.trim());

  ctx.lineWidth = attrNum(locValuesEl ?? rightCol, 'dividerStrokePx', 1.5);
  ctx.strokeStyle = '#000';
  for (let i = 1; i < 3; i += 1) {
    const cx = locL + i * colW;
    ctx.beginPath();
    ctx.moveTo(cx, locT);
    ctx.lineTo(cx, locB);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(locL, locB);
  ctx.lineTo(locR, locB);
  ctx.stroke();

  const valueMaxW = colW - 6;
  const valueMaxH = Math.floor(locH * 0.7);
  const valueMinFont = attrNum(locValuesEl ?? rightCol, 'valueMinFontPx', 14);
  const sharedValueFont = attrBool(locValuesEl ?? rightCol, 'sharedFont', true)
    ? Math.min(...values.map(v => fitFontSize(ctx, v, valueMaxW, valueMaxH, valueMinFont, true)))
    : valueMaxH;

  for (let i = 0; i < values.length; i += 1) {
    const cx = locL + i * colW;
    const font = attrBool(locValuesEl ?? rightCol, 'sharedFont', true)
      ? sharedValueFont
      : fitFontSize(ctx, values[i], valueMaxW, valueMaxH, valueMinFont, true);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${font}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(values[i], cx + colW / 2, locT + locH / 2);
  }

  const qrField = attr(qrEl ?? rightCol, 'field', 'qrPayload');
  const qrFallback = attr(qrEl ?? rightCol, 'fallbackField', 'sku');
  const qrPayload = bindings[qrField] || bindings[qrFallback] || '';
  await drawQr(ctx, qrPayload, locL + padX, qrAreaT + padY, qrSize);
}

async function renderSimpleStack(
  ctx: CanvasRenderingContext2D,
  root: Element,
  bindings: Record<string, string>,
  box: { l: number; t: number; w: number; h: number },
): Promise<void> {
  const stack = root.querySelector('stack') ?? root;
  const gap = attrNum(stack, 'gapPx', 6);
  const pad = attrNum(stack, 'padPx', 8);
  let y = box.t + pad;
  const x = box.l + pad;
  const maxW = box.w - pad * 2;
  const bottom = box.t + box.h - pad;

  for (const child of [...stack.children]) {
    if (y >= bottom) break;
    const tag = child.tagName.toLowerCase();
    if (tag === 'text') {
      const value = applyBindings(attr(child, 'value'), bindings);
      const bold = attrBool(child, 'bold', true);
      const maxFont = attrNum(child, 'maxFontPx', 18);
      const minFont = attrNum(child, 'minFontPx', 10);
      const font = attrBool(child, 'fit', true)
        ? fitFontSize(ctx, value, maxW, maxFont, minFont, bold)
        : maxFont;
      ctx.fillStyle = '#000';
      ctx.font = `${bold ? 'bold ' : ''}${font}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(value, x, y);
      y += font + gap;
    } else if (tag === 'qr') {
      const size = Math.min(attrNum(child, 'sizePx', 120), maxW, bottom - y);
      const qrField = attr(child, 'field', 'qrPayload');
      const qrFallback = attr(child, 'fallbackField', 'sku');
      const payload = bindings[qrField] || bindings[qrFallback] || '';
      const qx = attr(child, 'align', 'center') === 'center'
        ? x + Math.floor((maxW - size) / 2)
        : x;
      await drawQr(ctx, payload, qx, y, size);
      y += size + gap;
    }
  }
}

/**
 * Genuine Spare Product reference layout:
 * slanted black banner | fields + QR | packing meta | brand footer
 */
async function renderProductPack(
  ctx: CanvasRenderingContext2D,
  root: Element,
  bindings: Record<string, string>,
  box: { l: number; t: number; w: number; h: number },
): Promise<void> {
  const pack = root.querySelector('product-pack');
  if (!pack) throw new Error('product pack layout requires <product-pack>.');

  const headerEl = pack.querySelector('header');
  const bodyEl = pack.querySelector('body');
  const metaEl = pack.querySelector('meta');
  const brandEl = pack.querySelector('brand');

  const requestedHeaderH = attrNum(pack, 'headerHeightPx', headerEl ? 42 : 0);
  const hasHeader = Boolean(headerEl) && requestedHeaderH > 0;
  const headerH = hasHeader ? requestedHeaderH : 0;
  const metaH = attrNum(pack, 'metaHeightPx', 52);
  const brandH = attrNum(pack, 'brandHeightPx', 36);
  const bodyGap = attrNum(pack, 'bodyGapPx', 4);
  const qrRatio = attrNum(pack, 'qrRatio', 0.34);
  const bannerRatio = attrNum(pack, 'bannerRatio', 0.68);

  const inset = 4;
  const L = box.l + inset;
  const T = box.t + inset;
  const R = box.l + box.w - inset;
  const B = box.t + box.h - inset;
  const W = R - L;

  // --- Optional slanted black header banner (spare pack only) ---
  const headerT = T;
  const headerB = headerT + headerH;
  if (hasHeader) {
    const slant = attrNum(headerEl, 'slantPx', 22);
    const bannerW = Math.floor(W * bannerRatio);
    const bannerTitle = applyBindings(attr(headerEl, 'title', 'GENUINE SPARE PART'), bindings);

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(L, headerT);
    ctx.lineTo(L + bannerW, headerT);
    ctx.lineTo(L + bannerW - slant, headerB);
    ctx.lineTo(L, headerB);
    ctx.closePath();
    ctx.fill();

    const shieldSize = Math.min(32, Math.floor(headerH * 0.72));
    const shieldX = L + 8;
    const shieldY = headerT + (headerH - shieldSize) / 2;
    drawShieldCheck(ctx, shieldX, shieldY, shieldSize, true);

    const headerTextX = shieldX + shieldSize * 0.85 + 6;
    const headerTextMaxW = L + bannerW - slant - 10 - headerTextX;
    const htFont = fitFontSize(
      ctx,
      bannerTitle,
      headerTextMaxW,
      attrNum(headerEl, 'titleMaxFontPx', 22),
      attrNum(headerEl, 'titleMinFontPx', 14),
      true,
    );
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${htFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(bannerTitle, headerTextX, headerT + headerH / 2);
    ctx.fillStyle = '#000';
  }

  // --- Vertical zones ---
  const brandT = B - brandH;
  const metaT = brandT - metaH;
  const bodyT = headerB + (hasHeader ? bodyGap : 0);
  const bodyB = metaT - bodyGap;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(L, brandT);
  ctx.lineTo(R, brandT);
  ctx.stroke();

  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(L, metaT);
  ctx.lineTo(R, metaT);
  ctx.stroke();

  // --- Body: fields | QR ---
  const qrBoxW = Math.floor(W * qrRatio);
  const fieldsR = R - qrBoxW - bodyGap;
  const fieldsL = L;
  const fieldsW = fieldsR - fieldsL;

  const fieldsEl = bodyEl?.querySelector('fields');
  const fieldNodes = fieldsEl ? [...fieldsEl.querySelectorAll('field')] : [];
  const rowCount = Math.max(1, fieldNodes.length);
  const bodyH = bodyB - bodyT;
  const rowH = Math.floor(bodyH / rowCount);
  const labelMax = attrNum(fieldsEl, 'labelMaxFontPx', 17);
  const valueMax = attrNum(fieldsEl, 'valueMaxFontPx', 22);
  const iconSize = Math.min(26, Math.max(18, Math.floor(rowH * 0.58)));

  ctx.font = `bold ${labelMax}px Arial, Helvetica, sans-serif`;
  let labelColW = 0;
  const rows = fieldNodes.map(el => ({
    label: applyBindings(attr(el, 'label'), bindings),
    sublabel: applyBindings(attr(el, 'sublabel'), bindings),
    value: applyBindings(attr(el, 'value'), bindings),
    icon: attr(el, 'icon', 'grid'),
  }));
  for (const row of rows) {
    labelColW = Math.max(labelColW, ctx.measureText(row.label).width);
    if (row.sublabel) {
      ctx.font = `bold ${Math.max(7, Math.round(labelMax * 0.55))}px Arial, Helvetica, sans-serif`;
      labelColW = Math.max(labelColW, ctx.measureText(row.sublabel).width);
      ctx.font = `bold ${labelMax}px Arial, Helvetica, sans-serif`;
    }
  }
  labelColW = Math.min(labelColW + 2, Math.floor(fieldsW * 0.5));
  const textStart = fieldsL + 2 + iconSize + 5;
  const colonX = textStart + labelColW + 3;
  const valueX = colonX + 7;
  const valueW = fieldsR - valueX - 2;

  rows.forEach((row, i) => {
    const y0 = bodyT + i * rowH;
    const y1 = y0 + rowH;
    if (i > 0) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fieldsL, y0);
      ctx.lineTo(fieldsR - 2, y0);
      ctx.stroke();
    }
    const cy = (y0 + y1) / 2;
    drawFieldIcon(ctx, row.icon, fieldsL + 2, cy - iconSize / 2, iconSize);

    const lf = fitFontSize(ctx, row.label, labelColW, labelMax, 12, true);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${lf}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (row.sublabel) {
      const subSize = Math.max(8, Math.round(lf * 0.55));
      const blockH = lf + subSize + 2;
      const top = cy - blockH / 2;
      ctx.textBaseline = 'top';
      ctx.fillText(row.label, textStart, top);
      ctx.font = `bold ${subSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText(row.sublabel, textStart, top + lf + 1);
      ctx.font = `bold ${lf}px Arial, Helvetica, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(':', colonX, cy);
    } else {
      ctx.fillText(row.label, textStart, cy);
      ctx.fillText(':', colonX, cy);
    }

    const vf = fitFontSize(ctx, row.value || ' ', valueW, valueMax, 14, true);
    ctx.font = `bold ${vf}px Arial, Helvetica, sans-serif`;
    ctx.fillText(row.value, valueX, cy);
  });

  const qrPanel = bodyEl?.querySelector('qr-panel');
  const qrPad = attrNum(qrPanel, 'padPx', 12);
  const qrBoxL = fieldsR + bodyGap;
  const qrBoxT = bodyT;
  const qrBoxH = bodyB - bodyT;
  ctx.lineWidth = 1.5;
  roundRect(ctx, qrBoxL, qrBoxT, qrBoxW, qrBoxH, 5);
  ctx.stroke();

  const qrAvail = Math.min(qrBoxW - qrPad * 2, qrBoxH - qrPad * 2);
  const qrSize = Math.max(36, Math.floor(qrAvail));
  const qrX = qrBoxL + Math.floor((qrBoxW - qrSize) / 2);
  const qrY = qrBoxT + Math.floor((qrBoxH - qrSize) / 2);
  const qrEl = qrPanel?.querySelector('qr');
  const qrPayload =
    bindings[attr(qrEl, 'field', 'qrPayload')] || bindings[attr(qrEl, 'fallbackField', 'sku')] || '';
  await drawQr(ctx, qrPayload, qrX, qrY, qrSize);

  // --- Meta columns sized by title width; titles use full label font (no shrink) ---
  const cells = metaEl ? [...metaEl.querySelectorAll('cell')] : [];
  const flabel = attrNum(metaEl, 'labelFontPx', 18);
  const fvalue = attrNum(metaEl, 'valueFontPx', 18);
  const glyphSize = 16;
  const leftPad = 6;
  const rightGap = 6;
  const labelRowH = Math.max(flabel, glyphSize);
  const labelTop = metaT + 5;
  const labelMid = labelTop + labelRowH / 2;

  const metaCells = cells.map(cell => {
    const label = applyBindings(attr(cell, 'label'), bindings);
    const value = applyBindings(attr(cell, 'value'), bindings).trim();
    const icon = attr(cell, 'icon', '');
    ctx.font = `bold ${flabel}px Arial, Helvetica, sans-serif`;
    const labelW = ctx.measureText(label).width;
    const iconW = icon ? glyphSize + 3 : 0;
    let needW = leftPad + iconW + labelW + rightGap;
    if (value) {
      ctx.font = `bold ${fvalue}px Arial, Helvetica, sans-serif`;
      const pillNeed = leftPad + Math.ceil(ctx.measureText(value).width + 20) + rightGap;
      needW = Math.max(needW, pillNeed);
    }
    return { label, value, icon, needW };
  });

  const totalNeed = metaCells.reduce((sum, cell) => sum + cell.needW, 0) || 1;
  const rawWidths = metaCells.map(cell =>
    totalNeed <= W
      ? cell.needW + ((W - totalNeed) * cell.needW) / totalNeed
      : Math.max(36, (cell.needW / totalNeed) * W),
  );
  const widths = rawWidths.map(w => Math.floor(w));
  let widthSum = widths.reduce((sum, w) => sum + w, 0);
  if (widths.length) widths[widths.length - 1] += W - widthSum;

  let colX = L;
  metaCells.forEach((cell, i) => {
    const cellW = widths[i] ?? Math.floor(W / Math.max(1, metaCells.length));
    const cx = colX;
    if (i > 0) {
      ctx.lineWidth = attrNum(metaEl, 'dividerStrokePx', 1);
      ctx.beginPath();
      ctx.moveTo(cx, metaT + 5);
      ctx.lineTo(cx, brandT - 5);
      ctx.stroke();
    }

    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let labelX = cx + leftPad;
    if (cell.icon) {
      drawFooterGlyph(ctx, cell.icon, cx + leftPad, labelMid - glyphSize / 2, glyphSize);
      labelX = cx + leftPad + glyphSize + 3;
    }
    ctx.font = `bold ${flabel}px Arial, Helvetica, sans-serif`;
    ctx.fillText(cell.label, labelX, labelMid);

    if (cell.value) {
      const pillH = Math.min(
        Math.max(26, Math.round(fvalue * 1.3)),
        Math.max(22, brandT - (labelTop + labelRowH) - 8),
      );
      const pillY = Math.min(labelTop + labelRowH + 4, brandT - pillH - 4);
      const textPadX = 10;
      ctx.font = `bold ${fvalue}px Arial, Helvetica, sans-serif`;
      const textW = ctx.measureText(cell.value).width;
      const maxPillW = cellW - leftPad - rightGap;
      const pillW = Math.min(maxPillW, Math.max(Math.ceil(textW + textPadX * 2), 52));
      fillInvertedPill(ctx, cx + leftPad, pillY, pillW, pillH, cell.value, fvalue, {
        bold: true,
        fullPill: false,
        radiusPx: 4,
        padX: textPadX,
      });
    }

    colX += cellW;
  });

  // --- Brand footer ---
  const brandName = applyBindings(attr(brandEl, 'name', 'YESWEIGH'), bindings);
  const brandCenter = applyBindings(attr(brandEl, 'center', ''), bindings).trim();
  const brandOrigin = applyBindings(attr(brandEl, 'origin', 'MADE IN CHINA'), bindings);
  const logoSrc = attr(brandEl, 'logoSrc', '/yesweigh-mark.png');
  const logoH = attrNum(brandEl, 'logoHeightPx', 22);
  const showDividers = attrBool(brandEl, 'dividers', true);
  const logo = await loadImage(logoSrc);

  const col1R = L + Math.floor(W * (brandCenter && !showDividers ? 0.32 : 0.38));
  const col2R = L + Math.floor(W * (brandCenter && !showDividers ? 0.78 : 0.7));
  const midY = brandT + brandH / 2;

  if (showDividers) {
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(col1R, brandT + 5);
    ctx.lineTo(col1R, B - 5);
    ctx.moveTo(col2R, brandT + 5);
    ctx.lineTo(col2R, B - 5);
    ctx.stroke();
  }

  let brandLogoW = 0;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = inkBounds(logo);
    brandLogoW = (crop.sw / crop.sh) * logoH;
    ctx.drawImage(
      logo,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      L + 4,
      midY - logoH / 2,
      brandLogoW,
      logoH,
    );
  }

  const nameX = L + 4 + (brandLogoW > 0 ? brandLogoW + 5 : 0);
  const nameMaxW = (showDividers || brandCenter ? col1R : R - Math.floor(W * 0.32)) - 6 - nameX;
  const nameFont = fitFontSize(
    ctx,
    `${brandName}®`,
    Math.max(24, nameMaxW),
    attrNum(brandEl, 'nameMaxFontPx', 20),
    12,
    true,
  );
  ctx.fillStyle = '#000';
  ctx.font = `bold ${nameFont}px Arial Black, Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandName, nameX, midY);
  const nw = ctx.measureText(brandName).width;
  const reg = Math.max(8, Math.round(nameFont * 0.36));
  ctx.font = `bold ${reg}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('®', nameX + nw + 1, midY - nameFont * 0.12);

  if (brandCenter) {
    const centerMaxW = col2R - col1R - 10;
    const centerFont = fitFontSize(
      ctx,
      brandCenter,
      centerMaxW,
      attrNum(brandEl, 'centerMaxFontPx', 14),
      9,
      true,
    );
    ctx.font = `bold ${centerFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brandCenter, (col1R + col2R) / 2, midY);
  }

  const originMaxW = showDividers || brandCenter ? R - col2R - 8 : Math.floor(W * 0.32) - 8;
  const originFont = fitFontSize(
    ctx,
    brandOrigin,
    originMaxW,
    attrNum(brandEl, 'originMaxFontPx', 12),
    8,
    true,
  );
  ctx.font = `bold ${originFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandOrigin, R - 4, midY);
}

/**
 * Render a label from layout XML + field bindings onto a canvas at printer DPI.
 * Media size prefers explicit args, else widthMm/heightMm on the XML root.
 */
export async function renderLabelLayoutCanvas(
  xml: string,
  fields: BinLabelFields,
  media?: { labelWidthMm?: number; labelHeightMm?: number },
): Promise<HTMLCanvasElement> {
  const root = parseLayoutXml(xml);
  const fromXml = parseLayoutMedia(xml);
  const labelWidthMm = media?.labelWidthMm ?? fromXml.labelWidthMm;
  const labelHeightMm = media?.labelHeightMm ?? fromXml.labelHeightMm;
  const dpi = attrNum(root, 'dpi', LABEL_DPI);
  const padMm = attrNum(root, 'padMm', LABEL_PAD_MM);
  const width = mmToDots(labelWidthMm, dpi);
  const height = mmToDots(labelHeightMm, dpi);
  const pad = mmToDots(padMm, dpi);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create label canvas.');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  const box = { l: pad, t: pad, w: width - pad * 2, h: height - pad * 2 };
  const border = root.querySelector('border');
  if (border) {
    ctx.lineWidth = attrNum(border, 'strokePx', 2);
    roundRect(ctx, box.l, box.t, box.w, box.h, attrNum(border, 'radiusPx', 10));
    ctx.stroke();
  }

  const bindings = buildLabelBindings(fields);
  const layoutId = attr(root, 'id', '');

  if (root.querySelector('product-pack') || layoutId === 'genuine-spare-product' || layoutId === 'catalog-product') {
    await renderProductPack(ctx, root, bindings, box);
  } else if (root.querySelector('split') || layoutId === 'genuine-spare') {
    await renderGenuineSpareSplit(ctx, root, bindings, box);
  } else if (root.querySelector('stack') || layoutId === 'simple-bin') {
    await renderSimpleStack(ctx, root, bindings, box);
  } else {
    throw new Error(
      `Unsupported label layout "${layoutId || 'unknown'}". Use genuine-spare, genuine-spare-product, catalog-product, or simple-bin.`,
    );
  }

  return canvas;
}
