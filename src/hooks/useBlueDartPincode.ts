import { useEffect, useState } from 'react';
import { loadBlueDartPincode } from '../lib/blueDartPincodes';
import type { BlueDartPincodeDoc } from '../types/blue-dart-rates';

/** Load Blue Dart pin serviceability for a shipping zip (cached). */
export function useBlueDartPincode(zip: string | null | undefined): BlueDartPincodeDoc | null {
  const [pin, setPin] = useState<BlueDartPincodeDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPin(null);
    void loadBlueDartPincode(zip).then((doc) => {
      if (!cancelled) setPin(doc);
    });
    return () => { cancelled = true; };
  }, [zip]);

  return pin;
}
