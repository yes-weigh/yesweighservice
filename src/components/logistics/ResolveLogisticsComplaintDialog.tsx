import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';

type Props = {
  submitting?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (notes: string) => void;
};

export const ResolveLogisticsComplaintDialog: React.FC<Props> = ({
  submitting = false,
  error = '',
  onClose,
  onSubmit,
}) => {
  const titleId = useId();
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  return createPortal(
    <div
      className="dealers-modal-backdrop logistics-issue-dialog__backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="dealers-modal panel logistics-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dealers-modal__header">
          <div>
            <h2 id={titleId}>Resolve complaint</h2>
            <p className="text-muted text-sm logistics-issue-dialog__subtitle">
              Marks this complaint resolved. Notes are optional and appear in tracking history
              with the date and time.
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <form
          className="dealers-modal__form"
          onSubmit={event => {
            event.preventDefault();
            onSubmit(notes);
          }}
        >
          <label className="dealers-modal__field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              rows={4}
              placeholder="e.g. Package traced, re-attempt scheduled…"
              disabled={submitting}
              autoFocus
            />
          </label>

          {error ? (
            <p className="logistics-issue-dialog__error" role="alert">{error}</p>
          ) : null}

          <div className="logistics-issue-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Check size={16} aria-hidden />
              {submitting ? 'Saving…' : 'Resolve'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
