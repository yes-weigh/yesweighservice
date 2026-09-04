import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export type ProductSerialCursor = {
  lastSerial: string;
  nextSerial: string;
};

function suggestNextSerial(lastSerial: string): string {
  const match = /^(.*?)(\d+)$/.exec(lastSerial.trim());
  if (!match) return '';
  const raw = String(Number(match[2]) + 1);
  const width = Math.max(match[2].length, raw.length);
  return `${match[1]}${raw.padStart(width, '0')}`;
}

export function useProductSerialCursor(productId: string | null | undefined): ProductSerialCursor | null {
  const [cursor, setCursor] = useState<ProductSerialCursor | null>(null);

  useEffect(() => {
    const id = String(productId ?? '').trim();
    if (!id) {
      setCursor(null);
      return;
    }
    return onSnapshot(
      doc(db, 'productSerialCursors', id),
      snap => {
        const lastSerial = String(snap.data()?.lastSerial ?? '').trim();
        if (!lastSerial) {
          setCursor(null);
          return;
        }
        setCursor({
          lastSerial,
          nextSerial: suggestNextSerial(lastSerial),
        });
      },
      () => setCursor(null),
    );
  }, [productId]);

  return cursor;
}
