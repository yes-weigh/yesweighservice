import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { useAuth } from '../../context/AuthContext';
import {
  emptySparePricingSettings,
  fetchUsdToInrRate,
  loadSparePricingSettings,
  saveSparePricingSettings,
  SPARE_PRICING_LIVE_SAVE_MS,
  sparePricingSettingsEqual,
} from '../../lib/sparePricing';
import type { CatalogProduct } from '../../types/catalog';
import type { SparePricingSettings } from '../../types/sparePricing';

type Props = {
  spares: CatalogProduct[];
};

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function compareSpareRows(a: CatalogProduct, b: CatalogProduct): number {
  const skuA = (a.sku ?? '').trim();
  const skuB = (b.sku ?? '').trim();
  const skuCmp = skuA.localeCompare(skuB, undefined, { sensitivity: 'base', numeric: true });
  if (skuCmp !== 0) return skuCmp;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function formatFetchedMeta(settings: SparePricingSettings): string | null {
  if (!settings.exchangeRateFetchedAt && !settings.exchangeRateDate) return null;
  const parts: string[] = [];
  if (settings.exchangeRateDate) parts.push(`market ${settings.exchangeRateDate}`);
  if (settings.exchangeRateFetchedAt) {
    try {
      parts.push(
        `fetched ${new Date(settings.exchangeRateFetchedAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`,
      );
    } catch {
      // ignore bad timestamp
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

export const SparePricingView: React.FC<Props> = ({ spares }) => {
  const { user } = useAuth();
  const userUid = user?.uid ?? null;

  const rows = useMemo(
    () => [...spares].sort(compareSpareRows),
    [spares],
  );

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SparePricingSettings>(() => emptySparePricingSettings());
  const [saved, setSaved] = useState<SparePricingSettings>(() => emptySparePricingSettings());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fetchingRate, setFetchingRate] = useState(false);

  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveEpochRef = useRef(0);

  draftRef.current = draft;
  savedRef.current = saved;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadSparePricingSettings()
      .then(settings => {
        if (cancelled) return;
        setDraft(settings);
        setSaved(settings);
        setSaveStatus('idle');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load spare pricing settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const queueLiveSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('pending');
    saveTimerRef.current = setTimeout(() => {
      const current = draftRef.current;
      const previous = savedRef.current;
      if (sparePricingSettingsEqual(current, previous)) {
        setSaveStatus(prev => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      const epoch = ++saveEpochRef.current;
      setSaveStatus('saving');
      setError(null);
      void saveSparePricingSettings(current, userUid)
        .then(next => {
          setSaved(next);
          setDraft(prev => (
            sparePricingSettingsEqual(prev, next)
              ? { ...prev, updatedAt: next.updatedAt, updatedByUid: next.updatedByUid }
              : prev
          ));
          if (epoch === saveEpochRef.current) setSaveStatus('saved');
        })
        .catch(err => {
          if (epoch !== saveEpochRef.current) return;
          setSaveStatus('error');
          setError(err instanceof Error ? err.message : 'Could not save spare pricing settings.');
        });
    }, SPARE_PRICING_LIVE_SAVE_MS);
  }, [userUid]);

  const patchDraft = useCallback((
    patch: Partial<Pick<SparePricingSettings, 'usdToInrRate' | 'cdPercent' | 'exchangeRateFetchedAt' | 'exchangeRateDate'>>,
  ) => {
    setDraft(prev => ({ ...prev, ...patch }));
    queueLiveSave();
  }, [queueLiveSave]);

  const handleFetchRate = useCallback(async () => {
    setFetchingRate(true);
    setError(null);
    try {
      const result = await fetchUsdToInrRate();
      setDraft(prev => ({
        ...prev,
        usdToInrRate: result.rate,
        exchangeRateFetchedAt: result.fetchedAt,
        exchangeRateDate: result.date,
      }));
      queueLiveSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch exchange rate.');
    } finally {
      setFetchingRate(false);
    }
  }, [queueLiveSave]);

  const saveLabel = saveStatus === 'saving' || saveStatus === 'pending'
    ? 'Saving…'
    : saveStatus === 'saved'
      ? 'Saved'
      : saveStatus === 'error'
        ? 'Save failed'
        : 'Changes save automatically';

  const fetchedMeta = formatFetchedMeta(draft);

  return (
    <section className="panel glass panel--table spare-pricing">
      <div className="panel-header flex items-center justify-between flex-wrap gap-3 spare-pricing__header">
        <div>
          <h2>Spare pricing</h2>
          <p className="text-muted text-sm">
            {rows.length} spare{rows.length === 1 ? '' : 's'} · uncategorised and generic spare parts
          </p>
        </div>
        <span
          className={`spare-pricing__save-status${
            saveStatus === 'saved' ? ' is-saved' : ''
          }${saveStatus === 'error' ? ' is-error' : ''}${
            saveStatus === 'pending' || saveStatus === 'saving' ? ' is-busy' : ''
          }`}
          role="status"
          aria-live="polite"
        >
          {saveStatus === 'saved' ? <Check size={14} aria-hidden /> : null}
          {(saveStatus === 'saving' || saveStatus === 'pending')
            ? <Loader2 size={14} className="spin-icon" aria-hidden />
            : null}
          {saveLabel}
        </span>
      </div>

      {error ? <p className="spare-pricing__error" role="alert">{error}</p> : null}

      <div className="spare-pricing__settings">
        {loading ? (
          <div className="spare-pricing__loading">
            <Loader2 className="spin-icon" size={18} aria-hidden />
            <span className="text-muted">Loading settings…</span>
          </div>
        ) : (
          <div className="form-grid-2 spare-pricing__fields">
            <div className="form-group form-group--flush">
              <label htmlFor="spare-pricing-usd-inr">Exchange rate (USD → INR)</label>
              <div className="spare-pricing__rate-row">
                <DecimalAmountInput
                  id="spare-pricing-usd-inr"
                  className="spare-pricing__input"
                  value={draft.usdToInrRate}
                  onChange={next => patchDraft({ usdToInrRate: next ?? 0 })}
                  min={0}
                  decimals={4}
                  aria-label="Exchange rate USD to INR"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm spare-pricing__fetch-btn"
                  onClick={() => void handleFetchRate()}
                  disabled={fetchingRate}
                >
                  {fetchingRate
                    ? <Loader2 size={14} className="spin-icon" aria-hidden />
                    : <RefreshCw size={14} aria-hidden />}
                  {fetchingRate ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {fetchedMeta ? (
                <p className="text-muted text-sm spare-pricing__hint">{fetchedMeta}</p>
              ) : (
                <p className="text-muted text-sm spare-pricing__hint">
                  Fetch pulls the latest USD→INR rate automatically.
                </p>
              )}
            </div>

            <div className="form-group form-group--flush">
              <label htmlFor="spare-pricing-cd">CD (%)</label>
              <div className="spare-pricing__rate-row">
                <DecimalAmountInput
                  id="spare-pricing-cd"
                  className="spare-pricing__input"
                  value={draft.cdPercent}
                  onChange={next => patchDraft({ cdPercent: next ?? 0 })}
                  min={0}
                  max={1000}
                  decimals={2}
                  aria-label="CD percentage"
                />
                <span className="spare-pricing__suffix" aria-hidden>%</span>
              </div>
              <p className="text-muted text-sm spare-pricing__hint">
                Customs duty as a percentage.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="table-scroll-wrap">
        {rows.length === 0 ? (
          <p className="text-muted text-center p-4">No spare parts found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(product => (
                <tr key={product.id}>
                  <td>{product.sku?.trim() || '—'}</td>
                  <td>{product.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
