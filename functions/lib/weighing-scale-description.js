/**
 * Weighing-scale SO/invoice line description notes.
 * Appended after the existing product description / Stamping range note.
 */
import { getFirestore } from 'firebase-admin/firestore';

export const WEIGHING_SCALE_DISMANTLED_NOTE = 'Supplied in Dismantled Condition';
export const WEIGHING_SCALE_GATC_CERTIFIED_NOTE = 'Verified, Stamped & Certified by GATC';

/** Exact Zoho category names used for one-time default seeding. */
export const DEFAULT_WEIGHING_SCALE_CATEGORY_NAMES = [
  'WEIGHING SCALE IMPORT',
  'BILL PRINTING SCALES',
  'WEIGHING SCALES INDIA',
  'ANALYTICAL SCALES',
  'INDUSTRIAL WEIGHING SCALE',
];

const CATEGORIES_COLLECTION = 'catalogCategories';

/** @returns {Promise<Set<string>>} */
export async function loadWeighingScaleCategoryIdSet() {
  const snap = await getFirestore()
    .collection(CATEGORIES_COLLECTION)
    .where('isWeighingScale', '==', true)
    .get();
  return new Set(snap.docs.map(doc => doc.id));
}

/**
 * @param {string|null|undefined} description
 * @param {{ isWeighingScale?: boolean, hasStamping?: boolean }} opts
 * @returns {string|null}
 */
export function appendWeighingScaleDescription(description, {
  isWeighingScale = false,
  hasStamping = false,
} = {}) {
  if (!isWeighingScale) {
    return description != null ? String(description) : null;
  }
  const note = hasStamping
    ? WEIGHING_SCALE_GATC_CERTIFIED_NOTE
    : WEIGHING_SCALE_DISMANTLED_NOTE;
  const base = description != null ? String(description).trim() : '';
  if (!base) return note;
  if (base.includes(note)) return base;
  return `${base}\n${note}`;
}
