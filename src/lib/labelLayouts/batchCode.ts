/**
 * Pack-date → batch code cipher for Genuine Spare product labels.
 *
 * Looks random to outsiders; staff decode as:
 *   B {YY} {monthLetter} {DD} {checkLetter}{checkDigits}
 *
 * Month letters (mnemonic: Quiet Workers Rarely Try Yellow Paint For Huge Jobs; Keep Looking Zoomed):
 *   Jan Q · Feb W · Mar R · Apr T · May Y · Jun P
 *   Jul F · Aug H · Sep J · Oct K · Nov L · Dec Z
 *
 * Example: 11 Jul 2026 → B26F11… (F = July, 11 = day)
 */

const MONTH_LETTERS = ['Q', 'W', 'R', 'T', 'Y', 'P', 'F', 'H', 'J', 'K', 'L', 'Z'] as const;

function checkParts(year: number, month: number, day: number): { letter: string; digits: string } {
  const yy = year % 100;
  const letter = String.fromCharCode(65 + ((day * 3 + month * 7 + yy * 5) % 26));
  const digits = String((day * 11 + month * 19 + yy * 3) % 100).padStart(2, '0');
  return { letter, digits };
}

/** Obfuscated batch from a pack date, e.g. B26F11A19. */
export function encodePackedDateBatch(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const yy = String(year % 100).padStart(2, '0');
  const mon = MONTH_LETTERS[month - 1] ?? 'X';
  const dd = String(day).padStart(2, '0');
  const { letter, digits } = checkParts(year, month, day);
  return `B${yy}${mon}${dd}${letter}${digits}`;
}

/** Decode a company batch back to a calendar date, or null if invalid. */
export function decodePackedDateBatch(batch: string): Date | null {
  const m = /^B(\d{2})([QWRTYPFHJKLZ])(\d{2})([A-Z])(\d{2})$/i.exec(batch.trim());
  if (!m) return null;
  const yy = Number(m[1]);
  const monLetter = m[2].toUpperCase();
  const day = Number(m[3]);
  const checkLetter = m[4].toUpperCase();
  const checkDigits = m[5];
  const month = MONTH_LETTERS.indexOf(monLetter as (typeof MONTH_LETTERS)[number]) + 1;
  if (month < 1 || day < 1 || day > 31) return null;
  const year = 2000 + yy;
  const expected = checkParts(year, month, day);
  if (expected.letter !== checkLetter || expected.digits !== checkDigits) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}
