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
  /** Pre-tax ₹ from live estimate, or null. */
  preTaxInr: number | null;
  /** Rate-card estimate with Delhivery option/site totals overlaid. */
  estimateWithLive: StCourierCartFreightEstimate | null;
  originPin: string;
  destinationPin: string;
  showStrip: boolean;
};

/**
 * Live Delhivery lane quote for cart freight UIs (New SO / dealer / testing).
 * Debounced; merges into the rate-card estimate so Preferred Delhivery shows ₹.
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestKeyRef = useRef('');

  useEffect(() => {
    if (!enabled || destinationPin.length !== 6) {
      setQuote(null);
      setError('');
      setLoading(false);
      requestKeyRef.current = '';
      return;
    }
    const key = [
      destinationPin,
      originPin,
      weightG,
      freightBillingMode,
      Math.round(Number.isFinite(invAmount) && invAmount > 0 ? invAmount : 1000),
      dimensionsKey,
    ].join('|');

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (requestKeyRef.current === key) return;
      setLoading(true);
      setError('');
      void quoteDelhiveryLane({
        originPin: originPin.length === 6 ? originPin : null,
        destinationPin,
        weightG,
        invAmount: Number.isFinite(invAmount) && invAmount > 0 ? invAmount : 1000,
        dimensions: dimensions.length ? dimensions : undefined,
        freightBillingMode,
        includeEstimate: originPin.length === 6,
      })
        .then((next) => {
          if (cancelled) return;
          requestKeyRef.current = key;
          setQuote(next);
        })
        .catch((err) => {
          if (cancelled) return;
          requestKeyRef.current = '';
          setQuote(null);
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
    freightBillingMode,
    invAmount,
    dimensionsKey,
  ]);

  const preTaxInr = useMemo(() => {
    const raw = quote?.estimate.preTaxInr ?? quote?.estimate.totalInr ?? null;
    if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }, [quote]);

  const estimateWithLive = useMemo(() => {
    if (!input.estimate) return null;
    if (!enabled) return input.estimate;
    return mergeDelhiveryLiveQuoteIntoEstimate(input.estimate, preTaxInr, {
      loading,
      error: error || quote?.estimate.error || quote?.serviceability.error || null,
      notServiceable: quote?.serviceability.ok === true && quote.serviceability.serviceable === false,
      freightBillingMode,
    });
  }, [input.estimate, enabled, preTaxInr, loading, error, quote, freightBillingMode]);

  return {
    loading,
    error,
    quote,
    preTaxInr,
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
