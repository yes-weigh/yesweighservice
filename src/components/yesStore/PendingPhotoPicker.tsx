import React, { useRef, useState } from 'react';
import { Camera, ImageIcon } from 'lucide-react';
import { validateYesStoreImage } from '../../lib/yesStore/photos';

export type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type PendingPhotoPickerProps = {
  photos: PendingPhoto[];
  onChange: (photos: PendingPhoto[]) => void;
  disabled?: boolean;
};

function createPending(file: File): PendingPhoto {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

export const PendingPhotoPicker: React.FC<PendingPhotoPickerProps> = ({
  photos,
  onChange,
  disabled,
}) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length || disabled) return;
    setError('');
    const next = [...photos];
    for (const file of fileList) {
      const err = validateYesStoreImage(file);
      if (err) {
        setError(err);
        continue;
      }
      next.push(createPending(file));
    }
    onChange(next);
  };

  const removePhoto = (id: string) => {
    const removed = photos.find(p => p.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onChange(photos.filter(p => p.id !== id));
  };

  return (
    <div className="yes-store-pending">
      <div className="yes-store-photos__actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={18} />
          Camera
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
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
            addFiles(e.target.files);
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
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && <div className="login-error">{error}</div>}

      {photos.length > 0 ? (
        <div className="yes-store-photos__grid">
          {photos.map(photo => (
            <div key={photo.id} className="yes-store-photos__item">
              <img src={photo.previewUrl} alt="" />
              <button
                type="button"
                className="yes-store-pending__remove"
                disabled={disabled}
                onClick={() => removePhoto(photo.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted text-sm">Attach at least one photo before saving the item.</p>
      )}
    </div>
  );
};
