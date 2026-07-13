import {
  formatItemLocationShort,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';

export type PossibleDuplicateBinGroup = {
  /** binId + quantity key */
  key: string;
  binId: string;
  rackId: string;
  rowNumber: YesStoreItemDoc['rowNumber'];
  binNumber: YesStoreItemDoc['binNumber'];
  quantity: number;
  locationLabel: string;
  items: YesStoreItemDoc[];
};

/**
 * Possible duplicates: 2+ stock records in the same bin with the same quantity.
 * Typical when Add item was used instead of Replace with the same count.
 */
export function findPossibleDuplicateBinGroups(
  items: YesStoreItemDoc[],
): PossibleDuplicateBinGroup[] {
  const byBinAndQty = new Map<string, YesStoreItemDoc[]>();

  for (const item of items) {
    const binId = item.binId?.trim() || `${item.rackId}_${item.rowNumber}_${item.binNumber}`;
    const quantity = readItemQuantity(item);
    const key = `${binId}::${quantity}`;
    const list = byBinAndQty.get(key) ?? [];
    list.push(item);
    byBinAndQty.set(key, list);
  }

  const groups: PossibleDuplicateBinGroup[] = [];
  for (const [key, groupItems] of byBinAndQty) {
    if (groupItems.length < 2) continue;
    const first = groupItems[0];
    const quantity = readItemQuantity(first);
    groups.push({
      key,
      binId: first.binId?.trim() || `${first.rackId}_${first.rowNumber}_${first.binNumber}`,
      rackId: first.rackId,
      rowNumber: first.rowNumber,
      binNumber: first.binNumber,
      quantity,
      locationLabel: formatItemLocationShort(first.rackId, first.rowNumber, first.binNumber),
      items: [...groupItems].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    });
  }

  return groups.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return a.locationLabel.localeCompare(b.locationLabel);
  });
}

export const YESSTORE_OPEN_DUPLICATES_KEY = 'yesstore.openPossibleDuplicates';
