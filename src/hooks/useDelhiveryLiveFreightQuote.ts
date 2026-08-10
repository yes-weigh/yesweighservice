import { useEffect, useMemo, useRef, useState } from 'react';
import {
  estimateOffersDelhivery,
  mergeDelhiveryLiveQuoteIntoEstimate,
  delhiveryDimensionsFromEstimate,
  selectedPartnerIsDelhivery,
} from '../lib/delhiveryCartFreight';
import {
  pinFromText,
  quoteDelhiveryLane,
  type DelhiveryLaneQuote,
} from '../lib/delhiveryQuote';
import type { StCourierCartFreightEstimate } from '../lib/stCourierCartFreight';

type Input = {
  estimate: StCourierCartFreightEstimate | null;
  originAddress?: string | null;
  originPin?: string | null;
  destinationPin?: string | null;
  invoiceValueInr?: number | null;
  freightBillingMode?: 'fod' | 'btc' | null;
  /** When false, skip API (e.g. freight not allowed on this SO). */
  enabled?: boolean;
};

export type DelhiveryLiveFreightQuoteState = {
  loading: boolean;
  error: string;
  quote: DelhiveryLaneQuote | null;
  /** Pre-tax ₹ from live BTC estimate (invoiced when BTC selected). */
  preTaxInr: number | null;
  /** Pre-tax ₹ from live FOD estimate (display only; never invoiced). */
  fodPreTaxInr: number | null;
  /** Rate-card estimate with Delhivery option/site totals overlaid. */
  estimateWithLive: StCourierCartFreightEstimate | null;
  originPin: string;
  destinationPin: string;
  showStrip: boolean;
};

function preTaxFromQuote(quote: DelhiveryLaneQuote | null): number | null {
  const raw = quote?.estimate.preTaxInr ?? quote?.estimate.totalInr ?? null;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/**
 * Live Delhivery lane quotes for cart freight UIs (New SO / dealer / testing).
 * Fetches BTC (invoiced) and FOD (display-only) estimates in parallel.
 */
export function useDelhiveryLiveFreightQuote(input: Input): DelhiveryLiveFreightQuoteState {
  const enabled = input.enabled !== false && estimateOffersDelhivery(input.estimate);
  const destinationPin = String(input.destinationPin || '').replace(/\D/g, '');
  const originPin = (
    String(input.originPin || '').replace(/\D/g, '')
    || pinFromText(input.originAddress)
  ).replace(/\D/g, '');
  const weightKg = input.estimate?.totalChargeableKg || 0;
  const weightG = weightKg > 0 ? Math.max(1, Math.round(weightKg * 1000)) : 5000;
  const dimensions = useMemo(
    () => delhiveryDimensionsFromEstimate(input.estimate),
    [input.estimate],
  );
  const dimensionsKey = JSON.stringify(dimensions);
  const invAmount = Number(input.invoiceValueInr);
  const freightBillingMode = input.freightBillingMode === 'fod' ? 'fod' : 'btc';

  const [quote, setQuote] = useState<DelhiveryLaneQuote | null>(null);
  const [fodQuote, setFodQuote] = useState<DelhiveryLaneQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestKeyRef = useRef('');

  useEffect(() => {
    if (!enabled || destinationPin.length !== 6) {
      setQuote(null);
      setFodQuote(null);
      setError('');
      setLoading(false);
      requestKeyRef.current = '';
      return;
    }
    const inv = Math.round(Number.isFinite(invAmount) && invAmount > 0 ? invAmount : 1000);
    const key = [destinationPin, originPin, weightG, inv, dimensionsKey].join('|');

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (requestKeyRef.current === key) return;
      setLoading(true);
      setError('');
      const base = {
        originPin: originPin.length === 6 ? originPin : null,
        destinationPin,
        weightG,
        invAmount: inv,
        dimensions: dimensions.length ? dimensions : undefined,
        includeEstimate: originPin.length === 6,
      } as const;

      void Promise.all([
        quoteDelhiveryLane({ ...base, freightBillingMode: 'btc' }),
        quoteDelhiveryLane({ ...base, freightBillingMode: 'fod' }),
      ])
        .then(([btc, fod]) => {
          if (cancelled) return;
          requestKeyRef.current = key;
          setQuote(btc);
          setFodQuote(fod);
        })
        .catch((err) => {
          if (cancelled) return;
          requestKeyRef.current = '';
          setQuote(null);
          setFodQuote(null);
          setError(err instanceof Error ? err.message : 'Could not load Delhivery quote.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    destinationPin,
    originPin,
    weightG,
    invAmount,
    dimensionsKey,
  ]);

  const preTaxInr = useMemo(() => preTaxFromQuote(quote), [quote]);
  const fodPreTaxInr = useMemo(() => preTaxFromQuote(fodQuote), [fodQuote]);

  const estimateWithLive = useMemo(() => {
    if (!input.estimate) return null;
    if (!enabled) return input.estimate;
    return mergeDelhiveryLiveQuoteIntoEstimate(input.estimate, preTaxInr, {
      loading,
      error: error
        || quote?.estimate.error
        || quote?.serviceability.error
        || fodQuote?.estimate.error
        || null,
      notServiceable: quote?.serviceability.ok === true && quote.serviceability.serviceable === false,
      freightBillingMode,
      fodPreTaxInr,
    });
  }, [
    input.estimate,
    enabled,
    preTaxInr,
    fodPreTaxInr,
    loading,
    error,
    quote,
    fodQuote,
    freightBillingMode,
  ]);

  return {
    loading,
    error,
    quote,
    preTaxInr,
    fodPreTaxInr,
    estimateWithLive,
    originPin,
    destinationPin,
    showStrip: enabled && (
      selectedPartnerIsDelhivery(estimateWithLive)
      || selectedPartnerIsDelhivery(input.estimate)
      || Boolean(destinationPin.length === 6)
    ) && destinationPin.length === 6,
  };
}
