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
} from './bindings';
import {
  fitFontSize,
  inkBounds,
  loadImage,
  roundRect,
  wrapMultiline,
} from './canvasUtils';

function parseLayoutXml(xml: string): Element {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
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
  const logoSrc = attr(imageEl ?? brand ?? leftCol, 'src', '/yesweigh-mark.png');
  const logoH = attrNum(imageEl ?? brand ?? leftCol, 'heightPx', headerH - 10);
  const cropInk = attrBool(imageEl ?? brand ?? leftCol, 'cropInk', true);
  const headerTitle = applyBindings(attr(titleEl ?? brand ?? leftCol, 'value', 'YESWEIGH GENUINE SPARE'), bindings);
  const maxHeaderFont = attrNum(titleEl ?? brand ?? leftCol, 'maxFontPx', headerH - 8);
  const minHeaderFont = attrNum(titleEl ?? brand ?? leftCol, 'minFontPx', 11);

  const logo = await loadImage(logoSrc);
  const logoX = headerL + 8;
  let logoW = logoH;
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = cropInk ? inkBounds(logo) : { sx: 0, sy: 0, sw: logo.width, sh: logo.height };
    logoW = (crop.sw / crop.sh) * logoH;
  }

  ctx.font = `bold ${maxHeaderFont}px Arial, Helvetica, sans-serif`;
  const titleW = ctx.measureText(headerTitle).width;
  const headerTextX = logoX + logoW + 8;
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
  } else {
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

  if (root.querySelector('split') || layoutId === 'genuine-spare') {
    await renderGenuineSpareSplit(ctx, root, bindings, box);
  } else if (root.querySelector('stack') || layoutId === 'simple-bin') {
    await renderSimpleStack(ctx, root, bindings, box);
  } else if (root.querySelector('stack')) {
    await renderSimpleStack(ctx, root, bindings, box);
  } else {
    throw new Error(
      `Unsupported label layout "${layoutId || 'unknown'}". Use genuine-spare or simple-bin structure.`,
    );
  }

  return canvas;
}
