import React from 'react';
import { Check, X } from 'lucide-react';

export type DealerCreateStatusPhase = 'creating' | 'success' | 'fail';

export const DealerCreateStatusOverlay: React.FC<{
  phase: DealerCreateStatusPhase;
  workingLabel?: string;
  successLabel?: string;
  failLabel?: string;
  cover?: 'modal' | 'page';
}> = ({
  phase,
  workingLabel = 'Creating dealer…',
  successLabel = 'Dealer created',
  failLabel = 'Could not create dealer',
  cover = 'modal',
}) => {
  const label = phase === 'creating'
    ? workingLabel
    : phase === 'success'
      ? successLabel
      : failLabel;

  return (
    <div
      className={`dealer-create-status dealer-create-status--${phase} dealer-create-status--${cover}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="dealer-create-status__stage">
        {phase === 'creating' ? (
          <div className="dealer-create-status__scene" aria-hidden>
            <div className="dealer-create-status__cube">
              <span className="dealer-create-status__face dealer-create-status__face--front" />
              <span className="dealer-create-status__face dealer-create-status__face--back" />
              <span className="dealer-create-status__face dealer-create-status__face--right" />
              <span className="dealer-create-status__face dealer-create-status__face--left" />
              <span className="dealer-create-status__face dealer-create-status__face--top" />
              <span className="dealer-create-status__face dealer-create-status__face--bottom" />
            </div>
          </div>
        ) : (
          <div
            className={`dealer-create-status__mark dealer-create-status__mark--${phase === 'success' ? 'ok' : 'bad'}`}
          >
            {phase === 'success' ? <Check size={42} strokeWidth={3} /> : <X size={42} strokeWidth={3} />}
          </div>
        )}
      </div>
      <p className="dealer-create-status__label">{label}</p>
    </div>
  );
};
