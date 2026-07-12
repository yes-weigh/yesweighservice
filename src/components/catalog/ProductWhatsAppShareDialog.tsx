import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Share2, X } from 'lucide-react';
import { WhatsAppShare } from 'whatsapp-share';
import type { CatalogProduct } from '../../types/catalog';
import shareTagIconUrl from '../../assets/share-tag-icon.png';
import { openWhatsAppWithText, uploadWhatsAppShareCard } from '../../lib/whatsappShareCard';
import { loadMrpRules } from '../../lib/catalogProductSettings';
import { calculateProductMrpBreakdown, resolveMrpGroupRule } from '../../lib/catalogMrp';

const GREEN = '#036e35';
const RED = '#d8151d';
const BLUE = '#053cbd';
const ROW_LINE = '#e5e7eb';
const ICON_GREEN = '#2e9a4a';
const ICON_BLUE = '#1a6fd0';
const ICON_PURPLE = '#8e2bb8';

/** Reference card is 411×616 — scale all geometry from that. */
const REF_W = 411;
const REF_H = 616;

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
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

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function money(n: number): string {
  return `₹ ${n.toFixed(2)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not encode image.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not encode image.'));
    reader.readAsDataURL(blob);
  });
}

function drawSlantBanner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  slant = 28,
  opts?: { roundBottomLeft?: boolean; cornerR?: number },
) {
  const roundBL = opts?.roundBottomLeft !== false;
  const r = opts?.cornerR ?? Math.min(Math.max(4, Math.round(h * 0.18)), h / 2);
  const tipW = Math.max(5, Math.round(h * 0.1));
  const gapW = Math.max(4, Math.round(h * 0.075));

  // Top longer, bottom shorter; white cut + green tip
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - slant, y + h);
  if (roundBL) {
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
  } else {
    // Title banner: sharp bottom-left, rounded top-left only
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
  }
  if (r > 0) {
    ctx.quadraticCurveTo(x, y, x + r, y);
  } else {
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x + w - tipW - gapW, y);
  ctx.lineTo(x + w - tipW, y);
  ctx.lineTo(x + w - slant - tipW, y + h);
  ctx.lineTo(x + w - slant - tipW - gapW, y + h);
  ctx.closePath();
  ctx.fill();
}

/** Solid white shield + matching green check (exact reference). */
function drawHeaderShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const w = size * 0.78;
  const h = size;
  const x = cx - w / 2;
  const y = cy - h / 2;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h * 0.18);
  ctx.lineTo(x + w, y + h * 0.55);
  ctx.quadraticCurveTo(x + w * 0.72, y + h * 0.92, x + w / 2, y + h);
  ctx.quadraticCurveTo(x + w * 0.28, y + h * 0.92, x, y + h * 0.55);
  ctx.lineTo(x, y + h * 0.18);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = GREEN;
  ctx.lineWidth = Math.max(2.6, size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y + h * 0.48);
  ctx.lineTo(x + w * 0.44, y + h * 0.64);
  ctx.lineTo(x + w * 0.72, y + h * 0.34);
  ctx.stroke();
}

function measureSlantBannerWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  iconSize: number,
  opts?: { padL?: number; gap?: number; padR?: number; slant?: number; maxW?: number },
): number {
  const padL = opts?.padL ?? 16;
  const gap = opts?.gap ?? 12;
  const padR = opts?.padR ?? 20;
  const slant = opts?.slant ?? 28;
  const tipZone = slant + Math.max(12, Math.round(slant * 0.45));
  const needed = padL + iconSize + gap + ctx.measureText(text).width + padR + tipZone;
  return Math.min(opts?.maxW ?? needed, Math.ceil(needed));
}

/** Exact tag from reference asset (already oriented). */
function drawTagIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  tagImg: HTMLImageElement | null,
) {
  if (tagImg && tagImg.width > 0) {
    const scale = Math.min(size / tagImg.width, size / tagImg.height);
    const dw = tagImg.width * scale;
    const dh = tagImg.height * scale;
    ctx.drawImage(tagImg, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    return;
  }

  // Fallback vector if asset fails to load
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(Math.PI / 4);
  const len = size * 0.95;
  const halfW = size * 0.3;
  const tip = len * 0.36;
  const rr = Math.max(2, size * 0.07);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-len / 2 + rr, -halfW);
  ctx.lineTo(len / 2 - tip, -halfW);
  ctx.lineTo(len / 2 - rr * 0.5, -rr * 0.3);
  ctx.quadraticCurveTo(len / 2, 0, len / 2 - rr * 0.5, rr * 0.3);
  ctx.lineTo(len / 2 - tip, halfW);
  ctx.lineTo(-len / 2 + rr, halfW);
  ctx.quadraticCurveTo(-len / 2, halfW, -len / 2, halfW - rr);
  ctx.lineTo(-len / 2, -halfW + rr);
  ctx.quadraticCurveTo(-len / 2, -halfW, -len / 2 + rr, -halfW);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(len / 2 - tip * 0.42, 0, Math.max(2.4, size * 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFieldIconTile(
  ctx: CanvasRenderingContext2D,
  kind: 'grid' | 'barcode' | 'cubes',
  x: number,
  y: number,
  size: number,
  color: string,
) {
  roundRectPath(ctx, x, y, size, size, Math.max(3, size * 0.18));
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1.6, size * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = size * 0.2;
  const ix = x + p;
  const iy = y + p;
  const iw = size - p * 2;
  const ih = size - p * 2;
  const cx = x + size / 2;
  const cy = y + size / 2;

  if (kind === 'grid') {
    const gap = Math.max(2, size * 0.1);
    const cell = (iw - gap) / 2;
    ctx.fillRect(ix, iy, cell, cell);
    ctx.fillRect(ix + cell + gap, iy, cell, cell);
    ctx.fillRect(ix, iy + cell + gap, cell, cell);
    ctx.fillRect(ix + cell + gap, iy + cell + gap, cell, cell);
  } else if (kind === 'barcode') {
    const bars = [1.2, 0.7, 1.8, 0.7, 1.2, 0.7, 2.2, 0.7, 1.2];
    const total = bars.reduce((a, b) => a + b, 0);
    let bx = ix;
    for (const units of bars) {
      const bw = (iw * units) / total;
      ctx.fillRect(bx, iy, Math.max(1.2, bw * 0.85), ih);
      bx += bw;
    }
  } else {
    const s = iw * 0.36;
    ctx.strokeRect(ix + 1, cy - s * 0.05, s, s);
    ctx.strokeRect(cx - s * 0.35, iy + 1, s, s);
    ctx.strokeRect(cx + s * 0.05, cy - s * 0.15, s, s);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type ShareProduct = Pick<
  CatalogProduct,
  'name' | 'sku' | 'rate' | 'taxPercentage' | 'taxName' | 'unit' | 'categoryId' | 'categoryName'
>;

/** Prefer catalog tax; parse taxName; else default 18% (matches share reference cards). */
function resolveShareTaxPct(product: ShareProduct): number {
  if (Number.isFinite(product.taxPercentage) && product.taxPercentage > 0) {
    return product.taxPercentage;
  }
  const fromName = /(\d+(?:\.\d+)?)\s*%/.exec(product.taxName ?? '');
  if (fromName) {
    const n = Number(fromName[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 18;
}

async function buildShareCardBlob(
  product: ShareProduct,
  imageUrl: string | null,
  _imageIndex: number,
  _imageCount: number,
): Promise<Blob> {
  const mrpRules = await loadMrpRules();
  const mrpGroupRule = resolveMrpGroupRule(product, mrpRules);

  // Match reference aspect 411×616 exactly
  const W = 900;
  const S = W / REF_W;
  const H = Math.round(REF_H * S);
  const sc = (n: number) => Math.round(n * S);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create share card.');

  const cardR = sc(10);
  // Fill full canvas white with uniform rounded corners (avoids sharp/uneven clip)
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, 0, 0, W, H, cardR);
  ctx.fill();
  // Clip everything to the rounded card
  roundRectPath(ctx, 0, 0, W, H, cardR);
  ctx.save();
  ctx.clip();

  const innerL = sc(10);
  const innerR = W - sc(10);
  const innerW = innerR - innerL;
  // Header flush with card top so top corners match
  let y = 0;

  // --- Header banner (ref: h=48, ~80% width) ---
  const headerH = sc(48);
  const headerIconPad = sc(5);
  const headerIcon = headerH - headerIconPad * 2;
  const headerFont = sc(20);
  const headerPadL = sc(10);
  const headerGap = sc(8);
  const headerText = 'GENUINE SPARE PARTS';
  const headerSlant = sc(25);
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  const headerBannerW = Math.min(
    W - sc(4),
    Math.max(
      sc(327),
      measureSlantBannerWidth(ctx, headerText, headerIcon, {
        padL: headerPadL,
        gap: headerGap,
        padR: sc(28),
        slant: headerSlant,
        maxW: W - sc(4),
      }),
    ),
  );
  drawSlantBanner(ctx, 0, y, headerBannerW, headerH, headerSlant, {
    roundBottomLeft: false,
    cornerR: cardR,
  });
  drawHeaderShield(ctx, headerPadL + headerIcon / 2 + sc(4), y + headerH / 2, headerIcon);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(headerText, headerPadL + headerIcon + headerGap + sc(4), y + headerH / 2);
  y += headerH + sc(6);

  // --- Image area (white to match product photo backgrounds) ---
  const imgH = sc(249);
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, innerL, y, innerW, imgH, sc(6));
  ctx.fill();

  if (imageUrl) {
    const img = await loadImage(imageUrl);
    if (img && img.width > 0) {
      const maxW = innerW - sc(20);
      const maxH = imgH - sc(20);
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, innerL + (innerW - dw) / 2, y + (imgH - dh) / 2, dw, dh);
    }
  } else {
    ctx.fillStyle = '#9ca3af';
    ctx.font = `bold ${sc(18)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No image', innerL + innerW / 2, y + imgH / 2);
  }
  y += imgH + sc(4);

  // --- Title banner (ref: h=39, ~86% width) ---
  const titleH = sc(39);
  const titleIconPad = sc(4);
  const titleIcon = titleH - titleIconPad * 2;
  const title = (product.name.trim() || 'PRODUCT').toUpperCase();
  const titleSlant = sc(22);
  const tagImg = await loadImage(shareTagIconUrl);
  let titleFont = sc(17);
  ctx.font = `bold ${titleFont}px Arial, Helvetica, sans-serif`;
  const titleMaxTextW = sc(355) - sc(12) - titleIcon - sc(8) - sc(40) - titleSlant;
  while (titleFont > sc(11) && ctx.measureText(title).width > titleMaxTextW) {
    titleFont -= 1;
    ctx.font = `bold ${titleFont}px Arial, Helvetica, sans-serif`;
  }
  const titleBannerW = Math.min(
    innerW,
    Math.max(
      sc(300),
      measureSlantBannerWidth(ctx, title, titleIcon, {
        padL: sc(10),
        gap: sc(8),
        padR: sc(48),
        slant: titleSlant,
        maxW: innerW,
      }),
    ),
  );
  drawSlantBanner(ctx, innerL, y, titleBannerW, titleH, titleSlant, { roundBottomLeft: false });
  drawTagIcon(ctx, innerL + sc(8), y + titleIconPad, titleIcon, tagImg);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${titleFont}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, innerL + sc(8) + titleIcon + sc(8), y + titleH / 2);
  y += titleH + sc(4);

  // --- Detail rows (ref: ~33px each, icons 24) ---
  const unit = (product.unit ?? 'pcs').trim() || 'pcs';
  const qty = /nos/i.test(unit) || /pc/i.test(unit) ? '1 nos' : `1 ${unit}`;
  const rows: Array<{
    icon: 'grid' | 'barcode' | 'cubes';
    color: string;
    label: string;
    value: string;
  }> = [
    { icon: 'grid', color: ICON_GREEN, label: 'ITEM NAME', value: product.name.trim() || '—' },
    { icon: 'barcode', color: ICON_BLUE, label: 'SKU', value: (product.sku ?? '').trim() || '—' },
    { icon: 'cubes', color: ICON_PURPLE, label: 'QTY', value: qty },
  ];

  const rowH = sc(33);
  const iconSize = sc(24);
  const rowFont = sc(13);
  const rowValueFont = sc(13);
  ctx.font = `bold ${rowFont}px Arial, Helvetica, sans-serif`;
  let labelColW = 0;
  for (const row of rows) {
    labelColW = Math.max(labelColW, ctx.measureText(row.label).width);
  }
  labelColW = Math.min(labelColW + sc(2), sc(90));

  rows.forEach((row, i) => {
    const cy = y + rowH / 2;
    if (i > 0) {
      ctx.strokeStyle = ROW_LINE;
      ctx.lineWidth = Math.max(1, sc(1));
      ctx.beginPath();
      ctx.moveTo(innerL + sc(4), y);
      ctx.lineTo(innerR - sc(4), y);
      ctx.stroke();
    }
    drawFieldIconTile(ctx, row.icon, innerL + sc(16), cy - iconSize / 2, iconSize, row.color);
    const textX = innerL + sc(16) + iconSize + sc(10);
    ctx.fillStyle = '#111111';
    ctx.font = `bold ${rowFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, textX, cy);
    const colonX = textX + labelColW + sc(6);
    ctx.fillText(':', colonX, cy);
    ctx.font = `bold ${rowValueFont}px Arial, Helvetica, sans-serif`;
    const valueX = colonX + sc(10);
    const valueMax = innerR - valueX - sc(8);
    let vf = rowValueFont;
    while (vf > sc(10) && ctx.measureText(row.value).width > valueMax) {
      vf -= 1;
      ctx.font = `bold ${vf}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(row.value, valueX, cy);
    y += rowH;
  });

  y += sc(10);

  // --- Price boxes (ref: h=124, header=21, gap=11) ---
  const rate = Number.isFinite(product.rate) ? product.rate : 0;
  const tax = resolveShareTaxPct(product);
  const dealerGst = round2(rate * (tax / 100));
  const dealerInc = round2(rate + dealerGst);
  const { mrpInclGst: mrpInc, mrpExclGst: mrpExcl, mrpGst } = calculateProductMrpBreakdown(
    rate,
    tax,
    mrpGroupRule,
  );

  const gap = sc(11);
  const boxW = (innerW - gap) / 2;
  const boxH = sc(124);
  const leftX = innerL;
  const rightX = innerL + boxW + gap;
  const headerBarH = sc(21);
  const boxR = sc(6);
  const priceMain = sc(28);
  const priceSub = sc(11);
  const borderW = Math.max(2, sc(1.5));

  // MRP box
  ctx.strokeStyle = RED;
  ctx.lineWidth = borderW;
  roundRectPath(ctx, leftX, y, boxW, boxH, boxR);
  ctx.stroke();
  ctx.fillStyle = RED;
  roundRectPath(ctx, leftX, y, boxW, headerBarH, boxR);
  ctx.fill();
  ctx.fillRect(leftX, y + headerBarH - boxR, boxW, boxR);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${sc(10)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MRP (INCLUDING GST)', leftX + boxW / 2, y + headerBarH / 2);

  const mrpBodyMid = y + headerBarH + (boxH - headerBarH) * 0.42;
  ctx.fillStyle = RED;
  ctx.font = `bold ${priceMain}px Arial, Helvetica, sans-serif`;
  ctx.fillText(money(mrpInc), leftX + boxW / 2, mrpBodyMid);
  ctx.fillStyle = '#111111';
  ctx.font = `bold ${priceSub}px Arial, Helvetica, sans-serif`;
  const mrpSub = `(${money(mrpExcl)} + ${tax}% GST ${money(mrpGst)})`;
  let subSize = priceSub;
  while (subSize > sc(8) && ctx.measureText(mrpSub).width > boxW - sc(12)) {
    subSize -= 1;
    ctx.font = `bold ${subSize}px Arial, Helvetica, sans-serif`;
  }
  ctx.fillText(mrpSub, leftX + boxW / 2, mrpBodyMid + sc(22));

  // Dealer box
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = borderW;
  roundRectPath(ctx, rightX, y, boxW, boxH, boxR);
  ctx.stroke();
  ctx.fillStyle = BLUE;
  roundRectPath(ctx, rightX, y, boxW, headerBarH, boxR);
  ctx.fill();
  ctx.fillRect(rightX, y + headerBarH - boxR, boxW, boxR);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${sc(9)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('DEALER PRICE (EXCLUDING GST)', rightX + boxW / 2, y + headerBarH / 2);

  const dealerTop = y + headerBarH + sc(18);
  ctx.fillStyle = BLUE;
  ctx.font = `bold ${priceMain}px Arial, Helvetica, sans-serif`;
  ctx.fillText(money(rate), rightX + boxW / 2, dealerTop);
  ctx.fillStyle = '#111111';
  ctx.font = `bold ${priceSub}px Arial, Helvetica, sans-serif`;
  ctx.fillText(`+ ${tax}% GST ${money(dealerGst)}`, rightX + boxW / 2, dealerTop + sc(18));

  // Dashed separator (~mid body)
  const dashY = y + headerBarH + sc(52);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = Math.max(1, sc(1));
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([sc(4), sc(3)]);
  ctx.beginPath();
  ctx.moveTo(rightX + sc(10), dashY);
  ctx.lineTo(rightX + boxW - sc(10), dashY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Including GST pill + amount
  const pillLabel = 'DEALER PRICE (INCLUDING GST)';
  ctx.font = `bold ${sc(8)}px Arial, Helvetica, sans-serif`;
  const pillW = Math.min(boxW - sc(16), ctx.measureText(pillLabel).width + sc(14));
  const pillH = sc(14);
  const pillX = rightX + (boxW - pillW) / 2;
  const pillY = dashY + sc(8);
  roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = BLUE;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillLabel, pillX + pillW / 2, pillY + pillH / 2 + 0.5);

  ctx.fillStyle = BLUE;
  ctx.font = `bold ${sc(22)}px Arial, Helvetica, sans-serif`;
  ctx.fillText(money(dealerInc), rightX + boxW / 2, pillY + pillH + sc(16));

  y += boxH + sc(14);

  // Footer (ref ~y=597)
  ctx.fillStyle = '#222222';
  ctx.font = `bold ${sc(11)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Interweighing Private Limited', W / 2, Math.min(y + sc(4), H - sc(18)));

  ctx.restore(); // end card clip

  // Border on top of clipped content
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = Math.max(2, sc(1.5));
  roundRectPath(ctx, sc(0.75), sc(0.75), W - sc(1.5), H - sc(1.5), Math.max(0, cardR - sc(0.5)));
  ctx.stroke();

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export share card.'));
    }, 'image/png');
  });
}

type Props = {
  product: ShareProduct;
  imageUrl: string | null;
  imageIndex?: number;
  imageCount?: number;
  onClose: () => void;
};

export const ProductWhatsAppShareDialog: React.FC<Props> = ({
  product,
  imageUrl,
  imageIndex = 0,
  imageCount = 1,
  onClose,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setBuilding(true);
    setError('');
    void buildShareCardBlob(product, imageUrl, imageIndex, Math.max(1, imageCount))
      .then(blob => {
        if (!active) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Could not build preview.');
      })
      .finally(() => {
        if (active) setBuilding(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [product, imageUrl, imageIndex, imageCount]);

  const handleShare = async () => {
    setSharing(true);
    setError('');
    try {
      const blob = blobRef.current;
      if (!blob) throw new Error('Preview not ready.');

      const safeName = ((product.sku || product.name || 'product').trim() || 'product')
        .replace(/[^\w\-]+/g, '-')
        .slice(0, 40);
      const fileName = `${safeName}-share.png`;

      // APK: system share sheet — WhatsApp, email, and any app that accepts images.
      if (Capacitor.isNativePlatform()) {
        const dataBase64 = await blobToBase64(blob);
        await WhatsAppShare.shareImage({
          dataBase64,
          fileName,
          mimeType: 'image/png',
        });
        return;
      }

      // PWA/browser: prefer Web Share with the image file when the browser supports it.
      const file = new File([blob], fileName, { type: 'image/png' });
      const shareData: ShareData = {
        files: [file],
        title: product.name.trim() || 'Genuine Spare Part',
      };
      if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }

      // Fallback: upload card and open WhatsApp with the image link.
      const imageUrl = await uploadWhatsAppShareCard(blob, fileName);
      const shareText = [
        product.name.trim() || 'Genuine Spare Part',
        product.sku?.trim() ? `SKU: ${product.sku.trim()}` : '',
        imageUrl,
        'Interweighing Private Limited · Genuine Spare Parts',
      ].filter(Boolean).join('\n');
      openWhatsAppWithText(shareText);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div className="product-wa-share__backdrop" onClick={onClose}>
      <div
        className="product-wa-share panel glass"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-wa-share-title"
      >
        <div className="product-wa-share__header">
          <div>
            <h2 id="product-wa-share-title">Share product</h2>
            <p className="text-muted text-sm">Preview card · then share</p>
          </div>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <p className="dealers-modal__error">{error}</p>}

        <div className="product-wa-share__preview">
          {building || !previewUrl ? (
            <div className="product-wa-share__loading">
              <div className="loader-ring" />
            </div>
          ) : (
            <img src={previewUrl} alt="Product share card preview" className="product-wa-share__card" />
          )}
        </div>

        <div className="product-wa-share__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sharing}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary product-wa-share__share-btn"
            onClick={() => void handleShare()}
            disabled={building || sharing || !previewUrl}
          >
            <Share2 size={16} aria-hidden />
            {sharing ? 'Sharing…' : 'Share image'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export { WhatsAppIcon };
