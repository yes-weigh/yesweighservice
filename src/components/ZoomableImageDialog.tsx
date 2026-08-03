import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ZoomableImagePreview } from './logistics/ZoomableImagePreview';

type Props = {
  src: string;
  title?: string;
  alt?: string;
  onClose: () => void;
};

/** Full-screen popup for a single image with pinch zoom, pan, and close. */
export const ZoomableImageDialog: React.FC<Props> = ({
  src,
  title = 'Image',
  alt,
  onClose,
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
    <div
      className="dealers-modal-backdrop zoomable-image-dialog__backdrop"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass zoomable-image-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zoomable-image-dialog-title"
      >
        <div className="dealers-modal__header zoomable-image-dialog__header">
          <h2 id="zoomable-image-dialog-title">{title}</h2>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="zoomable-image-dialog__body">
          <ZoomableImagePreview src={src} alt={alt || title} />
        </div>

        <div className="dealers-modal__actions zoomable-image-dialog__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
