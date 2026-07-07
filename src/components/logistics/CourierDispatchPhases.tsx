import React from 'react';
import { Check } from 'lucide-react';
import {
  COURIER_DISPATCH_PHASES,
  computeActivePhase,
  isPhaseComplete,
  phaseIndex,
} from '../../lib/logisticsDispatch';
import type { CourierDispatch } from '../../types/logistics-dispatch';

interface CourierDispatchPhasesProps {
  dispatch: CourierDispatch;
}

export const CourierDispatchPhases: React.FC<CourierDispatchPhasesProps> = ({ dispatch }) => {
  const activePhase = computeActivePhase(dispatch);
  const activeIndex = phaseIndex(activePhase);

  return (
    <section className="courier-phases panel glass" aria-label="Dispatch phases">
      <h3 className="courier-phases__title">Dispatch Progress</h3>
      <ol className="courier-phases__list">
        {COURIER_DISPATCH_PHASES.map((phase, index) => {
          const complete = isPhaseComplete(dispatch, phase.id) || index < activeIndex;
          const current = phase.id === activePhase && dispatch.status !== 'dispatched';
          const dispatchedCurrent = dispatch.status === 'dispatched' && phase.id === 'delivered';

          return (
            <li
              key={phase.id}
              className={[
                'courier-phases__item',
                complete ? 'courier-phases__item--complete' : '',
                current || dispatchedCurrent ? 'courier-phases__item--current' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="courier-phases__marker" aria-hidden>
                {complete ? <Check size={14} strokeWidth={3} /> : index + 1}
              </span>
              <div className="courier-phases__copy">
                <strong>{phase.label}</strong>
                <span>{phase.description}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
