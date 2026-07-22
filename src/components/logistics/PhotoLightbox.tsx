import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

type Props = {
  urls: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  alt?: string;
};

const SWIPE_THRESHOLD_PX = 40;

export const PhotoLightbox: React.FC<Props> = ({
  urls,
  index,
  onClose,
  onIndexChange,
  alt = 'Preview',
}) => {
  const swipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const count = urls.length;
  const safeIndex = count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
  const src = urls[safeIndex] ?? '';
  const canPrev = safeIndex > 0;
  const canNext = safeIndex < count - 1;

  const goPrev = useCallback(() => {
    if (safeIndex > 0) onIndexChange(safeIndex - 1);
  }, [onIndexChange, safeIndex]);

  const goNext = useCallback(() => {
    if (safeIndex < count - 1) onIndexChange(safeIndex + 1);
  }, [count, onIndexChange, safeIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') goPrev();
      if (event.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [goNext, goPrev, onClose]);

  const finishSwipe = useCallback((clientX: number, clientY: number) => {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe) return;

    const deltaX = clientX - swipe.startX;
    const deltaY = clientY - swipe.startY;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    suppressClickRef.current = true;
    if (deltaX > 0) goPrev();
    else goNext();
  }, [goNext, goPrev]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      swipe.moved = true;
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishSwipe(event.clientX, event.clientY);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (swipeRef.current?.pointerId === event.pointerId) {
      swipeRef.current = null;
    }
  };

  const onBackdropClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClose();
  };

  if (!src) return null;

  return createPortal(
    <div
      className="book-courier__lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo preview"
      onClick={onBackdropClick}
    >
      <button
        type="button"
        className="book-courier__lightbox-close"
        aria-label="Close preview"
        onClick={event => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X size={20} aria-hidden />
      </button>

      {canPrev && (
        <button
          type="button"
          className="book-courier__lightbox-nav book-courier__lightbox-nav--prev"
          aria-label="Previous photo"
          onClick={event => {
            event.stopPropagation();
            goPrev();
          }}
        >
          <ChevronLeft size={28} aria-hidden />
        </button>
      )}

      {canNext && (
        <button
          type="button"
          className="book-courier__lightbox-nav book-courier__lightbox-nav--next"
          aria-label="Next photo"
          onClick={event => {
            event.stopPropagation();
            goNext();
          }}
        >
          <ChevronRight size={28} aria-hidden />
        </button>
      )}

      <div
        className="book-courier__lightbox-stage"
        onClick={event => event.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <img src={src} alt={alt} draggable={false} />
      </div>

      {count > 1 && (
        <p className="book-courier__lightbox-count" aria-live="polite">
          {safeIndex + 1} / {count}
        </p>
      )}
    </div>,
    document.body,
  );
};
