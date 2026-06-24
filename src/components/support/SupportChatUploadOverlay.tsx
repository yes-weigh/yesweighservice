import React from 'react';

interface SupportChatUploadOverlayProps {
  progress: number | null;
}

export const SupportChatUploadOverlay: React.FC<SupportChatUploadOverlayProps> = ({ progress }) => {
  const indeterminate = progress == null;
  const pct = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="support-chat__upload-overlay" aria-hidden>
      <svg
        className={`support-chat__upload-ring${indeterminate ? ' is-indeterminate' : ''}`}
        viewBox="0 0 36 36"
      >
        <circle className="support-chat__upload-ring-bg" cx="18" cy="18" r="16" fill="none" strokeWidth="3" />
        {!indeterminate && (
          <circle
            className="support-chat__upload-ring-fg"
            cx="18"
            cy="18"
            r="16"
            fill="none"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 18 18)"
          />
        )}
      </svg>
      {!indeterminate && <span className="support-chat__upload-pct">{pct}%</span>}
    </div>
  );
};
