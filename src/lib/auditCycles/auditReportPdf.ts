import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { auditCycleSiteLabel, type AuditCycleSite } from '../../types/audit-cycle';

export type AuditReportPdfRow = {
  sku: string;
  name: string;
  site: AuditCycleSite;
  zohoAtAudit: number;
  auditedQty: number;
  auditedAt: string | null;
  auditDiff: number;
  rate: number;
  diffValue: number;
  counted: boolean;
};

export type AuditReportPdfInput = {
  mode: 'loss' | 'confirmed';
  siteFilterLabel: string;
  search: string;
  showSiteColumn: boolean;
  rows: AuditReportPdfRow[];
  summary: {
    skuCount: number;
    unitsOrQty: number;
    unitsOrQtyLabel: string;
    value: number;
    valueLabel: string;
  };
};

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 28;
const INK = rgb(0.08, 0.1, 0.14);
const MUTE = rgb(0.4, 0.45, 0.52);
const LINE = rgb(0.82, 0.84, 0.88);
const UNDER = rgb(0.72, 0.2, 0.2);
const HEADER_BG = rgb(0.95, 0.96, 0.98);

/** Helvetica/WinAnsi-safe currency (₹ is not encodable). */
function formatPdfCurrency(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Strip / replace glyphs Helvetica cannot encode. */
function winAnsiSafe(text: string): string {
  return text
    .replace(/\u20B9/g, 'Rs.') // ₹
    .replace(/[\u2013\u2014\u2212]/g, '-') // en/em/minus dashes
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function formatSignedQty(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (value > 0) return `+${value.toLocaleString('en-IN')}`;
  return value.toLocaleString('en-IN');
}

function formatAuditDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function truncate(font: Awaited<ReturnType<PDFDocument['embedFont']>>, text: string, size: number, maxWidth: number): string {
  const safe = winAnsiSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function auditReportPdfFileName(input: Pick<AuditReportPdfInput, 'mode'>): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `audit-${input.mode}-report-${stamp}.pdf`;
}

export async function buildAuditReportPdfBlob(input: AuditReportPdfInput): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = input.mode === 'loss' ? 'Audit shortage report' : 'Audit confirmed stock report';
  const valueColLabel = input.mode === 'loss' ? 'Diff × price' : 'Stock value';
  const generatedAt = new Date().toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const cols = input.showSiteColumn
    ? [
        { key: 'rank', label: '#', width: 28, align: 'right' as const },
        { key: 'site', label: 'Site', width: 72, align: 'left' as const },
        { key: 'sku', label: 'SKU', width: 78, align: 'left' as const },
        { key: 'name', label: 'Item', width: 210, align: 'left' as const },
        { key: 'zoho', label: 'Zoho', width: 52, align: 'right' as const },
        { key: 'audited', label: 'Audited', width: 52, align: 'right' as const },
        { key: 'date', label: 'Date', width: 70, align: 'left' as const },
        { key: 'diff', label: 'Diff', width: 48, align: 'right' as const },
        { key: 'value', label: valueColLabel, width: 78, align: 'right' as const },
      ]
    : [
        { key: 'rank', label: '#', width: 28, align: 'right' as const },
        { key: 'sku', label: 'SKU', width: 90, align: 'left' as const },
        { key: 'name', label: 'Item', width: 250, align: 'left' as const },
        { key: 'zoho', label: 'Zoho', width: 55, align: 'right' as const },
        { key: 'audited', label: 'Audited', width: 55, align: 'right' as const },
        { key: 'date', label: 'Date', width: 72, align: 'left' as const },
        { key: 'diff', label: 'Diff', width: 52, align: 'right' as const },
        { key: 'value', label: valueColLabel, width: 84, align: 'right' as const },
      ];

  const tableWidth = cols.reduce((sum, col) => sum + col.width, 0);
  const tableLeft = MARGIN + Math.max(0, (PAGE_W - MARGIN * 2 - tableWidth) / 2);
  const rowH = 14;
  const headerH = 16;
  const bottomLimit = MARGIN + 24;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawHeader = () => {
    page.drawText(title, {
      x: MARGIN,
      y: y - 14,
      size: 14,
      font: fontBold,
      color: INK,
    });
    y -= 18;
    const meta = [
      `Site: ${input.siteFilterLabel}`,
      input.search.trim() ? `Search: ${input.search.trim()}` : null,
      `Generated: ${generatedAt}`,
      `${input.rows.length.toLocaleString('en-IN')} line items`,
    ].filter(Boolean).join('  |  ');
    page.drawText(truncate(font, meta, 8, PAGE_W - MARGIN * 2), {
      x: MARGIN,
      y: y - 10,
      size: 8,
      font,
      color: MUTE,
    });
    y -= 18;

    page.drawText(
      winAnsiSafe(
        `${input.summary.skuCount.toLocaleString('en-IN')} SKUs  |  ${input.summary.unitsOrQtyLabel}: ${input.summary.unitsOrQty.toLocaleString('en-IN')}  |  ${input.summary.valueLabel}: ${formatPdfCurrency(input.summary.value)}`,
      ),
      {
        x: MARGIN,
        y: y - 10,
        size: 9,
        font: fontBold,
        color: INK,
      },
    );
    y -= 20;
  };

  const drawTableHeader = () => {
    page.drawRectangle({
      x: tableLeft,
      y: y - headerH,
      width: tableWidth,
      height: headerH,
      color: HEADER_BG,
    });
    let x = tableLeft;
    for (const col of cols) {
      const label = truncate(fontBold, col.label, 7.5, col.width - 6);
      const textW = fontBold.widthOfTextAtSize(label, 7.5);
      const textX = col.align === 'right'
        ? x + col.width - 4 - textW
        : x + 4;
      page.drawText(label, {
        x: textX,
        y: y - 11,
        size: 7.5,
        font: fontBold,
        color: MUTE,
      });
      x += col.width;
    }
    page.drawLine({
      start: { x: tableLeft, y: y - headerH },
      end: { x: tableLeft + tableWidth, y: y - headerH },
      thickness: 0.6,
      color: LINE,
    });
    y -= headerH;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed >= bottomLimit) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    drawHeader();
    drawTableHeader();
  };

  drawHeader();
  drawTableHeader();

  if (input.rows.length === 0) {
    ensureSpace(24);
    page.drawText('No line items in the current filtered view.', {
      x: tableLeft + 4,
      y: y - 12,
      size: 9,
      font,
      color: MUTE,
    });
  } else {
    input.rows.forEach((row, index) => {
      ensureSpace(rowH + 2);
      const cells: Record<string, string> = {
        rank: String(index + 1),
        site: auditCycleSiteLabel(row.site),
        sku: row.sku || '-',
        name: row.name || '-',
        zoho: row.zohoAtAudit.toLocaleString('en-IN'),
        audited: row.auditedQty.toLocaleString('en-IN'),
        date: formatAuditDate(row.auditedAt),
        diff: formatSignedQty(row.auditDiff),
        value: formatPdfCurrency(
          input.mode === 'loss' ? row.diffValue : row.auditedQty * row.rate,
        ),
      };

      if (index % 2 === 1) {
        page.drawRectangle({
          x: tableLeft,
          y: y - rowH,
          width: tableWidth,
          height: rowH,
          color: rgb(0.98, 0.985, 0.99),
        });
      }

      let x = tableLeft;
      for (const col of cols) {
        const raw = cells[col.key] ?? '';
        const text = truncate(font, raw, 7.5, col.width - 6);
        const textW = font.widthOfTextAtSize(text, 7.5);
        const textX = col.align === 'right'
          ? x + col.width - 4 - textW
          : x + 4;
        const color = col.key === 'diff' && row.auditDiff < 0
          ? UNDER
          : col.key === 'value' && input.mode === 'loss'
            ? UNDER
            : INK;
        page.drawText(text, {
          x: textX,
          y: y - 10,
          size: 7.5,
          font,
          color,
        });
        x += col.width;
      }

      page.drawLine({
        start: { x: tableLeft, y: y - rowH },
        end: { x: tableLeft + tableWidth, y: y - rowH },
        thickness: 0.35,
        color: LINE,
      });
      y -= rowH;
    });
  }

  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const p = doc.getPage(i);
    const label = `Page ${i + 1} of ${pageCount}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, {
      x: PAGE_W - MARGIN - w,
      y: 14,
      size: 8,
      font,
      color: MUTE,
    });
    p.drawText('YesOne Platform | Audit report', {
      x: MARGIN,
      y: 14,
      size: 8,
      font,
      color: MUTE,
    });
  }

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer-backed view so BlobPart accepts it under strict DOM typings.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

export async function downloadAuditReportPdf(input: AuditReportPdfInput): Promise<void> {
  const blob = await buildAuditReportPdfBlob(input);
  downloadBlob(blob, auditReportPdfFileName(input));
}
