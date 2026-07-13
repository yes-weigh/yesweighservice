/** Canvas icon helpers for Genuine Spare Product label (mono thermal). */

import { roundRect } from './canvasUtils';

export function fillInvertedPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fontPx: number,
  opts?: { bold?: boolean; fullPill?: boolean; padX?: number; radiusPx?: number },
): void {
  const bold = opts?.bold !== false;
  const padX = opts?.padX ?? 8;
  const r = opts?.fullPill
    ? h / 2
    : Math.min(opts?.radiusPx ?? 4, h / 2, w / 2);
  ctx.fillStyle = '#000';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = '#fff';
  let size = fontPx;
  const weight = bold ? 'bold ' : '';
  const maxTextW = Math.max(8, w - padX * 2);
  while (size > 5) {
    ctx.font = `${weight}${size}px Arial, Helvetica, sans-serif`;
    if (ctx.measureText(text).width <= maxTextW) break;
    size -= 1;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.fillStyle = '#000';
}

/** Small black tile with white glyph — field row icons. */
export function drawFieldIcon(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  size: number,
): void {
  const r = Math.max(2, Math.round(size * 0.18));
  ctx.fillStyle = '#000';
  roundRect(ctx, x, y, size, size, r);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = size * 0.22;
  const ix = x + p;
  const iy = y + p;
  const iw = size - p * 2;
  const ih = size - p * 2;
  const cx = x + size / 2;
  const cy = y + size / 2;

  switch (kind) {
    case 'grid': {
      const gap = Math.max(1, size * 0.08);
      const cell = (iw - gap) / 2;
      ctx.fillRect(ix, iy, cell, cell);
      ctx.fillRect(ix + cell + gap, iy, cell, cell);
      ctx.fillRect(ix, iy + cell + gap, cell, cell);
      ctx.fillRect(ix + cell + gap, iy + cell + gap, cell, cell);
      break;
    }
    case 'box':
    case 'package': {
      ctx.strokeRect(ix, iy + ih * 0.15, iw, ih * 0.7);
      ctx.beginPath();
      ctx.moveTo(ix, iy + ih * 0.4);
      ctx.lineTo(ix + iw, iy + ih * 0.4);
      ctx.moveTo(cx, iy + ih * 0.15);
      ctx.lineTo(cx, iy + ih * 0.85);
      ctx.stroke();
      break;
    }
    case 'barcode': {
      const gaps = [1, 2, 1, 3, 1, 2, 1, 2, 1, 3, 1];
      const unit = iw / 22;
      let bx = ix;
      for (let i = 0; i < gaps.length; i += 1) {
        const bw = unit * gaps[i];
        if (i % 2 === 0) ctx.fillRect(bx, iy, Math.max(1, bw), ih);
        bx += bw;
      }
      break;
    }
    case 'tag': {
      ctx.beginPath();
      ctx.moveTo(ix + iw * 0.15, iy);
      ctx.lineTo(ix + iw, iy);
      ctx.lineTo(ix + iw, iy + ih * 0.7);
      ctx.lineTo(cx, iy + ih);
      ctx.lineTo(ix, iy + ih * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ix + iw * 0.55, iy + ih * 0.32, size * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cubes': {
      const s = iw * 0.38;
      ctx.strokeRect(ix, cy - s * 0.1, s, s);
      ctx.strokeRect(cx - s * 0.1, iy, s, s);
      ctx.strokeRect(cx + s * 0.15, cy - s * 0.05, s, s);
      break;
    }
    case 'rupee': {
      ctx.font = `bold ${Math.round(size * 0.55)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₹', cx, cy + 0.5);
      break;
    }
    default: {
      ctx.strokeRect(ix, iy, iw, ih);
      break;
    }
  }
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
}

/** Header shield — black fill (default) or white fill for black banners. */
export function drawShieldCheck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  inverted = false,
): void {
  const w = size * 0.78;
  const h = size;
  const fill = inverted ? '#fff' : '#000';
  const stroke = inverted ? '#000' : '#fff';
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h * 0.18);
  ctx.lineTo(x + w, y + h * 0.55);
  ctx.quadraticCurveTo(x + w * 0.72, y + h * 0.92, x + w / 2, y + h);
  ctx.quadraticCurveTo(x + w * 0.28, y + h * 0.92, x, y + h * 0.55);
  ctx.lineTo(x, y + h * 0.18);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.5, size * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y + h * 0.48);
  ctx.lineTo(x + w * 0.44, y + h * 0.64);
  ctx.lineTo(x + w * 0.72, y + h * 0.34);
  ctx.stroke();
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
}

/** Footer row icons (outline, not tiled). */
export function drawFooterGlyph(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size;

  switch (kind) {
    case 'calendar': {
      roundRect(ctx, x, y + s * 0.15, s, s * 0.75, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.22, y + s * 0.08);
      ctx.lineTo(x + s * 0.22, y + s * 0.28);
      ctx.moveTo(x + s * 0.78, y + s * 0.08);
      ctx.lineTo(x + s * 0.78, y + s * 0.28);
      ctx.moveTo(x, y + s * 0.4);
      ctx.lineTo(x + s, y + s * 0.4);
      ctx.stroke();
      break;
    }
    case 'shield': {
      drawShieldCheck(ctx, x + s * 0.1, y, s * 0.85);
      break;
    }
    case 'clipboard': {
      roundRect(ctx, x + s * 0.15, y + s * 0.18, s * 0.7, s * 0.72, 2);
      ctx.stroke();
      roundRect(ctx, x + s * 0.28, y + s * 0.05, s * 0.44, s * 0.22, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.3, y + s * 0.48);
      ctx.lineTo(x + s * 0.7, y + s * 0.48);
      ctx.moveTo(x + s * 0.3, y + s * 0.62);
      ctx.lineTo(x + s * 0.7, y + s * 0.62);
      ctx.stroke();
      break;
    }
    case 'grid': {
      const gap = Math.max(1, s * 0.1);
      const cell = (s * 0.7 - gap) / 2;
      const ox = x + s * 0.15;
      const oy = y + s * 0.15;
      ctx.strokeRect(ox, oy, cell, cell);
      ctx.strokeRect(ox + cell + gap, oy, cell, cell);
      ctx.strokeRect(ox, oy + cell + gap, cell, cell);
      ctx.strokeRect(ox + cell + gap, oy + cell + gap, cell, cell);
      break;
    }
    case 'box': {
      ctx.strokeRect(x + s * 0.1, y + s * 0.25, s * 0.8, s * 0.55);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.1, y + s * 0.45);
      ctx.lineTo(x + s * 0.9, y + s * 0.45);
      ctx.moveTo(x + s / 2, y + s * 0.25);
      ctx.lineTo(x + s / 2, y + s * 0.8);
      ctx.stroke();
      break;
    }
    case 'gear': {
      const cx = x + s / 2;
      const cy = y + s / 2;
      const outer = s * 0.42;
      const inner = s * 0.26;
      const hub = s * 0.12;
      const teeth = 8;
      ctx.beginPath();
      for (let i = 0; i < teeth; i += 1) {
        const a0 = (i / teeth) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 0.35) / teeth) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((i + 0.65) / teeth) * Math.PI * 2 - Math.PI / 2;
        const a3 = ((i + 1) / teeth) * Math.PI * 2 - Math.PI / 2;
        const ox0 = cx + Math.cos(a0) * outer;
        const oy0 = cy + Math.sin(a0) * outer;
        if (i === 0) ctx.moveTo(ox0, oy0);
        else ctx.lineTo(ox0, oy0);
        ctx.lineTo(cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer);
        ctx.lineTo(cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner);
        ctx.lineTo(cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner);
        ctx.lineTo(cx + Math.cos(a2) * outer, cy + Math.sin(a2) * outer);
        ctx.lineTo(cx + Math.cos(a3) * outer, cy + Math.sin(a3) * outer);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, hub, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'barcode': {
      const gaps = [1, 2, 1, 3, 1, 2, 1, 2, 1, 3, 1];
      const unit = (s * 0.8) / 22;
      let bx = x + s * 0.1;
      const by = y + s * 0.15;
      const bh = s * 0.7;
      for (let i = 0; i < gaps.length; i += 1) {
        const bw = unit * gaps[i];
        if (i % 2 === 0) ctx.fillRect(bx, by, Math.max(1, bw), bh);
        bx += bw;
      }
      break;
    }
    default:
      ctx.strokeRect(x, y, s, s);
  }
}

/** Circular QC passed badge (mockup footer). */
export function drawQcPassedBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1.5, radius * 0.18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.32, cy + radius * 0.02);
  ctx.lineTo(cx - radius * 0.08, cy + radius * 0.28);
  ctx.lineTo(cx + radius * 0.36, cy - radius * 0.28);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
}
