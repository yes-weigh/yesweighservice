import * as XLSX from 'xlsx';

const MAX_ROWS = 250;
const MAX_COLS = 50;

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export type VendorPiExcelGrid = {
  sheetName: string;
  cells: string[][];
  merges: Array<{ r: number; c: number; rowspan: number; colspan: number }>;
  totalAmount: number | null;
  currencyCode: string | null;
  piDate: string | null;
};

export type VendorPiExcelMeta = {
  amount: number | null;
  currencyCode: string | null;
  piDate: string | null;
};

/** @deprecated use VendorPiExcelMeta */
export type VendorPiExcelTotal = {
  amount: number;
  currencyCode: string | null;
  piDate?: string | null;
};

function detectCurrency(text: string): string | null {
  const s = text.toUpperCase();
  if (s.includes('USD') || s.includes('US$') || s.includes('DOLLAR') || /(?:^|[^A-Z])\$(?!\s*\$)/.test(s)) {
    return 'USD';
  }
  if (s.includes('CNY') || s.includes('RMB') || s.includes('¥') || s.includes('￥')) return 'CNY';
  if (s.includes('EUR') || s.includes('€')) return 'EUR';
  if (s.includes('INR') || s.includes('₹')) return 'INR';
  return null;
}

function parseNumeric(value: unknown, textHint = ''): number | null {
  const hint = `${textHint} ${value == null ? '' : String(value)}`;
  if (/\b(cbm|m3|m³|kg|kgs?|ctn|cartons?|pcs?|pc)\b/i.test(hint) && !/\$|usd|dollar/i.test(hint)) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let s = raw.replace(/[^0-9.,\-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert "USD FIFTY FOUR THOUSAND ONLY" / "SAY US DOLLARS ..." into a number.
 * Requires thousand/million so line qty like "Total 450" is not used.
 */
export function parseUsdAmountInWords(text: string): number | null {
  const upper = String(text || '').toUpperCase();
  if (!/\b(THOUSAND|MILLION|BILLION)\b/.test(upper)) return null;

  const cleaned = upper
    .replace(/TOTAL\s*AMOUNT\s*:?/g, ' ')
    .replace(/SAY\s*(THE\s*)?(TOTAL\s*)?/g, ' ')
    .replace(/U\s*\.?\s*S\s*\.?\s*DOLLARS?/g, ' ')
    .replace(/\b(USD|US\$|DOLLARS?|ONLY|AND|CENTS?|POINT)\b/g, ' ')
    .replace(/[^A-Z\s-]/g, ' ')
    .replace(/-/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(token => (
    token.toLowerCase() in ONES
    || token.toLowerCase() in TENS
    || token === 'HUNDRED'
    || token === 'THOUSAND'
    || token === 'MILLION'
    || token === 'BILLION'
  ));
  if (!tokens.length) return null;

  let total = 0;
  let current = 0;
  let used = false;
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (key in ONES) {
      current += ONES[key];
      used = true;
      continue;
    }
    if (key in TENS) {
      current += TENS[key];
      used = true;
      continue;
    }
    if (key === 'hundred') {
      current = (current || 1) * 100;
      used = true;
      continue;
    }
    if (key === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
      used = true;
      continue;
    }
    if (key === 'million') {
      total += (current || 1) * 1_000_000;
      current = 0;
      used = true;
      continue;
    }
    if (key === 'billion') {
      total += (current || 1) * 1_000_000_000;
      current = 0;
      used = true;
      continue;
    }
  }
  total += current;
  if (!used || !Number.isFinite(total) || total < 1000) return null;
  return total;
}

function excelSerialToYmd(serial: number): string | null {
  const whole = Math.floor(serial);
  if (whole < 20000 || whole > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + whole * 86400000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (y < 2018 || y > 2040) return null;
  return `${y}-${m}-${d}`;
}

function parseLooseDate(value: unknown, text: string): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromSerial = excelSerialToYmd(value);
    if (fromSerial) return fromSerial;
  }
  const raw = String(text || value || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (year >= 2018 && year <= 2040 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    const y = date.getFullYear();
    if (y >= 2018 && y <= 2040) {
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return null;
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w.trim()) return cell.w.trim();
  if (cell.v == null) return '';
  return String(cell.v).trim();
}

function pickSheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  let best: { sheet: XLSX.WorkSheet; name: string; score: number } | null = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref'] as string);
    const score = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (!best || score > best.score) best = { sheet, name, score };
  }
  return best ? { sheet: best.sheet, name: best.name } : null;
}

function pickTotalFromWords(texts: string[][]): VendorPiExcelTotal | null {
  for (let r = texts.length - 1; r >= 0; r -= 1) {
    const row = (texts[r] || []).join(' ');
    const amount = parseUsdAmountInWords(row);
    if (amount != null) {
      return { amount, currencyCode: 'USD' };
    }
    for (const cell of texts[r] || []) {
      const fromCell = parseUsdAmountInWords(cell);
      if (fromCell != null) return { amount: fromCell, currencyCode: 'USD' };
    }
  }
  return null;
}

function pickNumericTotalAmount(
  values: Array<Array<unknown>>,
  texts: string[][],
): VendorPiExcelTotal | null {
  const rows = values.length;
  const cols = values.reduce((max, row) => Math.max(max, row.length), 0);
  let bestAmount: number | null = null;
  let bestScore = -1;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const label = texts[r]?.[c] ?? '';
      const rowText = (texts[r] || []).join(' ');
      const isAmountRow = /total\s*amount|grand\s*total|invoice\s*total|amount\s*(due|payable)|cif|fob/i.test(
        `${label} ${rowText}`,
      );
      const isBareTotal = /^\s*totals?\s*$/i.test(label);
      if (!isAmountRow && !isBareTotal) continue;

      const look = (raw: unknown, text: string) => {
        const amount = parseNumeric(raw ?? text, text);
        if (amount == null || amount < 1000) return;
        let score = isAmountRow ? 12 : 2;
        if (detectCurrency(text) || detectCurrency(rowText)) score += 4;
        if (isBareTotal && amount < 5000 && Number.isInteger(amount)) score -= 10;
        if (score > bestScore || (score === bestScore && bestAmount != null && amount > bestAmount)) {
          bestAmount = amount;
          bestScore = score;
        }
      };

      look(values[r]?.[c], label);
      for (let dc = 1; dc <= 8; dc += 1) {
        look(values[r]?.[c + dc], texts[r]?.[c + dc] ?? '');
      }
    }
  }
  if (bestAmount == null) return null;
  if (bestScore < 6 && bestAmount < 10000) return null;
  return { amount: bestAmount, currencyCode: 'USD' };
}

function pickFormattedUsdTotal(texts: string[][]): number | null {
  let best: number | null = null;
  for (const row of texts) {
    for (const cell of row) {
      if (/\b(cbm|m3|m³|kg)\b/i.test(cell)) continue;
      const matches = cell.match(/\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g) ?? [];
      for (const match of matches) {
        const amount = parseNumeric(match, cell);
        if (amount == null || amount < 1000) continue;
        if (best == null || amount > best) best = amount;
      }
    }
  }
  return best;
}

function pickPiDate(
  values: Array<Array<unknown>>,
  texts: string[][],
): string | null {
  const rows = Math.min(values.length, 40);
  const cols = values.reduce((max, row) => Math.max(max, row.length), 0);
  const labelRe = /\b(pi\s*date|proforma\s*date|invoice\s*date|date\s*of\s*(pi|invoice)|dated)\b|^\s*date\s*:?/i;

  const tryCells = (r: number, c: number): string | null => (
    parseLooseDate(values[r]?.[c], texts[r]?.[c] ?? '')
  );

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const label = texts[r]?.[c] ?? '';
      if (!labelRe.test(label)) continue;
      const leftover = parseLooseDate(null, label.replace(labelRe, '').replace(/^\s*date\s*:?\s*/i, '').trim());
      if (leftover) return leftover;
      for (let dc = 1; dc <= 6; dc += 1) {
        const next = tryCells(r, c + dc);
        if (next) return next;
      }
      if (r + 1 < rows) {
        const below = tryCells(r + 1, c);
        if (below) return below;
      }
    }
  }
  return null;
}

export function parseVendorPiExcel(data: Uint8Array): VendorPiExcelGrid {
  const workbook = XLSX.read(data, { type: 'array' });
  const picked = pickSheet(workbook);
  if (!picked?.sheet['!ref']) {
    return {
      sheetName: picked?.name || workbook.SheetNames[0] || 'Sheet1',
      cells: [],
      merges: [],
      totalAmount: null,
      currencyCode: null,
      piDate: null,
    };
  }
  const { sheet, name: sheetName } = picked;
  const sheetRef = sheet['!ref'] as string;
  const range = XLSX.utils.decode_range(sheetRef);
  const maxR = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
  const maxC = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
  const values: unknown[][] = [];
  const texts: string[][] = [];
  const cells: string[][] = [];

  for (let r = range.s.r; r <= maxR; r += 1) {
    const valueRow: unknown[] = [];
    const textRow: string[] = [];
    const displayRow: string[] = [];
    for (let c = range.s.c; c <= maxC; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const text = cellText(cell);
      valueRow.push(cell?.v ?? null);
      textRow.push(text);
      displayRow.push(text);
    }
    values.push(valueRow);
    texts.push(textRow);
    cells.push(displayRow);
  }

  while (cells.length && cells[cells.length - 1].every(cell => !cell)) cells.pop();
  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of cells) {
    while (row.length < width) row.push('');
  }

  const merges = (sheet['!merges'] ?? [])
    .map(merge => ({
      r: merge.s.r - range.s.r,
      c: merge.s.c - range.s.c,
      rowspan: merge.e.r - merge.s.r + 1,
      colspan: merge.e.c - merge.s.c + 1,
    }))
    .filter(merge => (
      merge.r >= 0
      && merge.c >= 0
      && merge.r < cells.length
      && merge.c < width
    ));

  for (const merge of merges) {
    const originText = texts[merge.r]?.[merge.c] ?? '';
    const originValue = values[merge.r]?.[merge.c];
    for (let rr = merge.r; rr < merge.r + merge.rowspan && rr < texts.length; rr += 1) {
      for (let cc = merge.c; cc < merge.c + merge.colspan; cc += 1) {
        if (rr === merge.r && cc === merge.c) continue;
        if (!texts[rr]?.[cc]) {
          if (texts[rr]) texts[rr][cc] = originText;
          if (values[rr]) values[rr][cc] = originValue ?? values[rr][cc];
        }
      }
    }
  }

  const fromWords = pickTotalFromWords(texts)
    || pickTotalFromWords([ [texts.flat().join(' ')] ]);
  const fromFormatted = pickFormattedUsdTotal(texts);
  const fromNumeric = pickNumericTotalAmount(values, texts);
  const total = fromWords
    || (fromFormatted != null ? { amount: fromFormatted, currencyCode: 'USD' as const } : null)
    || fromNumeric;
  const sheetText = texts.flat().join(' ');

  return {
    sheetName,
    cells,
    merges,
    totalAmount: total?.amount ?? null,
    currencyCode: total?.currencyCode || detectCurrency(sheetText) || 'USD',
    piDate: pickPiDate(values, texts),
  };
}

export async function parseVendorPiExcelFile(file: File): Promise<VendorPiExcelGrid> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseVendorPiExcel(bytes);
}
