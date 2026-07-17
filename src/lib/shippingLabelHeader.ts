/** Shared shipping-label header markup/styles (matches thermal reference). */

/** Outline shield + check — stroke, not filled. */
export const SHIPPING_HEADER_SHIELD_SVG = `
<svg class="sheet__badge-icon" viewBox="0 0 24 28" width="24" height="28" aria-hidden="true">
  <path fill="none" stroke="#111" stroke-width="1.7" stroke-linejoin="round"
    d="M12 1.6 21.2 5.2v8.2c0 5.6-3.7 10.4-9.2 12.2C6.5 23.8 2.8 19 2.8 13.4V5.2L12 1.6z"/>
  <path fill="none" stroke="#111" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"
    d="M7.4 14.2 10.6 17.3 16.8 10.4"/>
</svg>`.trim();

/** HTML Y1 block — avoid SVG &lt;text&gt; (renders garbled in some browsers). */
export function shippingLabelY1Html(): string {
  return `<div class="sheet__y1" aria-label="YES ONE"><span class="sheet__y1-mark">Y1</span><span class="sheet__y1-sub">YES ONE</span></div>`;
}

export function shippingLabelHeaderHtml(firmName: string): string {
  return `
    <header class="sheet__header">
      ${shippingLabelY1Html()}
      <div class="sheet__brand">
        <strong>YESWEIGH</strong>
        <span class="sheet__firm"><em>—</em> ${escapeAttr(firmName)} <em>—</em></span>
      </div>
      <div class="sheet__badge">
        ${SHIPPING_HEADER_SHIELD_SVG}
        <span class="sheet__badge-text"><b>GENUINE</b><b>SPARE PART</b></span>
      </div>
    </header>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** CSS for the shipping header (preview + print). */
export const SHIPPING_LABEL_HEADER_STYLES = `
  .sheet__header {
    display: flex;
    align-items: center;
    gap: 2.4mm;
    padding: 0;
    margin: 0;
    border-bottom: none;
    min-height: 11mm;
  }
  .sheet__y1 {
    flex: 0 0 auto;
    width: 9.4mm;
    height: 9.4mm;
    background: #111;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35mm;
    line-height: 1;
  }
  .sheet__y1-mark {
    font-family: Arial Black, Arial, Helvetica, sans-serif;
    font-size: 4.4mm;
    font-weight: 900;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .sheet__y1-sub {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 1.35mm;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }
  .sheet__brand {
    flex: 0 1 auto;
    text-align: left;
    line-height: 1.05;
    min-width: 0;
  }
  .sheet__brand strong {
    display: block;
    font-family: Arial Black, Arial, Helvetica, sans-serif;
    font-size: 5.6mm;
    font-weight: 900;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  .sheet__firm {
    display: block;
    margin-top: 0.8mm;
    font-size: 2.2mm;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .sheet__firm em {
    font-style: normal;
    font-weight: 400;
    padding: 0 0.55mm;
  }
  .sheet__badge {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 1.2mm;
    flex: 0 0 auto;
  }
  .sheet__badge-icon {
    width: 5.2mm;
    height: 6.1mm;
    display: block;
    flex-shrink: 0;
  }
  .sheet__badge-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.2mm;
    line-height: 1.05;
  }
  .sheet__badge-text b {
    font-size: 2.1mm;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

export function drawY1Mark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(size * 0.44)}px Arial Black, Arial, Helvetica, sans-serif`;
  ctx.fillText('Y1', x + size / 2, y + size * 0.38);
  ctx.font = `700 ${Math.round(size * 0.14)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('YES ONE', x + size / 2, y + size * 0.74);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Outline shield + check (reference style). */
export function drawOutlineShieldCheck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
): void {
  const w = h * 0.82;
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.fillStyle = 'transparent';
  ctx.lineWidth = Math.max(1.4, h * 0.07);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h * 0.14);
  ctx.lineTo(x + w, y + h * 0.52);
  ctx.quadraticCurveTo(x + w * 0.72, y + h * 0.88, x + w / 2, y + h);
  ctx.quadraticCurveTo(x + w * 0.28, y + h * 0.88, x, y + h * 0.52);
  ctx.lineTo(x, y + h * 0.14);
  ctx.closePath();
  ctx.stroke();

  ctx.lineWidth = Math.max(1.8, h * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.26, y + h * 0.5);
  ctx.lineTo(x + w * 0.44, y + h * 0.66);
  ctx.lineTo(x + w * 0.74, y + h * 0.36);
  ctx.stroke();
  ctx.restore();
}

export function drawRoundedRectStroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  lineW: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Draw the shipping-label header band. Returns y just below the divider.
 * Layout: [Y1][YESWEIGH / firm] …… [shield + GENUINE / SPARE PART]
 */
export function drawShippingLabelHeader(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    width: number;
    firmName: string;
    dpiScale?: number;
  },
): number {
  const { x, y, width, firmName } = opts;
  const s = opts.dpiScale ?? 1;
  const mark = Math.round(75 * s);
  const gap = Math.round(19 * s);
  const headerH = mark;
  const midY = y + headerH / 2;

  drawY1Mark(ctx, x, y, mark);

  const brandX = x + mark + gap;
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const titlePx = Math.round(44 * s);
  ctx.font = `900 ${titlePx}px Arial Black, Arial, Helvetica, sans-serif`;
  const title = 'YESWEIGH';
  const titleW = ctx.measureText(title).width;
  const firmPx = Math.round(17 * s);
  const brandBlockH = titlePx + Math.round(6 * s) + firmPx;
  const brandTop = midY - brandBlockH / 2 + titlePx * 0.78;
  ctx.fillText(title, brandX, brandTop);

  ctx.font = `500 ${firmPx}px Arial, Helvetica, sans-serif`;
  const firm = `— ${firmName} —`;
  const firmW = ctx.measureText(firm).width;
  const firmX = brandX + Math.max(0, (titleW - firmW) / 2);
  ctx.fillText(firm, firmX, brandTop + Math.round(6 * s) + firmPx);

  const shieldH = Math.round(48 * s);
  const badgeTextPx = Math.round(16 * s);
  ctx.font = `800 ${badgeTextPx}px Arial, Helvetica, sans-serif`;
  const line1 = 'GENUINE';
  const line2 = 'SPARE PART';
  const textW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
  const shieldGap = Math.round(8 * s);
  const badgeW = shieldH * 0.82 + shieldGap + textW;
  const badgeX = x + width - badgeW;
  drawOutlineShieldCheck(ctx, badgeX, midY - shieldH / 2, shieldH);

  const textX = badgeX + shieldH * 0.82 + shieldGap;
  const textBlockH = badgeTextPx * 2 + Math.round(3 * s);
  let ty = midY - textBlockH / 2 + badgeTextPx * 0.85;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111';
  ctx.font = `800 ${badgeTextPx}px Arial, Helvetica, sans-serif`;
  ctx.fillText(line1, textX, ty);
  ty += badgeTextPx + Math.round(3 * s);
  ctx.fillText(line2, textX, ty);

  // Parties section owns the horizontal divider under the header.
  return y + headerH + Math.round(10 * s);
}
