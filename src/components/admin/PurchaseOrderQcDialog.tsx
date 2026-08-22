import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { ChevronLeft, ChevronRight, ImagePlus, Share2, Trash2, X } from 'lucide-react';
import { WhatsAppShare } from 'whatsapp-share';
import { ZoomableImagePreview } from '../logistics/ZoomableImagePreview';
import { FetchingLoader } from '../FetchingLoader';
import {
  addPurchaseOrderQcImages,
  deletePurchaseOrderQcImage,
  fetchPurchaseOrderQcImageUrl,
  purchaseOrderHasQc,
  type AdminPurchaseOrderDetail,
  type PurchaseOrderQcImage,
} from '../../lib/admin-purchase-orders';
import { invoiceErrorMessage } from '../../lib/invoices';

type Props = {
  open: boolean;
  purchaseOrder: AdminPurchaseOrderDetail;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (qcImages: PurchaseOrderQcImage[]) => void;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function shareQcImageFile(input: {
  url: string;
  fileName: string;
  title: string;
}): Promise<void> {
  const res = await fetch(input.url);
  if (!res.ok) throw new Error('Could not load photo to share.');
  const blob = await res.blob();
  const mimeType = blob.type || 'image/jpeg';
  const baseName = String(input.fileName || 'qc-photo.jpg').trim() || 'qc-photo.jpg';
  const fileName = /\.(jpe?g|png|webp|heic|heif)$/i.test(baseName)
    ? baseName
    : `${baseName}.jpg`;
  const title = input.title;

  if (Capacitor.isNativePlatform()) {
    await WhatsAppShare.shareImage({
      dataBase64: await blobToBase64(blob),
      fileName,
      mimeType,
    });
    return;
  }

  const file = new File([blob], fileName, { type: mimeType });
  const shareData: ShareData = { files: [file], title, text: title };
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    await navigator.share(shareData);
    return;
  }
  if (typeof navigator.share === 'function') {
    await navigator.share({ title, text: title, url: input.url });
    return;
  }

  const anchor = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export const PurchaseOrderQcDialog: React.FC<Props> = ({
  open,
  purchaseOrder,
  canEdit,
  onClose,
  onSaved,
}) => {
  const [images, setImages] = useState<PurchaseOrderQcImage[]>(purchaseOrder.qcImages ?? []);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setImages(purchaseOrder.qcImages ?? []);
    setError('');
    setViewerIndex(null);
  }, [open, purchaseOrder.id, purchaseOrder.qcImages]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const missing = images.filter(img => !urls[img.id]);
    if (!missing.length) return;
    setLoadingUrls(true);
    void Promise.all(
      missing.map(async img => {
        try {
          const url = await fetchPurchaseOrderQcImageUrl(img.storagePath);
          return [img.id, url] as const;
        } catch {
          return [img.id, ''] as const;
        }
      }),
    ).then(entries => {
      if (cancelled) return;
      setUrls(prev => {
        const next = { ...prev };
        for (const [id, url] of entries) {
          if (url) next[id] = url;
        }
        return next;
      });
    }).finally(() => {
      if (!cancelled) setLoadingUrls(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, images, urls]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (uploading || deletingId || sharingId) return;
      if (event.key === 'Escape') {
        if (viewerIndex != null) setViewerIndex(null);
        else onClose();
        return;
      }
      if (viewerIndex == null || !images.length) return;
      if (event.key === 'ArrowLeft') {
        setViewerIndex(i => (i == null ? i : (i - 1 + images.length) % images.length));
      }
      if (event.key === 'ArrowRight') {
        setViewerIndex(i => (i == null ? i : (i + 1) % images.length));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, uploading, deletingId, sharingId, viewerIndex, images.length]);

  const viewerImage = useMemo(
    () => (viewerIndex != null ? images[viewerIndex] ?? null : null),
    [images, viewerIndex],
  );
  const viewerSrc = viewerImage ? urls[viewerImage.id] ?? null : null;

  if (!open) return null;

  const uploadFiles = async (fileList: FileList | null) => {
    if (!canEdit || !fileList?.length) return;
    setUploading(true);
    setError('');
    try {
      const next = await addPurchaseOrderQcImages({
        purchaseOrderId: purchaseOrder.id,
        files: Array.from(fileList),
        existing: images,
      });
      setImages(next);
      onSaved(next);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (imageId: string) => {
    if (!canEdit) return;
    setDeletingId(imageId);
    setError('');
    try {
      const next = await deletePurchaseOrderQcImage({
        purchaseOrderId: purchaseOrder.id,
        imageId,
        existing: images,
      });
      setImages(next);
      setUrls(prev => {
        const copy = { ...prev };
        delete copy[imageId];
        return copy;
      });
      if (viewerIndex != null) {
        if (!next.length) setViewerIndex(null);
        else setViewerIndex(Math.min(viewerIndex, next.length - 1));
      }
      onSaved(next);
    } catch (err) {
      setError(invoiceErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const shareImage = async (img: PurchaseOrderQcImage) => {
    const url = urls[img.id];
    if (!url) {
      setError('Photo is still loading. Try again in a moment.');
      return;
    }
    setSharingId(img.id);
    setError('');
    try {
      await shareQcImageFile({
        url,
        fileName: img.fileName || `QC-${purchaseOrder.purchaseOrderNumber || 'photo'}.jpg`,
        title: `QC · ${purchaseOrder.purchaseOrderNumber || purchaseOrder.id}`,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(invoiceErrorMessage(err));
    } finally {
      setSharingId(null);
    }
  };

  const scrollStrip = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(220, el.clientWidth * 0.75), behavior: 'smooth' });
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop courier-slip-view-dialog__backdrop"
      onClick={() => {
        if (uploading || deletingId || sharingId) return;
        if (viewerIndex != null) setViewerIndex(null);
        else onClose();
      }}
    >
      <div
        className="dealers-modal panel glass courier-slip-view-dialog po-qc-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-qc-dialog-title"
      >
        <div className="dealers-modal__header courier-slip-view-dialog__header">
          <div className="courier-slip-view-dialog__title-block">
            <h2 id="po-qc-dialog-title">QC photos</h2>
            <p className="text-muted text-sm">
              {purchaseOrder.purchaseOrderNumber}
              {purchaseOrderHasQc(images) ? ` · ${images.length} photo${images.length === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            disabled={uploading || Boolean(deletingId) || Boolean(sharingId)}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {canEdit ? (
          <div className="po-qc-dialog__actions">
            <label className="btn btn-primary po-qc-dialog__pick">
              <ImagePlus size={16} strokeWidth={2.2} aria-hidden />
              Upload photos
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading}
                hidden
                onChange={e => {
                  void uploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        ) : null}

        {error ? <p className="dealers-modal__error">{error}</p> : null}
        {uploading ? <FetchingLoader label="Uploading QC photos…" /> : null}

        {!images.length && !uploading ? (
          <p className="text-muted text-sm po-qc-dialog__empty">
            {canEdit
              ? 'No QC photos yet. Upload multiple photos from your gallery.'
              : 'No QC photos uploaded for this purchase order.'}
          </p>
        ) : (
          <div className="po-qc-dialog__strip-wrap">
            {images.length > 1 ? (
              <button
                type="button"
                className="po-qc-dialog__strip-nav po-qc-dialog__strip-nav--prev"
                onClick={() => scrollStrip(-1)}
                aria-label="Previous photos"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}
            <div
              ref={stripRef}
              className="po-qc-dialog__strip"
              role="list"
              aria-label="QC photo list"
            >
              {images.map((img, index) => {
                const src = urls[img.id];
                return (
                  <div key={img.id} className="po-qc-dialog__slide" role="listitem">
                    {src ? (
                      <button
                        type="button"
                        className="po-qc-dialog__thumb"
                        onClick={() => setViewerIndex(index)}
                        aria-label={`View photo ${index + 1} of ${images.length}`}
                      >
                        <img src={src} alt={img.fileName || `QC photo ${index + 1}`} />
                      </button>
                    ) : (
                      <div className="po-qc-dialog__thumb po-qc-dialog__thumb--loading">
                        {loadingUrls ? '…' : '—'}
                      </div>
                    )}
                    <div className="po-qc-dialog__slide-actions">
                      <button
                        type="button"
                        className="po-qc-dialog__icon-btn"
                        disabled={!src || sharingId === img.id || uploading}
                        onClick={() => { void shareImage(img); }}
                        aria-label="Share photo"
                        title="Share"
                      >
                        <Share2 size={14} strokeWidth={2.2} />
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className="po-qc-dialog__icon-btn po-qc-dialog__icon-btn--danger"
                          disabled={uploading || deletingId === img.id}
                          onClick={() => { void removeImage(img.id); }}
                          aria-label="Delete photo"
                          title="Delete"
                        >
                          <Trash2 size={14} strokeWidth={2.2} />
                        </button>
                      ) : null}
                    </div>
                    <span className="po-qc-dialog__slide-index">
                      {index + 1}/{images.length}
                    </span>
                  </div>
                );
              })}
            </div>
            {images.length > 1 ? (
              <button
                type="button"
                className="po-qc-dialog__strip-nav po-qc-dialog__strip-nav--next"
                onClick={() => scrollStrip(1)}
                aria-label="Next photos"
              >
                <ChevronRight size={18} />
              </button>
            ) : null}
          </div>
        )}

        <div className="dealers-modal__actions courier-slip-view-dialog__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={uploading || Boolean(deletingId) || Boolean(sharingId)}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {viewerImage && viewerSrc ? (
          <div
            className="po-qc-dialog__viewer"
            onClick={() => setViewerIndex(null)}
            role="presentation"
            onTouchStart={event => {
              touchStartX.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={event => {
              const start = touchStartX.current;
              touchStartX.current = null;
              if (start == null || images.length < 2) return;
              const end = event.changedTouches[0]?.clientX ?? start;
              const delta = end - start;
              if (Math.abs(delta) < 48) return;
              setViewerIndex(i => {
                if (i == null) return i;
                return delta > 0
                  ? (i - 1 + images.length) % images.length
                  : (i + 1) % images.length;
              });
            }}
          >
            <div
              className="po-qc-dialog__viewer-inner"
              onClick={event => event.stopPropagation()}
            >
              <div className="po-qc-dialog__viewer-toolbar">
                <span className="text-sm">
                  {(viewerIndex ?? 0) + 1} / {images.length}
                </span>
                <div className="po-qc-dialog__viewer-toolbar-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={sharingId === viewerImage.id}
                    onClick={() => { void shareImage(viewerImage); }}
                  >
                    <Share2 size={14} strokeWidth={2.2} aria-hidden />
                    {sharingId === viewerImage.id ? 'Sharing…' : 'Share'}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={deletingId === viewerImage.id}
                      onClick={() => { void removeImage(viewerImage.id); }}
                    >
                      <Trash2 size={14} strokeWidth={2.2} aria-hidden />
                      Delete
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setViewerIndex(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
              {images.length > 1 ? (
                <button
                  type="button"
                  className="po-qc-dialog__viewer-nav po-qc-dialog__viewer-nav--prev"
                  onClick={() => setViewerIndex(i => (
                    i == null ? i : (i - 1 + images.length) % images.length
                  ))}
                  aria-label="Previous photo"
                >
                  <ChevronLeft size={22} />
                </button>
              ) : null}
              <ZoomableImagePreview src={viewerSrc} alt={viewerImage.fileName || 'QC photo'} />
              {images.length > 1 ? (
                <button
                  type="button"
                  className="po-qc-dialog__viewer-nav po-qc-dialog__viewer-nav--next"
                  onClick={() => setViewerIndex(i => (
                    i == null ? i : (i + 1) % images.length
                  ))}
                  aria-label="Next photo"
                >
                  <ChevronRight size={22} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
