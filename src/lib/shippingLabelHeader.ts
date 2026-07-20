import { inkBounds, loadImage } from './labelLayouts/canvasUtils';

/** Brand lockup: mark + firm name (fills remaining width). */
export function shippingLabelHeaderHtml(firmName: string): string {
  return `
    <header class="sheet__header">
      <div class="sheet__brand-lockup">
        <img class="sheet__mark" src="/yesweigh-mark.png" alt="" />
        <strong class="sheet__firm">${escapeAttr(firmName)}</strong>
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
    gap: 2mm;
    padding: 0;
    margin: 0;
    border-bottom: none;
    min-height: 9mm;
  }
  .sheet__brand-lockup {
    display: flex;
    align-items: center;
    gap: 2mm;
    min-width: 0;
    flex: 1 1 auto;
    width: 100%;
  }
  .sheet__mark {
    height: 7mm;
    width: auto;
    display: block;
    flex-shrink: 0;
    object-fit: contain;
  }
  .sheet__firm {
    flex: 1 1 auto;
    min-width: 0;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 5.2mm;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

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

function fitFirmFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxPx: number,
  minPx: number,
): number {
  let size = maxPx;
  while (size > minPx) {
    ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return minPx;
}

/**
 * Draw shipping-label header. Returns y below the header band.
 * Layout: [yesweigh-mark] [Interweighing Pvt Ltd — fills width]
 */
export async function drawShippingLabelHeader(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    width: number;
    firmName: string;
    dpiScale?: number;
  },
): Promise<number> {
  const { x, y, width, firmName } = opts;
  const s = opts.dpiScale ?? 1;
  const logoH = Math.round(56 * s);
  const headerH = Math.round(62 * s);
  const midY = y + headerH / 2;
  const gap = Math.round(12 * s);

  let cursorX = x;
  const logo = await loadImage('/yesweigh-mark.png');
  if (logo && logo.width > 0 && logo.height > 0) {
    const crop = inkBounds(logo);
    const logoW = (crop.sw / crop.sh) * logoH;
    ctx.drawImage(
      logo,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      cursorX,
      midY - logoH / 2,
      logoW,
      logoH,
    );
    cursorX += logoW + gap;
  }

  const firmMaxW = Math.max(24, x + width - cursorX);
  const firmPx = fitFirmFont(
    ctx,
    firmName,
    firmMaxW,
    Math.round(42 * s),
    Math.round(18 * s),
  );
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${firmPx}px Arial, Helvetica, sans-serif`;
  ctx.fillText(firmName, cursorX, midY);

  return y + headerH + Math.round(8 * s);
}
