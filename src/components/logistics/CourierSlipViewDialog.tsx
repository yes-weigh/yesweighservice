import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import {
  buildCourierSlipFromBooking,
  buildCourierSlipShareBlob,
  shareCourierSlipImage,
} from '../../lib/courierSlipImage';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import { ZoomableImagePreview } from './ZoomableImagePreview';
import { ZoomablePdfPreview } from './ZoomablePdfPreview';

type Props = {
  booking: LogisticsBooking;
  onClose: () => void;
  /** Called after the slip is shown (or shared) so status can be marked generated. */
  onViewed?: () => void;
};

export const CourierSlipViewDialog: React.FC<Props> = ({
  booking,
  onClose,
  onViewed,
}) => {
  const slip = useMemo(() => buildCourierSlipFromBooking(booking), [booking]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [mimeType, setMimeType] = useState('application/pdf');
  const [fileName, setFileName] = useState('courier-slip.pdf');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const onViewedRef = React.useRef(onViewed);
  onViewedRef.current = onViewed;
  const viewedRef = React.useRef(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError('');
    setPreviewUrl(null);
    setPdfBytes(null);

    void buildCourierSlipShareBlob(slip)
      .then(async ({ blob, fileName: name, mimeType: type }) => {
        if (cancelled) return;
        setFileName(name);
        setMimeType(type);

        if (type === 'application/pdf') {
          const buffer = await blob.arrayBuffer();
          if (cancelled) return;
          setPdfBytes(new Uint8Array(buffer));
        } else {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }

        setLoading(false);
        if (!viewedRef.current) {
          viewedRef.current = true;
          onViewedRef.current?.();
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not build courier slip.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slip]);

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

  const handleShare = useCallback(async () => {
    setSharing(true);
    setError('');
    try {
      await shareCourierSlipImage(slip);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not share courier slip.');
    } finally {
      setSharing(false);
    }
  }, [slip]);

  const isPdf = mimeType === 'application/pdf';

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass courier-slip-view-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="courier-slip-view-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="courier-slip-view-title">Courier slip</h2>
            <p className="text-muted text-sm">
              {booking.consignmentNo || booking.trackingNo || booking.orderRef}
              {fileName ? ` · ${fileName}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {error && <p className="dealers-modal__error">{error}</p>}

        <div className="courier-slip-view-dialog__body">
          {loading && (
            <p className="text-muted text-sm courier-slip-view-dialog__status">Preparing courier slip…</p>
          )}
          {!loading && isPdf && pdfBytes && (
            <ZoomablePdfPreview data={pdfBytes} />
          )}
          {!loading && !isPdf && previewUrl && (
            <ZoomableImagePreview src={previewUrl} alt="Courier slip" />
          )}
        </div>

        <div className="dealers-modal__actions courier-slip-view-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={sharing}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleShare()}
            disabled={sharing || loading || Boolean(error)}
          >
            <Share2 size={16} aria-hidden />
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
