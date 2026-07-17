/**
 * Code 128 barcode encoder (ISO/IEC 15417).
 * Returns alternating bar/space module widths starting with a bar.
 */

/** Patterns for values 0–105; STOP (106) is separate (7 widths). */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213',
  '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231',
  '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123',
  '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121',
  '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111',
  '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114',
  '413111', '241113', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121',
  '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214',
  '211232',
];

const STOP_PATTERN = '2331112';
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;

function runsFromPattern(pattern: string): number[] {
  return [...pattern].map(ch => Number(ch));
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Count consecutive digits starting at `index`. */
function digitRunLength(text: string, index: number): number {
  let n = 0;
  while (index + n < text.length && isDigit(text[index + n]!)) n += 1;
  return n;
}

/**
 * Encode text as Code 128 with automatic B/C subset switching.
 * Unsupported characters (outside ASCII 32–126) are skipped.
 */
export function encodeCode128(text: string): number[] {
  const raw = text.trim();
  const chars: string[] = [];
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) chars.push(ch);
  }
  if (!chars.length) chars.push('0');

  const values: number[] = [];
  let index = 0;
  const joined = chars.join('');
  const leadingDigits = digitRunLength(joined, 0);
  // Prefer Start C when a long even-length digit prefix suits it.
  let inC = leadingDigits >= 4 && leadingDigits % 2 === 0;
  values.push(inC ? START_C : START_B);

  while (index < chars.length) {
    if (inC) {
      if (index + 1 < chars.length && isDigit(chars[index]!) && isDigit(chars[index + 1]!)) {
        values.push(Number(chars[index]! + chars[index + 1]!));
        index += 2;
        continue;
      }
      values.push(CODE_B);
      inC = false;
      continue;
    }

    const digitsAhead = digitRunLength(joined, index);
    if (digitsAhead >= 4 && digitsAhead % 2 === 0) {
      values.push(CODE_C);
      inC = true;
      continue;
    }

    values.push(chars[index]!.charCodeAt(0) - 32);
    index += 1;
  }

  let checksum = values[0]!;
  for (let i = 1; i < values.length; i += 1) {
    checksum += values[i]! * i;
  }
  values.push(checksum % 103);

  const runs: number[] = [];
  for (const value of values) {
    const pattern = PATTERNS[value];
    if (!pattern) throw new Error(`Invalid Code 128 value: ${value}`);
    runs.push(...runsFromPattern(pattern));
  }
  runs.push(...runsFromPattern(STOP_PATTERN));
  return runs;
}

/** Total module count for a Code 128 run list. */
export function code128ModuleCount(runs: number[]): number {
  return runs.reduce((sum, w) => sum + w, 0);
}
