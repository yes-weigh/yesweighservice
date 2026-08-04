import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
};

/** Mobile bottom sheet for sales-order line / freight editors. */
export const SoLineEditSheet: React.FC<Props> = ({
  title,
  eyebrow = 'Edit',
  onClose,
  children,
}) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="so-line-edit-sheet" role="presentation">
      <button
        type="button"
        className="so-line-edit-sheet__backdrop"
        aria-label="Close editor"
        onClick={onClose}
      />
      <div
        className="so-line-edit-sheet__panel panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="so-line-edit-sheet-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="so-line-edit-sheet__handle" aria-hidden />
        <header className="so-line-edit-sheet__head">
          <div>
            <p className="so-line-edit-sheet__eyebrow">{eyebrow}</p>
            <h2 id="so-line-edit-sheet-title" className="so-line-edit-sheet__title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="so-line-edit-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="so-line-edit-sheet__body">
          {children}
        </div>
        <div className="so-line-edit-sheet__actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
