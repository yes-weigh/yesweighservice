import { useEffect, useState } from 'react';
import { loadRaisedPoQtyByItemId } from '../lib/raisedPoQty';

/** Open / raised PO qty by catalog product id — staff and Directors dealers. */
export function useRaisedPoQtyByProductId(enabled: boolean): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    if (!enabled) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    void loadRaisedPoQtyByItemId()
      .then(next => {
        if (!cancelled) setMap(next);
      })
      .catch(() => {
        if (!cancelled) setMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return map;
}
