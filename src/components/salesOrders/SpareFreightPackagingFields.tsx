import React, { useMemo } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { DecimalTextInput } from '../DecimalAmountInput';
import { formatCurrency } from '../../lib/catalog';
import type { SpareFreightPackaging } from '../../lib/spareFreightQuote';
import { sparePackagingIsComplete } from '../../lib/spareFreightQuote';
import { ceilChargeableKg } from '../../lib/stCourierQuote';
import type { SpareBoxDefinition } from '../../types/spare-box-definitions';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';

export type SpareFreightPartnerQuoteNote = {
  partnerId: LogisticsPartnerId;
  label: string;
  amountInr: number;
  volumetricKg?: number | null;
  chargeableKg?: number | null;
  enabled: boolean;
};

export type SpareFreightPackagingDraft = {
  id: string;
  boxDefinitionId: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
};

function newDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `spare-box-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptySpareFreightPackagingDraft(): SpareFreightPackagingDraft {
  return {
    id: newDraftId(),
    boxDefinitionId: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    weightKg: '',
  };
}

/** @deprecated Use createEmptySpareFreightPackagingDraft / draft list. */
export const EMPTY_SPARE_FREIGHT_PACKAGING_DRAFT: SpareFreightPackagingDraft = createEmptySpareFreightPackagingDraft();

export const EMPTY_SPARE_FREIGHT_PACKAGING_DRAFTS: SpareFreightPackagingDraft[] = [
  createEmptySpareFreightPackagingDraft(),
];

function positiveNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function packagingFromDraft(draft: SpareFreightPackagingDraft): SpareFreightPackaging {
  return {
    lengthCm: positiveNumber(draft.lengthCm),
    widthCm: positiveNumber(draft.widthCm),
    heightCm: positiveNumber(draft.heightCm),
    weightKg: positiveNumber(draft.weightKg),
    boxDefinitionId: draft.boxDefinitionId.trim() || null,
  };
}

/** Parse one draft into a complete packaging payload, or null. */
export function spareFreightPackagingFromDraft(
  draft: SpareFreightPackagingDraft,
): SpareFreightPackaging | null {
  const packaging = packagingFromDraft(draft);
  return sparePackagingIsComplete(packaging) ? packaging : null;
}

/**
 * All boxes complete → packaging list for quote.
 * Incomplete / empty → null (staff must finish every box).
 */
export function spareFreightPackagingsFromDrafts(
  drafts: SpareFreightPackagingDraft[],
): SpareFreightPackaging[] | null {
  if (!drafts.length) return null;
  const boxes = drafts.map(packagingFromDraft);
  if (!boxes.every(sparePackagingIsComplete)) return null;
  return boxes;
}

type Props = {
  drafts: SpareFreightPackagingDraft[];
  onChange: (next: SpareFreightPackagingDraft[]) => void;
  definitions: SpareBoxDefinition[];
  disabled?: boolean;
  /** Divisor for on-card volumetric preview (partner-specific when known). */
  volumetricDivisor?: number;
  /** Per-partner freight notes under packaging (from cart estimate). */
  partnerQuotes?: SpareFreightPartnerQuoteNote[];
};

function formatKg(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function boxWeightPreview(
  draft: SpareFreightPackagingDraft,
  volumetricDivisor: number,
): { volumetricKg: number; chargeableKg: number; actualKg: number } | null {
  const lengthCm = positiveNumber(draft.lengthCm);
  const widthCm = positiveNumber(draft.widthCm);
  const heightCm = positiveNumber(draft.heightCm);
  if (!(lengthCm > 0 && widthCm > 0 && heightCm > 0)) return null;
  const divisor = volumetricDivisor > 0 ? volumetricDivisor : 5000;
  const volumetricKg = (lengthCm * widthCm * heightCm) / divisor;
  const actualKg = positiveNumber(draft.weightKg);
  const chargeableKg = ceilChargeableKg(Math.max(actualKg, volumetricKg));
  return { volumetricKg, chargeableKg, actualKg };
}

/**
 * Staff spare freight: one or more boxes — saved dia presets or custom L×B×H + weight.
 */
export const SpareFreightPackagingFields: React.FC<Props> = ({
  drafts,
  onChange,
  definitions,
  disabled = false,
  volumetricDivisor = 5000,
  partnerQuotes = [],
}) => {
  const complete = useMemo(
    () => Boolean(spareFreightPackagingsFromDrafts(drafts)),
    [drafts],
  );

  const totalsPreview = useMemo(() => {
    let volumetricKg = 0;
    let chargeableKg = 0;
    let ready = 0;
    for (const draft of drafts) {
      const preview = boxWeightPreview(draft, volumetricDivisor);
      if (!preview) continue;
      ready += 1;
      volumetricKg += preview.volumetricKg;
      chargeableKg += preview.chargeableKg;
    }
    if (!ready) return null;
    return { volumetricKg, chargeableKg, ready, boxCount: drafts.length };
  }, [drafts, volumetricDivisor]);

  const updateDraft = (id: string, patch: Partial<SpareFreightPackagingDraft>) => {
    onChange(drafts.map(row => (row.id === id ? { ...row, ...patch } : row)));
  };

  const applyDefinition = (id: string, definitionId: string) => {
    if (!definitionId) {
      updateDraft(id, { boxDefinitionId: '' });
      return;
    }
    const def = definitions.find(row => row.id === definitionId);
    if (!def) return;
    updateDraft(id, {
      boxDefinitionId: def.id,
      lengthCm: String(def.lengthCm),
      widthCm: String(def.breadthCm),
      heightCm: String(def.heightCm),
    });
  };

  const setField = (
    id: string,
    key: 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg',
    value: string,
  ) => {
    const patch: Partial<SpareFreightPackagingDraft> = { [key]: value };
    if (key === 'lengthCm' || key === 'widthCm' || key === 'heightCm') {
      patch.boxDefinitionId = '';
    }
    updateDraft(id, patch);
  };

  const addBox = () => {
    onChange([...drafts, createEmptySpareFreightPackagingDraft()]);
  };

  const removeBox = (id: string) => {
    if (drafts.length <= 1) return;
    onChange(drafts.filter(row => row.id !== id));
  };

  return (
    <section
      className={`spare-freight-packaging${complete ? '' : ' is-incomplete'}`}
      aria-label="Spare packaging for freight"
    >
      <header className="spare-freight-packaging__head">
        <Package size={15} aria-hidden />
        <div>
          <strong>Spare packaging</strong>
          <p>Pick saved box dia(s) or enter custom L×B×H. Weight is optional — volumetric kg is used when blank. Add more boxes if the SO ships in multiple cartons.</p>
        </div>
      </header>

      {definitions.length > 0 ? (
        <div className="spare-freight-packaging__saved" aria-label="Saved spare boxes">
          <span className="spare-freight-packaging__saved-label">Saved boxes</span>
          <ul className="spare-freight-packaging__saved-list">
            {definitions.map(def => (
              <li key={def.id}>
                <button
                  type="button"
                  className="spare-freight-packaging__saved-chip"
                  disabled={disabled}
                  title={`Use ${def.name} on an open box, or add another box`}
                  onClick={() => {
                    const incomplete = drafts.find(row => !spareFreightPackagingFromDraft(row));
                    if (incomplete) {
                      applyDefinition(incomplete.id, def.id);
                      return;
                    }
                    const next = createEmptySpareFreightPackagingDraft();
                    onChange([
                      ...drafts,
                      {
                        ...next,
                        boxDefinitionId: def.id,
                        lengthCm: String(def.lengthCm),
                        widthCm: String(def.breadthCm),
                        heightCm: String(def.heightCm),
                      },
                    ]);
                  }}
                >
                  <strong>{def.name}</strong>
                  <em>
                    {def.lengthCm}
                    ×
                    {def.breadthCm}
                    ×
                    {def.heightCm}
                    {' '}
                    cm
                  </em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="spare-freight-packaging__empty-defs" role="status">
          No spare boxes saved yet. Add them under Settings → Logistics → Spare box dia, or enter custom L×B×H below.
        </p>
      )}

      <ul className="spare-freight-packaging__boxes">
        {drafts.map((draft, index) => {
          const boxComplete = Boolean(spareFreightPackagingFromDraft(draft));
          return (
            <li
              key={draft.id}
              className={`spare-freight-packaging__box${boxComplete ? '' : ' is-incomplete'}`}
            >
              <div className="spare-freight-packaging__box-head">
                <strong>
                  Box
                  {' '}
                  {index + 1}
                </strong>
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    className="spare-freight-packaging__box-remove"
                    disabled={disabled}
                    aria-label={`Remove box ${index + 1}`}
                    onClick={() => removeBox(draft.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                ) : null}
              </div>

              <label className="spare-freight-packaging__preset">
                <span>Spare box</span>
                <select
                  value={draft.boxDefinitionId}
                  disabled={disabled}
                  aria-label={`Spare box preset for box ${index + 1}`}
                  onChange={e => applyDefinition(draft.id, e.target.value)}
                >
                  <option value="">Custom L×B×H</option>
                  {definitions.map(def => (
                    <option key={def.id} value={def.id}>
                      {def.name}
                      {' '}
                      (
                      {def.lengthCm}
                      ×
                      {def.breadthCm}
                      ×
                      {def.heightCm}
                      {' '}
                      cm)
                    </option>
                  ))}
                </select>
              </label>

              <div className="spare-freight-packaging__dims">
                {([
                  ['Length (L)', 'lengthCm'],
                  ['Breadth (W)', 'widthCm'],
                  ['Height (H)', 'heightCm'],
                ] as Array<[string, 'lengthCm' | 'widthCm' | 'heightCm']>).map(([label, key]) => (
                  <label key={key} className="spare-freight-packaging__cell">
                    <span>{label}</span>
                    <span className="spare-freight-packaging__value">
                      <DecimalTextInput
                        value={draft[key]}
                        onChange={next => setField(draft.id, key, next)}
                        decimals={1}
                        placeholder="—"
                        disabled={disabled}
                        aria-label={`Box ${index + 1} ${label} (required)`}
                      />
                      <em>cm</em>
                    </span>
                  </label>
                ))}
                <label className="spare-freight-packaging__cell">
                  <span>Weight (optional)</span>
                  <span className="spare-freight-packaging__value">
                    <DecimalTextInput
                      value={draft.weightKg}
                      onChange={next => setField(draft.id, 'weightKg', next)}
                      decimals={3}
                      placeholder="vol"
                      disabled={disabled}
                      aria-label={`Box ${index + 1} weight kg (optional, volumetric used if blank)`}
                    />
                    <em>kg</em>
                  </span>
                </label>
              </div>
              {(() => {
                const preview = boxWeightPreview(draft, volumetricDivisor);
                if (!preview) return null;
                return (
                  <p className="spare-freight-packaging__box-note" role="status">
                    Vol
                    {' '}
                    {formatKg(preview.volumetricKg)}
                    {' '}
                    kg
                    {' '}
                    (÷
                    {volumetricDivisor}
                    )
                    {' · '}
                    Chg
                    {' '}
                    {formatKg(preview.chargeableKg)}
                    {' '}
                    kg
                    {preview.actualKg > 0
                      ? ` · Act ${formatKg(preview.actualKg)} kg`
                      : ' · actual blank → volumetric'}
                  </p>
                );
              })()}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="spare-freight-packaging__add"
        disabled={disabled}
        onClick={addBox}
      >
        <Plus size={15} aria-hidden />
        Add another box
      </button>

      {totalsPreview ? (
        <p className="spare-freight-packaging__totals" role="status">
          All boxes · Vol
          {' '}
          {formatKg(totalsPreview.volumetricKg)}
          {' '}
          kg · Chg
          {' '}
          {formatKg(totalsPreview.chargeableKg)}
          {' '}
          kg
        </p>
      ) : null}

      {partnerQuotes.length > 0 && complete ? (
        <ul className="spare-freight-packaging__partner-notes" aria-label="Partner freight quotes">
          {partnerQuotes.map(quote => (
            <li
              key={quote.partnerId}
              className={quote.enabled ? undefined : 'is-disabled'}
            >
              <strong>{quote.label}</strong>
              <span>
                {[
                  quote.volumetricKg != null && quote.volumetricKg > 0
                    ? `Vol ${formatKg(quote.volumetricKg)} kg`
                    : null,
                  quote.chargeableKg != null && quote.chargeableKg > 0
                    ? `Chg ${formatKg(quote.chargeableKg)} kg`
                    : null,
                  quote.enabled && quote.amountInr > 0
                    ? formatCurrency(quote.amountInr)
                    : (quote.enabled ? '₹0' : '—'),
                ].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!complete ? (
        <p className="spare-freight-packaging__hint" role="status">
          Enter L×B×H for every box to auto-calculate spare freight (volumetric kg when weight is blank).
        </p>
      ) : (
        <p className="spare-freight-packaging__hint is-ok" role="status">
          {drafts.length}
          {' '}
          box
          {drafts.length === 1 ? '' : 'es'}
          {' '}
          ready for freight calc
          {drafts.some(row => !(positiveNumber(row.weightKg) > 0))
            ? ' · volumetric weight in use where actual kg is blank'
            : ''}
          .
        </p>
      )}
    </section>
  );
};
