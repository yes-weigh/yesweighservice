import React from 'react';
import type { SupportSubmitProgress } from '../../lib/supportAttachments';

interface SupportWizardSubmitProgressProps {
  progress: SupportSubmitProgress;
}

export const SupportWizardSubmitProgress: React.FC<SupportWizardSubmitProgressProps> = ({
  progress,
}) => (
  <div className="support-wizard__upload-progress panel glass" role="status" aria-live="polite">
    <div className="support-wizard__upload-progress-head">
      <span className="support-wizard__upload-progress-label">{progress.label}</span>
      {progress.percent != null && (
        <span className="support-wizard__upload-progress-pct">{progress.percent}%</span>
      )}
    </div>
    <div className="support-wizard__upload-progress-track" aria-hidden>
      <div
        className={[
          'support-wizard__upload-progress-bar',
          progress.percent == null ? 'is-indeterminate' : '',
        ].filter(Boolean).join(' ')}
        style={progress.percent != null ? { width: `${progress.percent}%` } : undefined}
      />
    </div>
  </div>
);
