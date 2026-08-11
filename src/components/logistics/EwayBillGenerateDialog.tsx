import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  EwayBillGeneratePreviewBody,
  isEwayTransporterMissing,
  type EwayBillGeneratePreview,
} from './EwayBillGeneratePreview';

export type { EwayBillGeneratePreview };

type Props = {
  preview: EwayBillGeneratePreview;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export const EwayBillGenerateDialog: React.FC<Props> = ({
  preview,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const transporterMissing = isEwayTransporterMissing(preview);

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="dealers-modal panel glass logistics-eway-generate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eway-generate-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="eway-generate-title">Generate e-way bill</h3>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="logistics-eway-generate__body">
          <EwayBillGeneratePreviewBody preview={preview} error={error} />
        </div>

        <div className="dealers-modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || transporterMissing}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? 'Generating…' : 'Generate e-way bill'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
