import { PDFDocument, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import { pdfjs } from './pdfjsSetup';

type PdfCropBox = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

/**
 * Find ink bounds on PDF pages (trim Delhivery’s empty page margins)
 * so we can stretch the slip itself to the A4 half edges / cut line.
 */
async function detectPageContentBoxes(
  pdfBytes: Uint8Array,
  pageIndexes: number[],
): Promise<Map<number, PdfCropBox>> {
  const boxes = new Map<number, PdfCropBox>();
  if (typeof document === 'undefined' || !pageIndexes.length) return boxes;

  const pdf = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
  try {
    for (const pageIndex of pageIndexes) {
      const page = await pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = 1.25;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const threshold = 248;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        const row = y * width * 4;
        for (let x = 0; x < width; x += 1) {
          const i = row + x * 4;
          const a = data[i + 3] ?? 0;
          if (a < 8) continue;
          const r = data[i] ?? 255;
          const g = data[i + 1] ?? 255;
          const b = data[i + 2] ?? 255;
          if (r < threshold || g < threshold || b < threshold) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX || maxY < minY) continue;

      // Canvas origin is top-left; PDF crop box origin is bottom-left.
      const pad = 2;
      const left = Math.max(0, minX / scale - pad);
      const right = Math.min(base.width, (maxX + 1) / scale + pad);
      const top = Math.min(base.height, base.height - minY / scale + pad);
      const bottom = Math.max(0, base.height - (maxY + 1) / scale - pad);
      if (right > left && top > bottom) {
        boxes.set(pageIndex, { left, right, bottom, top });
      }
    }
  } finally {
    try {
      pdf.cleanup();
    } catch {
      // ignore
    }
  }
  return boxes;
}

/**
 * Delhivery LR copy PDFs are typically 3 pages (cover + two slip faces).
 * Drop page 1, crop pages 2 + 3 to ink, and stretch each to fill half an A4
 * (top / bottom), edge-to-edge against the cut line.
 */
export async function composeDelhiveryBookingSlipPdf(
  source: Uint8Array,
): Promise<Uint8Array> {
  const srcBytes = source.slice();
  const src = await PDFDocument.load(srcBytes);
  const pageCount = src.getPageCount();
  if (pageCount < 2) return srcBytes;

  const out = await PDFDocument.create();
  const [a4W, a4H] = PageSizes.A4;
  const page = out.addPage([a4W, a4H]);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const halfH = a4H / 2;

  const sourceIndexes = pageCount >= 3 ? [1, 2] : [1];
  const crops = await detectPageContentBoxes(srcBytes, sourceIndexes);

  const drawFullHalf = async (sourcePageIndex: number, y: number) => {
    if (sourcePageIndex < 0 || sourcePageIndex >= pageCount) return;
    const crop = crops.get(sourcePageIndex);
    const sourcePage = src.getPage(sourcePageIndex);
    const embedded = crop
      ? await out.embedPage(sourcePage, crop)
      : await out.embedPage(sourcePage);
    page.drawPage(embedded, {
      x: 0,
      y,
      width: a4W,
      height: halfH,
    });
  };

  // Skip index 0; page 2 (index 1) top half, page 3 (index 2) bottom half.
  await drawFullHalf(1, halfH);
  if (pageCount >= 3) {
    await drawFullHalf(2, 0);
  }

  const midY = halfH;
  const cutInk = rgb(0.25, 0.25, 0.25);
  const dashPad = 32;
  page.drawLine({
    start: { x: 0, y: midY },
    end: { x: a4W / 2 - dashPad, y: midY },
    thickness: 1,
    color: cutInk,
    dashArray: [3, 3],
  });
  page.drawLine({
    start: { x: a4W / 2 + dashPad, y: midY },
    end: { x: a4W, y: midY },
    thickness: 1,
    color: cutInk,
    dashArray: [3, 3],
  });

  const cutLabel = '>8  CUT  8<';
  const cutSize = 8;
  const cutWidth = font.widthOfTextAtSize(cutLabel, cutSize);
  page.drawRectangle({
    x: (a4W - cutWidth) / 2 - 4,
    y: midY - cutSize / 2 - 2,
    width: cutWidth + 8,
    height: cutSize + 4,
    color: rgb(1, 1, 1),
  });
  page.drawText(cutLabel, {
    x: (a4W - cutWidth) / 2,
    y: midY - cutSize / 3,
    size: cutSize,
    font,
    color: cutInk,
  });

  const saved = await out.save();
  return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
}
