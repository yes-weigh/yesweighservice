import React, { useCallback, useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2, Trash2, ZoomIn, X } from 'lucide-react';
import type { YesStorePhoto } from '../../types/yes-store';

type PhotoGalleryProps = {
  photos: YesStorePhoto[];
  disabled?: boolean;
  uploading?: boolean;
  uploadProgress?: number | null;
  onAddFiles: (files: File[]) => Promise<void>;
  onDeletePhoto: (photo: YesStorePhoto) => Promise<void>;
  title?: string;
};

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  photos,
  disabled,
  uploading,
  uploadProgress,
  onAddFiles,
  onDeletePhoto,
  title = 'Photos',
}) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length || disabled || uploading) return;
    setError('');
    try {
      await onAddFiles([...fileList]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }, [disabled, onAddFiles, uploading]);

  const handleDelete = async (photo: YesStorePhoto) => {
    if (disabled || deletingId) return;
    setDeletingId(photo.id);
    setError('');
    try {
      await onDeletePhoto(photo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="yes-store-photos panel glass">
      <div className="yes-store-photos__header">
        <h3>{title}</h3>
        <span className="text-muted text-sm">{photos.length} total</span>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="yes-store-photos__actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || uploading}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={18} />
          Camera
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || uploading}
          onClick={() => galleryRef.current?.click()}
        >
          <ImageIcon size={18} />
          Gallery
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={e => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={e => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {uploading && (
        <div className="yes-store-photos__progress text-sm text-muted">
          <Loader2 size={16} className="spin-icon" aria-hidden />
          Uploading…{uploadProgress != null ? ` ${uploadProgress}%` : ''}
        </div>
      )}

      {photos.length > 0 ? (
        <div className="yes-store-photos__grid">
          {photos.map(photo => (
            <div key={photo.id} className="yes-store-photos__item">
              <img src={photo.url} alt={photo.fileName} loading="lazy" />
              <div className="yes-store-photos__item-actions">
                <button
                  type="button"
                  className="btn btn-icon btn-secondary btn-sm"
                  aria-label="Zoom photo"
                  onClick={() => setLightboxUrl(photo.url)}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-secondary btn-sm"
                  aria-label="Delete photo"
                  disabled={disabled || deletingId === photo.id}
                  onClick={() => void handleDelete(photo)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="yes-store-photos__dropzone"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <ImageIcon size={28} aria-hidden />
          <p>No photos yet. Use Camera or Gallery, or drag images here on desktop.</p>
        </div>
      )}

      {lightboxUrl && (
        <div className="yes-store-lightbox" role="dialog" aria-modal="true">
          <button
            type="button"
            className="yes-store-lightbox__close btn btn-icon btn-secondary"
            aria-label="Close"
            onClick={() => setLightboxUrl(null)}
          >
            <X size={20} />
          </button>
          <img src={lightboxUrl} alt="" className="yes-store-lightbox__img" />
        </div>
      )}
    </section>
  );
};
