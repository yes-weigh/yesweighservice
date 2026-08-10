import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ZoomableImagePreview } from './ZoomableImagePreview';
import { ZoomablePdfPreview } from './ZoomablePdfPreview';

export type DelhiveryDocumentDialogPayload = {
  title: string;
  contentType: string;
  /** PDF bytes, or null when showing images. */
  pdfBytes?: Uint8Array | null;
  /** Image object URLs (caller owns revoke on close if needed). */
  imageUrls?: string[];
  fileName: string;
  /** Optional blob for download (PDF or first image zip not needed — download each). */
  downloadBlob?: Blob | null;
};

type Props = {
  payload: DelhiveryDocumentDialogPayload;
  onClose: () => void;
  onViewed?: () => void;
};

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const DelhiveryDocumentDialog: React.FC<Props> = ({
  payload,
  onClose,
  onViewed,
}) => {
  const [imageIndex, setImageIndex] = useState(0);
  const viewedRef = React.useRef(false);
  const images = payload.imageUrls ?? [];
  const isPdf = Boolean(payload.pdfBytes?.length);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    onViewed?.();
  }, [onViewed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeImage = images[imageIndex] || null;
  const downloadTarget = useMemo(() => {
    if (payload.downloadBlob) {
      return { blob: payload.downloadBlob, name: payload.fileName };
    }
    return null;
  }, [payload.downloadBlob, payload.fileName]);

  return createPortal(
    <div
      className="courier-slip-view-dialog__backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="courier-slip-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={payload.title}
        onClick={event => event.stopPropagation()}
      >
        <header className="courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <strong>{payload.title}</strong>
            <span className="text-muted text-sm">{payload.fileName}</span>
          </div>
          <div className="courier-slip-view-dialog__actions">
            {downloadTarget && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => downloadBlob(downloadTarget.blob, downloadTarget.name)}
              >
                <Download size={14} aria-hidden />
                Download
              </button>
            )}
            {!downloadTarget && activeImage && (
              <a
                className="btn btn-secondary btn-sm"
                href={activeImage}
                download={payload.fileName}
              >
                <Download size={14} aria-hidden />
                Download
              </a>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </header>

        <div className="courier-slip-view-dialog__body">
          {isPdf && payload.pdfBytes ? (
            <ZoomablePdfPreview data={payload.pdfBytes} />
          ) : activeImage ? (
            <>
              {images.length > 1 && (
                <div className="logistics-booking__delhivery-doc-pages" role="tablist">
                  {images.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      role="tab"
                      aria-selected={index === imageIndex}
                      className={`btn btn-secondary btn-sm${index === imageIndex ? ' is-active' : ''}`}
                      onClick={() => setImageIndex(index)}
                    >
                      Label {index + 1}
                    </button>
                  ))}
                </div>
              )}
              <ZoomableImagePreview src={activeImage} alt={payload.title} />
            </>
          ) : (
            <p className="text-muted text-sm">Document preview unavailable.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
