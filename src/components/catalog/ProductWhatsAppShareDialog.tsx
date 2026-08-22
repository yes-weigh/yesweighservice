import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { doc, getDoc } from 'firebase/firestore';
import { Share2, X } from 'lucide-react';
import { WhatsAppShare } from 'whatsapp-share';
import type { CatalogProduct } from '../../types/catalog';
import shareTagIconUrl from '../../assets/share-tag-icon.png';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase';
import { openWhatsAppWithText, uploadWhatsAppShareCard } from '../../lib/whatsappShareCard';
import { isCatalogSparePartProduct } from '../../lib/catalog';
import { loadMrpRules } from '../../lib/catalogProductSettings';
import { calculateProductMrpForCatalogItem } from '../../lib/catalogMrp';

const GREEN = '#036e35';
const RED = '#d8151d';
const BLUE = '#053cbd';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type ShareProduct = Pick<
  CatalogProduct,
  | 'name'
  | 'sku'
  | 'rate'
  | 'taxPercentage'
  | 'taxName'
  | 'unit'
  | 'categoryId'
  | 'categoryName'
  | 'mrpOverride'
  | 'description'
  | 'modelNumber'
  | 'approvalNumber'
  | 'hsn'
>;

type ShareCardOptions = {
  /** Dealer portal rate card: MRP only, larger image, full specs. */
  mrpOnly?: boolean;
  footerName?: string | null;
  stampingLabels?: string[];
};

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

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
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
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1] ?? '';
    let clipped = last;
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    lines[maxLines - 1] = `${clipped}…`;
  }
  return lines;
}

/** Parse "Make : YESWEIGH Max:50kg e:5g …" style catalog descriptions into label/value rows. */
function parseDescriptionSpecs(description: string | null | undefined): Array<{ label: string; value: string }> {
  const raw = String(description ?? '').trim();
  if (!raw) return [];
  const rows: Array<{ label: string; value: string }> = [];
  for (const line of raw.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const matches = [...trimmed.matchAll(/([A-Za-z][A-Za-z0-9./\s-]{0,28}?)\s*:\s*/g)];
    if (matches.length === 0) {
      rows.push({ label: 'Details', value: trimmed });
      continue;
    }
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      if (!match || match.index == null) continue;
      const label = String(match[1] ?? '').trim();
      const valueStart = match.index + match[0].length;
      const valueEnd = i + 1 < matches.length && matches[i + 1]?.index != null
        ? matches[i + 1]!.index!
        : trimmed.length;
      const value = trimmed.slice(valueStart, valueEnd).trim();
      if (!label || !value) continue;
      rows.push({ label, value });
    }
  }
  return rows;
}

type PrimarySpecLabel = 'Brand' | 'Max' | 'E' | 'Min' | 'Class' | 'Display';

function normalizeSpecKey(label: string): string {
  const key = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === 'e' || key === 'accuracy' || key === 'accuracy (e)' || key === 'e-value' || key === 'e value') {
    return 'E';
  }
  if (key === 'max' || key === 'maximum' || key === 'capacity' || key === 'max capacity') return 'Max';
  if (key === 'min' || key === 'minimum' || key === 'min capacity') return 'Min';
  if (key === 'class' || key === 'accuracy class') return 'Class';
  if (key === 'make' || key === 'brand') return 'Brand';
  if (key === 'display') return 'Display';
  return label.trim();
}

/** "50kg" → "50 kg", "100g" → "100 g", "5g" → "5g" for E (compact). */
function formatSpecValue(label: PrimarySpecLabel | string, value: string): string {
  let v = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!v) return v;

  if (label === 'Brand') {
    // YESWEIGH → Yesweigh
    if (/^[A-Z0-9][A-Z0-9\s./-]*$/.test(v) && /[A-Z]/.test(v)) {
      v = v
        .toLowerCase()
        .split(/(\s+)/)
        .map(part => (/^\s+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
    }
    return v;
  }

  if (label === 'Display') {
    if (/^(green|red|blue|white|amber|orange|yellow)$/i.test(v)) {
      return `${v.charAt(0).toUpperCase()}${v.slice(1).toLowerCase()} LED`;
    }
    if (/led/i.test(v)) {
      return v.replace(/\bled\b/i, 'LED');
    }
    return v;
  }

  if (label === 'Class') {
    return v.toUpperCase();
  }

  if (label === 'Max' || label === 'Min' || label === 'E') {
    // Compact lowercase units: 50kg, 5g, 100g
    const m = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Zμµ]+)$/.exec(v);
    if (m) return `${m[1]}${m[2]!.toLowerCase()}`;
  }

  return v;
}

/** Pull Brand / Max / E / Min / Class from catalog description (Display omitted — avoids repetition). */
function extractPrimarySpecs(
  description: string | null | undefined,
): Partial<Record<PrimarySpecLabel, string>> {
  const parsed = parseDescriptionSpecs(description);
  const out: Partial<Record<PrimarySpecLabel, string>> = {};
  for (const row of parsed) {
    const key = normalizeSpecKey(row.label);
    if (key === 'Brand' || key === 'Max' || key === 'E' || key === 'Min' || key === 'Class') {
      out[key] = formatSpecValue(key, row.value);
    }
  }
  const raw = String(description ?? '');
  const fallbacks: Array<[PrimarySpecLabel, RegExp]> = [
    ['Brand', /\b(?:Make|Brand)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\s./-]{0,40}?)(?=\s+(?:Max|Min|e|E|Class|Display)\b|$)/i],
    ['Max', /\bMax(?:imum)?\s*:?\s*([0-9]+(?:\.[0-9]+)?\s*[a-zA-Zμµ]*)/i],
    ['E', /\be\s*:?\s*([0-9]+(?:\.[0-9]+)?\s*[a-zA-Zμµ]*)/i],
    ['Min', /\bMin(?:imum)?\s*:?\s*([0-9]+(?:\.[0-9]+)?\s*[a-zA-Zμµ]*)/i],
    ['Class', /\bClass\s*:?\s*([IVX0-9]+)/i],
  ];
  for (const [key, re] of fallbacks) {
    if (out[key]) continue;
    const m = re.exec(raw);
    if (m?.[1]) out[key] = formatSpecValue(key, m[1].trim());
  }
  return out;
}

type RateCardSpecs = {
  modelNumber: string | null;
  approvalNumber: string | null;
  /** Ordered: Brand, Max, E, Min, Class (no Display) */
  primarySpecs: Array<{ label: PrimarySpecLabel; value: string }>;
  otherRows: Array<{ label: string; value: string }>;
};

const PRIMARY_SPEC_ORDER: PrimarySpecLabel[] = ['Brand', 'Max', 'E', 'Min', 'Class'];

function buildRateCardSpecs(
  product: ShareProduct,
  _stampingLabels: string[],
): RateCardSpecs {
  const modelNumber = product.modelNumber?.trim() || null;
  const approvalNumber = product.approvalNumber?.trim() || null;
  const primary = extractPrimarySpecs(product.description);
  const primarySpecs = PRIMARY_SPEC_ORDER
    .filter(label => Boolean(primary[label]))
    .map(label => ({ label, value: primary[label]! }));

  const otherRows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    if (otherRows.some(row => row.label.toLowerCase() === label.toLowerCase())) return;
    otherRows.push({ label, value: v });
  };

  // SKU is already on the banner; skip Category, Display, GATC, and raw description leftovers.
  push('HSN', product.hsn);
  push('Unit', product.unit);

  return { modelNumber, approvalNumber, primarySpecs, otherRows };
}

async function buildShareCardBlob(
  product: ShareProduct,
  imageUrl: string | null,
  _imageIndex: number,
  _imageCount: number,
  options: ShareCardOptions = {},
): Promise<Blob> {
  const mrpOnly = Boolean(options.mrpOnly);
  const footerName = String(options.footerName ?? '').trim() || 'Dealer name';
  const stampingLabels = Array.isArray(options.stampingLabels)
    ? options.stampingLabels.map(s => String(s).trim()).filter(Boolean)
    : [];
  const mrpRules = await loadMrpRules();

  // Logical design size; export at 2× for sharp WhatsApp photos.
  const W = 900;
  const EXPORT_SCALE = 2;
  const S = W / REF_W;
  const sc = (n: number) => Math.round(n * S);
  const isSpareShare = isCatalogSparePartProduct(product);
  const productName = product.name.trim() || 'PRODUCT';
  const productSku = (product.sku ?? '').trim() || '—';
  const rateSpecs = buildRateCardSpecs(product, stampingLabels);

  const innerL = sc(8);
  const innerR = W - sc(8);
  const innerW = innerR - innerL;

  // Photo: natural aspect, moderate height so the card stays compact.
  const photoPad = sc(6);
  const photoMaxW = innerW - photoPad * 2;
  const photoMaxH = sc(230);
  let photoImg: HTMLImageElement | null = null;
  let photoDw = 0;
  let photoDh = 0;
  if (imageUrl) {
    photoImg = await loadImage(imageUrl);
    if (photoImg && photoImg.width > 0 && photoImg.height > 0) {
      const scale = Math.min(photoMaxW / photoImg.width, photoMaxH / photoImg.height);
      photoDw = Math.round(photoImg.width * scale);
      photoDh = Math.round(photoImg.height * scale);
    }
  }
  const imgH = photoDh > 0 ? photoDh + photoPad * 2 : sc(200);

  // Tall enough buffer; we crop to content at the end (kills footer blank space).
  const H = Math.round(REF_H * S) + Math.max(0, imgH - sc(200)) + sc(120);

  const canvas = document.createElement('canvas');
  canvas.width = W * EXPORT_SCALE;
  canvas.height = H * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create share card.');
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const cardR = sc(10);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, 0, 0, W, H, cardR);
  ctx.fill();
  roundRectPath(ctx, 0, 0, W, H, cardR);
  ctx.save();
  ctx.clip();

  let y = 0;

  // --- Header banner ---
  const headerH = sc(42);
  const headerIconPad = sc(4);
  const headerIcon = headerH - headerIconPad * 2;
  let headerFont = sc(18);
  const headerPadL = sc(10);
  const headerGap = sc(8);
  const headerText = (isSpareShare ? 'GENUINE SPARE PARTS' : productName).toUpperCase();
  const headerSlant = sc(22);
  ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  const headerMaxTextW = sc(327) - headerPadL - headerIcon - headerGap - sc(28) - headerSlant;
  while (headerFont > sc(12) && ctx.measureText(headerText).width > headerMaxTextW) {
    headerFont -= 1;
    ctx.font = `bold ${headerFont}px Arial, Helvetica, sans-serif`;
  }
  const headerBannerW = Math.min(
    W - sc(4),
    Math.max(
      sc(300),
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
  y += headerH + sc(3);

  // --- Image ---
  ctx.fillStyle = '#fafafa';
  roundRectPath(ctx, innerL, y, innerW, imgH, sc(6));
  ctx.fill();

  if (photoImg && photoDw > 0 && photoDh > 0) {
    ctx.drawImage(
      photoImg,
      innerL + (innerW - photoDw) / 2,
      y + (imgH - photoDh) / 2,
      photoDw,
      photoDh,
    );
  } else {
    ctx.fillStyle = '#9ca3af';
    ctx.font = `bold ${sc(16)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No image', innerL + innerW / 2, y + imgH / 2);
  }
  y += imgH + sc(3);

  // --- SKU banner ---
  const titleH = sc(30);
  const titleIconPad = sc(3);
  const titleIcon = titleH - titleIconPad * 2;
  const title = (isSpareShare ? productName : `SKU: ${productSku}`).toUpperCase();
  const titleSlant = sc(18);
  const tagImg = await loadImage(shareTagIconUrl);
  let titleFont = sc(14);
  ctx.font = `bold ${titleFont}px Arial, Helvetica, sans-serif`;
  const titleMaxTextW = sc(355) - sc(12) - titleIcon - sc(8) - sc(40) - titleSlant;
  while (titleFont > sc(11) && ctx.measureText(title).width > titleMaxTextW) {
    titleFont -= 1;
    ctx.font = `bold ${titleFont}px Arial, Helvetica, sans-serif`;
  }
  const titleBannerW = Math.min(
    innerW,
    Math.max(
      sc(260),
      measureSlantBannerWidth(ctx, title, titleIcon, {
        padL: sc(10),
        gap: sc(8),
        padR: sc(36),
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

  // --- Model / Approval (no green section title) ---
  {
    const idItems: Array<{ label: string; value: string }> = [];
    if (rateSpecs.modelNumber) {
      idItems.push({ label: 'Model No.', value: rateSpecs.modelNumber });
    }
    if (rateSpecs.approvalNumber) {
      idItems.push({ label: 'Approval No.', value: rateSpecs.approvalNumber });
    }
    if (idItems.length) {
      const idBoxH = sc(40);
      ctx.fillStyle = '#f3faf5';
      roundRectPath(ctx, innerL, y, innerW, idBoxH, sc(6));
      ctx.fill();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = Math.max(1.5, sc(1.2));
      roundRectPath(ctx, innerL, y, innerW, idBoxH, sc(6));
      ctx.stroke();

      const colW = idItems.length === 2 ? (innerW - sc(20)) / 2 : innerW - sc(20);
      idItems.forEach((row, i) => {
        const cx = innerL + sc(10) + i * colW;
        const cy = y + idBoxH / 2;
        ctx.fillStyle = '#666666';
        ctx.font = `bold ${sc(9)}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(row.label.toUpperCase(), cx, cy - sc(8));
        ctx.fillStyle = '#111111';
        ctx.font = `bold ${sc(13)}px Arial, Helvetica, sans-serif`;
        let vf = sc(13);
        while (vf > sc(10) && ctx.measureText(row.value).width > colW - sc(8)) {
          vf -= 1;
          ctx.font = `bold ${vf}px Arial, Helvetica, sans-serif`;
        }
        ctx.fillText(row.value, cx, cy + sc(8));
      });
      y += idBoxH + sc(5);
    }

    // Specs: 2 per row — Brand | Max, E | Min, Class
    if (rateSpecs.primarySpecs.length) {
      const rowH = sc(22);
      const pairRows = Math.ceil(rateSpecs.primarySpecs.length / 2);
      const boxH = sc(12) + pairRows * rowH + sc(4);
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, innerL, y, innerW, boxH, sc(6));
      ctx.fill();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = Math.max(1.5, sc(1.2));
      roundRectPath(ctx, innerL, y, innerW, boxH, sc(6));
      ctx.stroke();

      ctx.fillStyle = GREEN;
      ctx.font = `bold ${sc(9)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('SPECIFICATIONS', innerL + sc(10), y + sc(8));

      const colGap = sc(8);
      const colW = (innerW - sc(20) - colGap) / 2;
      const specsTop = y + sc(16);
      rateSpecs.primarySpecs.forEach((row, i) => {
        const col = i % 2;
        const pair = Math.floor(i / 2);
        const cx = innerL + sc(10) + col * (colW + colGap);
        const cy = specsTop + pair * rowH + rowH / 2;
        ctx.fillStyle = '#555555';
        ctx.font = `bold ${sc(11)}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'left';
        const labelText = `${row.label}`;
        ctx.fillText(labelText, cx, cy);
        const lw = ctx.measureText(labelText).width;
        ctx.fillText(':', cx + lw + sc(2), cy);
        ctx.fillStyle = '#111111';
        ctx.font = `bold ${sc(12)}px Arial, Helvetica, sans-serif`;
        ctx.fillText(row.value, cx + lw + sc(10), cy);
      });
      y += boxH + sc(5);
    }

    // HSN | Unit only
    const otherRows = rateSpecs.otherRows;
    if (otherRows.length) {
      const rowH = sc(20);
      const colGap = sc(8);
      const colW = (innerW - sc(8) - colGap) / 2;
      otherRows.forEach((row, i) => {
        const col = i % 2;
        const pair = Math.floor(i / 2);
        const cx = innerL + sc(4) + col * (colW + colGap);
        const cy = y + pair * rowH + rowH / 2;
        ctx.fillStyle = '#666666';
        ctx.font = `bold ${sc(10)}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const labelText = row.label.toUpperCase();
        ctx.fillText(labelText, cx, cy);
        const lw = ctx.measureText(labelText).width;
        ctx.fillStyle = '#111111';
        ctx.font = `bold ${sc(11)}px Arial, Helvetica, sans-serif`;
        ctx.fillText(row.value, cx + lw + sc(8), cy);
      });
      y += Math.ceil(otherRows.length / 2) * rowH + sc(4);
    }
  }

  y += sc(4);

  // --- Price ---
  const rate = Number.isFinite(product.rate) ? product.rate : 0;
  const tax = resolveShareTaxPct(product);
  const dealerGst = round2(rate * (tax / 100));
  const dealerInc = round2(rate + dealerGst);
  const { mrpInclGst: mrpInc, mrpExclGst: mrpExcl, mrpGst } = calculateProductMrpForCatalogItem(
    { ...product, taxPercentage: tax },
    mrpRules,
  );

  const gap = sc(10);
  const boxW = mrpOnly ? innerW : (innerW - gap) / 2;
  const boxH = mrpOnly ? sc(96) : sc(110);
  const leftX = innerL;
  const rightX = innerL + boxW + gap;
  const headerBarH = sc(20);
  const boxR = sc(6);
  const priceMain = sc(26);
  const priceSub = sc(11);
  const borderW = Math.max(2, sc(1.5));

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
  ctx.fillText(mrpSub, leftX + boxW / 2, mrpBodyMid + sc(20));

  if (!mrpOnly) {
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

    const dealerTop = y + headerBarH + sc(16);
    ctx.fillStyle = BLUE;
    ctx.font = `bold ${priceMain}px Arial, Helvetica, sans-serif`;
    ctx.fillText(money(rate), rightX + boxW / 2, dealerTop);
    ctx.fillStyle = '#111111';
    ctx.font = `bold ${priceSub}px Arial, Helvetica, sans-serif`;
    ctx.fillText(`+ ${tax}% GST ${money(dealerGst)}`, rightX + boxW / 2, dealerTop + sc(16));

    const dashY = y + headerBarH + sc(46);
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

    const pillLabel = 'DEALER PRICE (INCLUDING GST)';
    ctx.font = `bold ${sc(8)}px Arial, Helvetica, sans-serif`;
    const pillW = Math.min(boxW - sc(16), ctx.measureText(pillLabel).width + sc(14));
    const pillH = sc(14);
    const pillX = rightX + (boxW - pillW) / 2;
    const pillY = dashY + sc(6);
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillLabel, pillX + pillW / 2, pillY + pillH / 2 + 0.5);

    ctx.fillStyle = BLUE;
    ctx.font = `bold ${sc(20)}px Arial, Helvetica, sans-serif`;
    ctx.fillText(money(dealerInc), rightX + boxW / 2, pillY + pillH + sc(14));
  }

  y += boxH + sc(10);

  // Footer — tight, then crop canvas to this bottom (no blank space)
  ctx.fillStyle = '#222222';
  ctx.font = `bold ${sc(11)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const footer = mrpOnly ? footerName : 'Interweighing Private Limited';
  const footerLines = wrapCanvasLines(ctx, footer, innerW - sc(20), 2);
  footerLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, y + i * sc(14));
  });
  y += footerLines.length * sc(14) + sc(12);

  ctx.restore();

  const finalH = Math.min(H, Math.ceil(y));
  const out = document.createElement('canvas');
  out.width = W * EXPORT_SCALE;
  out.height = finalH * EXPORT_SCALE;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('Could not export share card.');
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(
    canvas,
    0, 0, W * EXPORT_SCALE, finalH * EXPORT_SCALE,
    0, 0, W * EXPORT_SCALE, finalH * EXPORT_SCALE,
  );

  // Border on cropped card
  outCtx.scale(EXPORT_SCALE, EXPORT_SCALE);
  outCtx.strokeStyle = '#9ca3af';
  outCtx.lineWidth = Math.max(2, sc(1.5));
  roundRectPath(outCtx, sc(0.75), sc(0.75), W - sc(1.5), finalH - sc(1.5), Math.max(0, cardR - sc(0.5)));
  outCtx.stroke();

  return new Promise((resolve, reject) => {
    out.toBlob(blob => {
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
  /** Dealer portal: hide dealer price, show MRP-only professional rate card. */
  mrpOnly?: boolean;
  footerName?: string | null;
  stampingLabels?: string[];
  onClose: () => void;
};

export const ProductWhatsAppShareDialog: React.FC<Props> = ({
  product,
  imageUrl,
  imageIndex = 0,
  imageCount = 1,
  mrpOnly: mrpOnlyProp,
  footerName: footerNameProp,
  stampingLabels = [],
  onClose,
}) => {
  const { user } = useAuth();
  const isDealerPortal = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const mrpOnly = mrpOnlyProp ?? isDealerPortal;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [resolvedFooterName, setResolvedFooterName] = useState<string>(
    footerNameProp?.trim() || (isDealerPortal ? (user?.displayName?.trim() || 'Dealer name') : 'Interweighing Private Limited'),
  );
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    if (footerNameProp?.trim()) {
      setResolvedFooterName(footerNameProp.trim());
      return;
    }
    if (!mrpOnly) {
      setResolvedFooterName('Interweighing Private Limited');
      return;
    }
    const customerId = user?.zohoCustomerId?.trim() || user?.dealerId?.trim() || '';
    if (!customerId) {
      setResolvedFooterName(user?.displayName?.trim() || 'Dealer name');
      return;
    }
    let active = true;
    void getDoc(doc(db, 'zohoCustomers', customerId))
      .then(snap => {
        if (!active) return;
        const name = String(snap.data()?.customerName ?? '').trim();
        setResolvedFooterName(name || user?.displayName?.trim() || 'Dealer name');
      })
      .catch(() => {
        if (active) setResolvedFooterName(user?.displayName?.trim() || 'Dealer name');
      });
    return () => {
      active = false;
    };
  }, [footerNameProp, mrpOnly, user?.zohoCustomerId, user?.dealerId, user?.displayName]);

  const stampingKey = stampingLabels.join('|');

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setBuilding(true);
    setError('');
    void buildShareCardBlob(product, imageUrl, imageIndex, Math.max(1, imageCount), {
      mrpOnly,
      footerName: resolvedFooterName,
      stampingLabels,
    })
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
    // stampingKey captures stampingLabels contents without referential churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, imageUrl, imageIndex, imageCount, mrpOnly, resolvedFooterName, stampingKey]);

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

      if (Capacitor.isNativePlatform()) {
        const dataBase64 = await blobToBase64(blob);
        await WhatsAppShare.shareImage({
          dataBase64,
          fileName,
          mimeType: 'image/png',
        });
        return;
      }

      const file = new File([blob], fileName, { type: 'image/png' });
      const shareData: ShareData = {
        files: [file],
        title: product.name.trim() || 'Product',
      };
      if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }

      const sharedImageUrl = await uploadWhatsAppShareCard(blob, fileName);
      const shareText = [
        product.name.trim() || 'Product',
        product.sku?.trim() ? `SKU: ${product.sku.trim()}` : '',
        sharedImageUrl,
        mrpOnly ? resolvedFooterName : 'Interweighing Private Limited · Genuine Spare Parts',
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
            <h2 id="product-wa-share-title">{mrpOnly ? 'Share rate card' : 'Share product'}</h2>
            <p className="text-muted text-sm">
              {mrpOnly ? 'MRP rate card · then share' : 'Preview card · then share'}
            </p>
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
