/**
 * Code 39 barcode encoder (ISO/IEC 16388).
 * Returns alternating bar/space module widths starting with a bar.
 * Includes start/stop `*`. Wide:narrow = 3:1 for scanner readability.
 */

/** 12-module patterns (1 = bar, 0 = space). Same map as JsBarcode CODE39. */
const CODE39_BITS: Record<string, string> = {
  0: '101001101101',
  1: '110100101011',
  2: '101100101011',
  3: '110110010101',
  4: '101001101011',
  5: '110100110101',
  6: '101100110101',
  7: '101001011011',
  8: '110100101101',
  9: '101100101101',
  A: '110101001011',
  B: '101101001011',
  C: '110110100101',
  D: '101011001011',
  E: '110101100101',
  F: '101101100101',
  G: '101010011011',
  H: '110101001101',
  I: '101101001101',
  J: '101011001101',
  K: '110101010011',
  L: '101101010011',
  M: '110110101001',
  N: '101011010011',
  O: '110101101001',
  P: '101101101001',
  Q: '101010110011',
  R: '110101011001',
  S: '101101011001',
  T: '101011011001',
  U: '110010101011',
  V: '100110101011',
  W: '110011010101',
  X: '100101101011',
  Y: '110010110101',
  Z: '100110110101',
  '-': '100101011011',
  '.': '110010101101',
  ' ': '100110101101',
  $: '100100100101',
  '/': '100100101001',
  '+': '100101001001',
  '%': '101001001001',
  '*': '100101101101',
};

const WIDE = 3;

function runsFromBits(bits: string): number[] {
  const runs: number[] = [];
  let prev = bits[0]!;
  let count = 0;
  for (const ch of bits) {
    if (ch === prev) {
      count += 1;
      continue;
    }
    runs.push(count === 1 ? 1 : WIDE);
    prev = ch;
    count = 1;
  }
  runs.push(count === 1 ? 1 : WIDE);
  return runs;
}

/**
 * Encode text as Code 39. Non-encodable characters are skipped.
 * Output starts with a bar and includes start/stop asterisks.
 */
export function encodeCode39(text: string): number[] {
  const raw = String(text ?? '').toUpperCase();
  const chars: string[] = ['*'];
  for (const ch of raw) {
    if (ch === '*') continue;
    if (CODE39_BITS[ch]) chars.push(ch);
  }
  if (chars.length === 1) chars.push('0');
  chars.push('*');

  const runs: number[] = [];
  chars.forEach((ch, index) => {
    if (index > 0) runs.push(1);
    runs.push(...runsFromBits(CODE39_BITS[ch]!));
  });
  return runs;
}

export function code39ModuleCount(runs: number[]): number {
  return runs.reduce((sum, w) => sum + w, 0);
}
