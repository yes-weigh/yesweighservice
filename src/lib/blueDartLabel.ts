import { PDFDocument } from 'pdf-lib';
import {
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../constants/localPrinterSettings';
import { LABEL_DPI, mmToDots } from './labelLayouts/units';
import { pdfjs } from './pdfjsSetup';

/** Official A4S shrink-to-fit on logistics thermal stock. */
export const BLUE_DART_LABEL_WIDTH_MM = LOGISTICS_LABEL_WIDTH_MM;
export const BLUE_DART_LABEL_HEIGHT_MM = LOGISTICS_LABEL_HEIGHT_MM;

const PT_PER_MM = 72 / 25.4;

function labelPagePoints(): { width: number; height: number } {
  return {
    width: BLUE_DART_LABEL_WIDTH_MM * PT_PER_MM,
    height: BLUE_DART_LABEL_HEIGHT_MM * PT_PER_MM,
  };
}

/** Uniform scale of Blue Dart A4S onto 100×150 mm. No crop or redraw. */
export async function fitBlueDartWaybillToLabelPdf(
  pdfBytes: Uint8Array,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes);
  const srcPage = src.getPage(0);
  const { width, height } = srcPage.getSize();
  const label = labelPagePoints();
  if (Math.abs(width - label.width) < 2 && Math.abs(height - label.height) < 2) {
    return pdfBytes;
  }
  const scale = Math.min(label.width / width, label.height / height);
  const dw = width * scale;
  const dh = height * scale;
  const out = await PDFDocument.create();
  const embedded = await out.embedPage(srcPage);
  const page = out.addPage([label.width, label.height]);
  page.drawPage(embedded, {
    x: (label.width - dw) / 2,
    y: (label.height - dh) / 2,
    width: dw,
    height: dh,
  });
  return out.save();
}

/** 203 DPI PNG of the 100×150 mm fitted waybill (for thermal print). */
export async function renderBlueDartWaybillLabelPng(
  pdfBytes: Uint8Array,
): Promise<Blob> {
  const fitted = await fitBlueDartWaybillToLabelPdf(pdfBytes);
  const pdf = await pdfjs.getDocument({ data: fitted.slice() }).promise;
  try {
    const page = await pdf.getPage(1);
    const width = mmToDots(BLUE_DART_LABEL_WIDTH_MM, LABEL_DPI);
    const height = mmToDots(BLUE_DART_LABEL_HEIGHT_MM, LABEL_DPI);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(width / base.width, height / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render Blue Dart label.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate((width - viewport.width) / 2, (height - viewport.height) / 2);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    ctx.restore();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        next => (next ? resolve(next) : reject(new Error('Could not encode label PNG.'))),
        'image/png',
      );
    });
    return blob;
  } finally {
    try {
      pdf.cleanup();
    } catch {
      // ignore
    }
  }
}
