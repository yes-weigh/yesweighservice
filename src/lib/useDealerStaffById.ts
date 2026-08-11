import { useEffect, useState } from 'react';
import { ensureDealersCached, subscribeDealerCache } from './dealer-cache';
import { buildDealerStaffNameMap } from './dealerKamDisplay';

export function useDealerStaffById(enabled: boolean): Record<string, string> {
  const [dealerStaffById, setDealerStaffById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) {
      setDealerStaffById({});
      return;
    }

    let cancelled = false;

    const unsubscribe = subscribeDealerCache(list => {
      if (!cancelled) setDealerStaffById(buildDealerStaffNameMap(list));
    });

    void ensureDealersCached()
      .then(list => {
        if (!cancelled) setDealerStaffById(buildDealerStaffNameMap(list));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  return dealerStaffById;
}
