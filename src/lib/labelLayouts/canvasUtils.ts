/** Shared canvas helpers for label layout rendering. */

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Tight crop around non-white ink so padded logo assets fill the header. */
export function inkBounds(img: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const cctx = c.getContext('2d', { willReadFrequently: true });
  if (!cctx) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  cctx.drawImage(img, 0, 0);
  const { data } = cctx.getImageData(0, 0, c.width, c.height);
  let minX = c.width;
  let minY = c.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 4;
      const a = data[i + 3];
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (a > 32 && lum < 240) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  const pad = 2;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(c.width - sx, maxX - minX + 1 + pad * 2);
  const sh = Math.min(c.height - sy, maxY - minY + 1 + pad * 2);
  return { sx, sy, sw, sh };
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  bold: boolean,
): number {
  for (let size = start; size >= min; size -= 1) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, Helvetica, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return min;
}

/** Wrap text at a fixed font (ctx.font must already be set). Last line ellipsizes if needed. */
export function wrapMultiline(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const trimmed = text.trim();
  if (!trimmed || maxLines < 1) return [''];

  const lines: string[] = [];
  let remaining = trimmed;

  const takeLine = (chunk: string, ellipsis: boolean): string => {
    if (!ellipsis || ctx.measureText(chunk).width <= maxWidth) return chunk;
    let line = chunk;
    while (line.length > 1 && ctx.measureText(`${line}…`).width > maxWidth) {
      line = line.slice(0, -1);
    }
    return `${line}…`;
  };

  while (remaining && lines.length < maxLines) {
    const isLast = lines.length === maxLines - 1;
    if (ctx.measureText(remaining).width <= maxWidth) {
      lines.push(remaining);
      break;
    }

    const spaceParts = remaining.split(/(\s+)/);
    let built = '';
    let consumed = 0;
    for (let i = 0; i < spaceParts.length; i += 1) {
      const next = built + spaceParts[i];
      const probe = isLast && i < spaceParts.length - 1 ? `${next.trimEnd()}…` : next;
      if (ctx.measureText(probe).width <= maxWidth) {
        built = next;
        consumed = i + 1;
      } else {
        break;
      }
    }

    if (consumed > 0 && built.trim()) {
      const line = built.trimEnd();
      remaining = spaceParts.slice(consumed).join('').trimStart();
      lines.push(isLast && remaining ? takeLine(line, true) : line);
      if (isLast) break;
      continue;
    }

    let cut = 1;
    for (let i = 1; i <= remaining.length; i += 1) {
      const slice = remaining.slice(0, i);
      const probe = isLast && i < remaining.length ? `${slice}…` : slice;
      if (ctx.measureText(probe).width <= maxWidth) cut = i;
      else break;
    }
    if (isLast && cut < remaining.length) {
      lines.push(takeLine(remaining.slice(0, cut), true));
      break;
    }
    lines.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  return lines.length ? lines : [''];
}
