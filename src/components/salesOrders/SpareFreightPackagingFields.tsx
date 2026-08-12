import React, { useMemo } from 'react';
import { Package } from 'lucide-react';
import { DecimalTextInput } from '../DecimalAmountInput';
import type { SpareFreightPackaging } from '../../lib/spareFreightQuote';
import { sparePackagingIsComplete } from '../../lib/spareFreightQuote';
import type { SpareBoxDefinition } from '../../types/spare-box-definitions';

export type SpareFreightPackagingDraft = {
  boxDefinitionId: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
};

export const EMPTY_SPARE_FREIGHT_PACKAGING_DRAFT: SpareFreightPackagingDraft = {
  boxDefinitionId: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  weightKg: '',
};

function positiveNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parse draft fields into a complete packaging payload, or null. */
export function spareFreightPackagingFromDraft(
  draft: SpareFreightPackagingDraft,
): SpareFreightPackaging | null {
  const packaging: SpareFreightPackaging = {
    lengthCm: positiveNumber(draft.lengthCm),
    widthCm: positiveNumber(draft.widthCm),
    heightCm: positiveNumber(draft.heightCm),
    weightKg: positiveNumber(draft.weightKg),
    boxDefinitionId: draft.boxDefinitionId.trim() || null,
  };
  return sparePackagingIsComplete(packaging) ? packaging : null;
}

type Props = {
  draft: SpareFreightPackagingDraft;
  onChange: (next: SpareFreightPackagingDraft) => void;
  definitions: SpareBoxDefinition[];
  disabled?: boolean;
};

/**
 * Staff spare freight: pick a Settings spare-box preset or enter custom L×B×H + weight.
 */
export const SpareFreightPackagingFields: React.FC<Props> = ({
  draft,
  onChange,
  definitions,
  disabled = false,
}) => {
  const complete = useMemo(
    () => Boolean(spareFreightPackagingFromDraft(draft)),
    [draft],
  );

  const applyDefinition = (definitionId: string) => {
    if (!definitionId) {
      onChange({ ...draft, boxDefinitionId: '' });
      return;
    }
    const def = definitions.find(row => row.id === definitionId);
    if (!def) return;
    onChange({
      ...draft,
      boxDefinitionId: def.id,
      lengthCm: String(def.lengthCm),
      widthCm: String(def.breadthCm),
      heightCm: String(def.heightCm),
    });
  };

  const setField = (key: keyof SpareFreightPackagingDraft, value: string) => {
    const next = { ...draft, [key]: value };
    if (key === 'lengthCm' || key === 'widthCm' || key === 'heightCm') {
      next.boxDefinitionId = '';
    }
    onChange(next);
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
          <p>Pick a box dia or enter custom L×B×H and weight to calculate freight.</p>
        </div>
      </header>

      {definitions.length > 0 ? (
        <label className="spare-freight-packaging__preset">
          <span>Spare box</span>
          <select
            value={draft.boxDefinitionId}
            disabled={disabled}
            aria-label="Spare box preset"
            onChange={e => applyDefinition(e.target.value)}
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
      ) : null}

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
                onChange={next => setField(key, next)}
                decimals={1}
                placeholder="—"
                disabled={disabled}
                aria-label={`${label} (required)`}
              />
              <em>cm</em>
            </span>
          </label>
        ))}
        <label className="spare-freight-packaging__cell">
          <span>Weight</span>
          <span className="spare-freight-packaging__value">
            <DecimalTextInput
              value={draft.weightKg}
              onChange={next => setField('weightKg', next)}
              decimals={3}
              placeholder="—"
              disabled={disabled}
              aria-label="Weight kg (required)"
            />
            <em>kg</em>
          </span>
        </label>
      </div>

      {!complete ? (
        <p className="spare-freight-packaging__hint" role="status">
          Enter all dimensions and weight to auto-calculate spare freight (no 1 kg base rate).
        </p>
      ) : null}
    </section>
  );
};
