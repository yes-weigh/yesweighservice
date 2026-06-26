import React, { useRef, useState } from 'react';
import { Camera, ImageIcon, Plus, X, Zap } from 'lucide-react';
import { MAX_ITEM_PHOTOS } from '../../types/yes-store';
import type { RowNumber, BinNumber } from '../../types/yes-store';
import { validateYesStoreImage } from '../../lib/yesStore/photos';
import { WarehouseWizardShell, WizardNextButton } from './WarehouseWizardShell';
import type { PhotoSlot } from './ItemPhotoQtyForm';

type WarehouseCapturePhotosProps = {
  rackId: string;
  rowNumber: RowNumber;
  binNumber: BinNumber;
  slots: PhotoSlot[];
  onAddPhoto: (file: File) => void;
  onRemoveSlot: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
};

export const WarehouseCapturePhotos: React.FC<WarehouseCapturePhotosProps> = ({
  rackId,
  rowNumber,
  binNumber,
  slots,
  onAddPhoto,
  onRemoveSlot,
  onBack,
  onNext,
}) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const canAddMore = slots.length < MAX_ITEM_PHOTOS;

  const lastSlot = slots.length ? slots[slots.length - 1] : null;
  const previewUrl = lastSlot
    ? (lastSlot.kind === 'saved' ? lastSlot.photo.url : lastSlot.pending.previewUrl)
    : null;

  const handleFile = (fileList: FileList | null) => {
    if (!fileList?.length || !canAddMore) return;
    setError('');
    const err = validateYesStoreImage(fileList[0]);
    if (err) {
      setError(err);
      return;
    }
    onAddPhoto(fileList[0]);
  };

  return (
    <WarehouseWizardShell
      title="Capture Photos"
      onBack={onBack}
      context={{ rackId, rowNumber, binNumber }}
      footer={
        <WizardNextButton
          disabled={slots.length === 0}
          onClick={onNext}
        />
      }
    >
      <p className="wh-hint">Take clear photos of the bin and items inside. Up to {MAX_ITEM_PHOTOS} photos.</p>
      {error && <div className="wh-error">{error}</div>}

      <div className="wh-camera-stage">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="wh-camera-stage__preview" />
        ) : (
          <div className="wh-camera-stage__empty">
            <Camera size={40} aria-hidden />
            <span>No photos yet</span>
          </div>
        )}
      </div>

      <div className="wh-thumb-strip">
        {slots.map((slot, index) => (
          <div key={slot.kind === 'saved' ? slot.photo.id : slot.pending.id} className="wh-thumb">
            <img
              src={slot.kind === 'saved' ? slot.photo.url : slot.pending.previewUrl}
              alt=""
            />
            <button
              type="button"
              className="wh-thumb__remove"
              onClick={() => onRemoveSlot(index)}
              aria-label="Remove photo"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {canAddMore && (
          <button
            type="button"
            className="wh-thumb wh-thumb--add"
            onClick={() => cameraRef.current?.click()}
          >
            <Plus size={22} />
            <span>Add More</span>
          </button>
        )}
      </div>

      <div className="wh-camera-controls">
        <button type="button" className="wh-camera-controls__side" aria-label="Gallery" onClick={() => galleryRef.current?.click()}>
          <ImageIcon size={22} />
          <span>Gallery</span>
        </button>
        <button
          type="button"
          className="wh-camera-controls__shutter"
          disabled={!canAddMore}
          onClick={() => cameraRef.current?.click()}
          aria-label="Take photo"
        />
        <button type="button" className="wh-camera-controls__side" aria-hidden tabIndex={-1}>
          <Zap size={22} />
          <span>Flash</span>
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={e => {
          handleFile(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={e => {
          handleFile(e.target.files);
          e.target.value = '';
        }}
      />
    </WarehouseWizardShell>
  );
};
