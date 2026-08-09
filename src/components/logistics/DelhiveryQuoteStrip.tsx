import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, IndianRupee, Loader2, MapPin } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import {
  pinFromText,
  quoteDelhiveryLane,
  type DelhiveryLaneQuote,
  type DelhiveryQuoteDimension,
} from '../../lib/delhiveryQuote';

type Props = {
  originPin?: string | null;
  destinationPin?: string | null;
  /** Free-text addresses — pin extracted when destinationPin omitted. */
  originAddress?: string | null;
  destinationAddress?: string | null;
  weightKg?: number | null;
  invAmount?: number | null;
  dimensions?: DelhiveryQuoteDimension[];
  freightBillingMode?: 'fod' | 'btc' | null;
  /** Skip freight estimate (serviceability + TAT only). */
  includeEstimate?: boolean;
  compact?: boolean;
  className?: string;
  /** Called when a usable excl-GST estimate is available. */
  onEstimate?: (preTaxInr: number, quote: DelhiveryLaneQuote) => void;
};

function weightToGrams(weightKg: number | null | undefined): number {
  const kg = Number(weightKg);
  if (!Number.isFinite(kg) || kg <= 0) return 1000;
  return Math.max(1, Math.round(kg * 1000));
}

export const DelhiveryQuoteStrip: React.FC<Props> = ({
  originPin,
  destinationPin,
  originAddress,
  destinationAddress,
  weightKg,
  invAmount,
  dimensions,
  freightBillingMode = 'btc',
  includeEstimate = true,
  compact = false,
  className = '',
  onEstimate,
}) => {
  const [quote, setQuote] = useState<DelhiveryLaneQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onEstimateRef = useRef(onEstimate);
  onEstimateRef.current = onEstimate;
  const lastEstimateKey = useRef('');

  const dest = (destinationPin || pinFromText(destinationAddress)).replace(/\D/g, '');
  const origin = (originPin || pinFromText(originAddress)).replace(/\D/g, '');
  const weightG = weightToGrams(weightKg);

  useEffect(() => {
    if (dest.length !== 6) {
      setQuote(null);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void quoteDelhiveryLane({
        originPin: origin.length === 6 ? origin : null,
        destinationPin: dest,
        weightG,
        invAmount: invAmount ?? 1000,
        dimensions,
        freightBillingMode,
        includeEstimate: includeEstimate && origin.length === 6,
      })
        .then((next) => {
          if (cancelled) return;
          setQuote(next);
          const preTax = next.estimate.preTaxInr ?? next.estimate.totalInr;
          if (next.estimate.ok && preTax != null && Number.isFinite(preTax) && preTax > 0) {
            const key = `${dest}:${origin}:${weightG}:${freightBillingMode}:${Math.round(preTax)}`;
            if (lastEstimateKey.current !== key) {
              lastEstimateKey.current = key;
              onEstimateRef.current?.(preTax, next);
            }
          }
        })
        .catch((err) => {
          if (cancelled) return;
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
    dest,
    origin,
    weightG,
    invAmount,
    freightBillingMode,
    includeEstimate,
    // dimensions identity — stringify for stable dep
    JSON.stringify(dimensions ?? null),
  ]);

  if (dest.length !== 6) return null;

  const svc = quote?.serviceability;
  const tat = quote?.tat;
  const est = quote?.estimate;
  const displayFreight = est?.preTaxInr ?? est?.totalInr ?? null;

  return (
    <div
      className={[
        'delhivery-quote-strip',
        compact ? 'delhivery-quote-strip--compact' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="delhivery-quote-strip__head">
        <strong>Delhivery lane</strong>
        {loading ? <Loader2 size={14} className="spin" aria-label="Loading" /> : null}
      </div>

      {error ? (
        <p className="delhivery-quote-strip__error">{error}</p>
      ) : null}

      <ul className="delhivery-quote-strip__rows">
        <li>
          <MapPin size={14} aria-hidden />
          <span>
            {loading && !svc
              ? 'Checking serviceability…'
              : svc?.serviceable
                ? (
                  <>
                    <CheckCircle2 size={13} className="delhivery-quote-strip__ok" aria-hidden />
                    {' '}
                    Serviceable
                    {svc.city || svc.state ? ` · ${[svc.city, svc.state].filter(Boolean).join(', ')}` : ''}
                    {svc.oda ? ' · ODA' : ''}
                    {svc.failOnDemand ? ' · fail-on-demand' : ''}
                  </>
                )
                : (
                  <>
                    <AlertTriangle size={13} className="delhivery-quote-strip__warn" aria-hidden />
                    {' '}
                    {svc?.error || 'Not serviceable'}
                  </>
                )}
          </span>
        </li>
        <li>
          <Clock3 size={14} aria-hidden />
          <span>
            {origin.length !== 6
              ? 'TAT needs ship-from pincode'
              : loading && !tat
                ? 'Estimating TAT…'
                : tat?.ok && tat.tatDays != null
                  ? `TAT ~${tat.tatDays} day${tat.tatDays === 1 ? '' : 's'}`
                  : (tat?.error || 'TAT unavailable')}
          </span>
        </li>
        {includeEstimate ? (
          <li>
            <IndianRupee size={14} aria-hidden />
            <span>
              {origin.length !== 6
                ? 'Freight estimate needs ship-from pincode'
                : loading && !est
                  ? 'Estimating freight…'
                  : est?.ok && displayFreight != null
                    ? (
                      <>
                        Est. freight {formatCurrency(displayFreight)}
                        {freightBillingMode === 'fod' ? ' · FOD' : ' · BTC'}
                        {est.chargedWeightKg != null
                          ? ` · charged ${est.chargedWeightKg} kg`
                          : ''}
                        <em className="delhivery-quote-strip__hint">excl. GST · live API</em>
                      </>
                    )
                    : (est?.error || 'Freight estimate unavailable')}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
};
