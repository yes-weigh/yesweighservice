/** TE210 native density. */
export const LABEL_DPI = 203;

/** Clear margin from physical edge (mm). */
export const LABEL_PAD_MM = 2;

export function mmToDots(mm: number, dpi = LABEL_DPI): number {
  return Math.round((mm * dpi) / 25.4);
}
