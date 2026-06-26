import React, { useCallback, useRef, useState } from 'react';
import { Camera, Film, ImageIcon, Plus, X } from 'lucide-react';
import {
  createPendingEvidencePhoto,
  createPendingSupportFile,
  retainFileCopy,
  validateSupportFile,
  type EvidencePhotoSlot,
  type PendingSupportFile,
} from '../../lib/supportAttachments';
import { pushRecentMedia } from '../../lib/recentMediaCache';
import {
  SupportEvidenceCamera,
  type EvidenceSlotId,
} from './SupportEvidenceCamera';

interface SupportEvidencePickerProps {
  files: PendingSupportFile[];
  onChange: React.Dispatch<React.SetStateAction<PendingSupportFile[]>>;
  disabled?: boolean;
}

interface SlotMeta {
  id: EvidenceSlotId;
  label: string;
  hint: string;
  kind: 'video' | 'image';
}

const EVIDENCE_SLOTS: SlotMeta[] = [
  {
    id: 'video',
    label: 'Video evidence',
    hint: '30 sec – 2 min',
    kind: 'video',
  },
  {
    id: 'serial',
    label: 'Serial / MAC ID',
    hint: 'Identification label',
    kind: 'image',
  },
  {
    id: 'label',
    label: 'Product label',
    hint: 'YESWEIGH label',
    kind: 'image',
  },
];

function getSlotFile(files: PendingSupportFile[], slotId: EvidenceSlotId): PendingSupportFile | null {
  if (slotId === 'video') return files.find(file => file.kind === 'video') ?? null;
  return files.find(file => file.kind === 'image' && file.photoSlot === slotId) ?? null;
}

function setSlotFile(
  files: PendingSupportFile[],
  slotId: EvidenceSlotId,
  file: PendingSupportFile | null,
): PendingSupportFile[] {
  const previous = getSlotFile(files, slotId);
  if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);

  const without = slotId === 'video'
    ? files.filter(item => item.kind !== 'video')
    : files.filter(item => !(item.kind === 'image' && item.photoSlot === slotId));

  if (!file) return without;
  return [...without, file];
}

function firstMissingSlot(files: PendingSupportFile[]): EvidenceSlotId {
  for (const slot of EVIDENCE_SLOTS) {
    if (!getSlotFile(files, slot.id)) return slot.id;
  }
  return 'video';
}

export const SupportEvidencePicker: React.FC<SupportEvidencePickerProps> = ({
  files,
  onChange,
  disabled,
}) => {
  const galleryRef = useRef<HTMLInputElement>(null);
  const gallerySlotRef = useRef<EvidenceSlotId>('video');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSlot, setCameraSlot] = useState<EvidenceSlotId>('video');
  const [processing, setProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('Processing…');
  const [slotErrors, setSlotErrors] = useState<Partial<Record<EvidenceSlotId, string>>>({});

  const filledSlots = EVIDENCE_SLOTS
    .map(slot => slot.id)
    .filter(id => Boolean(getSlotFile(files, id)));

  const updateSlotFile = useCallback((slotId: EvidenceSlotId, file: PendingSupportFile | null) => {
    onChange(prev => setSlotFile(prev, slotId, file));
  }, [onChange]);

  const openCamera = (slotId: EvidenceSlotId) => {
    if (disabled) return;
    setCameraSlot(slotId);
    setCameraOpen(true);
    setSlotErrors(prev => ({ ...prev, [slotId]: undefined }));
  };

  const handleVideoFile = async (raw: File) => {
    const err = validateSupportFile(raw);
    if (err) throw new Error(err);
    setProcessingLabel('Saving video…');
    setProcessing(true);
    try {
      updateSlotFile('video', createPendingSupportFile(raw));
    } finally {
      setProcessing(false);
    }
  };

  const handlePhotoFile = async (slot: EvidencePhotoSlot, raw: File) => {
    const err = validateSupportFile(raw);
    if (err) throw new Error(err);
    updateSlotFile(slot, createPendingEvidencePhoto(raw, slot));
  };

  const handleGalleryPick = async (picked: FileList | null) => {
    const slotId = gallerySlotRef.current;
    const file = picked?.[0];
    if (!file) return;
    try {
      const retained = await retainFileCopy(file);
      const config = EVIDENCE_SLOTS.find(slot => slot.id === slotId)!;
      if (config.kind === 'video') {
        if (!retained.type.startsWith('video/')) {
          setSlotErrors(prev => ({ ...prev, [slotId]: 'Please choose a video file.' }));
          return;
        }
        await handleVideoFile(retained);
        await pushRecentMedia(retained);
      } else {
        if (!retained.type.startsWith('image/')) {
          setSlotErrors(prev => ({ ...prev, [slotId]: 'Please choose an image file.' }));
          return;
        }
        await handlePhotoFile(slotId as EvidencePhotoSlot, retained);
        await pushRecentMedia(retained);
      }
    } catch (pickErr) {
      setSlotErrors(prev => ({
        ...prev,
        [slotId]: pickErr instanceof Error ? pickErr.message : 'Could not add file.',
      }));
    } finally {
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const removeSlot = (slotId: EvidenceSlotId) => {
    updateSlotFile(slotId, null);
    setSlotErrors(prev => ({ ...prev, [slotId]: undefined }));
  };

  const allFilled = filledSlots.length === EVIDENCE_SLOTS.length;

  return (
    <div className="support-evidence-picker">
      <div className="support-evidence-picker__header">
        <h4 className="support-evidence-picker__title">
          Evidence
          <span className="form-label__required" aria-hidden> *</span>
        </h4>
        <p className="support-evidence-picker__subtitle text-muted text-sm">
          One video and two photos — serial label and product label.
        </p>
      </div>

      <div className="support-evidence-picker__grid">
        {EVIDENCE_SLOTS.map(slot => {
          const file = getSlotFile(files, slot.id);
          return (
            <div key={slot.id} className={`support-evidence-picker__cell${file ? ' support-evidence-picker__cell--filled' : ''}`}>
              <button
                type="button"
                className="support-evidence-picker__cell-main"
                disabled={disabled}
                onClick={() => openCamera(slot.id)}
              >
                {file ? (
                  file.kind === 'video' ? (
                    <video src={file.previewUrl} className="support-evidence-picker__cell-media" muted playsInline />
                  ) : (
                    <img src={file.previewUrl} alt="" className="support-evidence-picker__cell-media" />
                  )
                ) : (
                  <span className="support-evidence-picker__cell-empty">
                    {slot.kind === 'video' ? <Film size={22} /> : <ImageIcon size={22} />}
                    <Plus size={14} />
                  </span>
                )}
              </button>
              <div className="support-evidence-picker__cell-meta">
                <span className="support-evidence-picker__cell-label">{slot.label}</span>
                <span className="support-evidence-picker__cell-hint text-muted">{slot.hint}</span>
              </div>
              {file && (
                <button
                  type="button"
                  className="support-evidence-picker__cell-remove"
                  aria-label={`Remove ${slot.label}`}
                  disabled={disabled}
                  onClick={() => removeSlot(slot.id)}
                >
                  <X size={14} />
                </button>
              )}
              {slotErrors[slot.id] && (
                <p className="support-evidence-picker__cell-error text-sm">{slotErrors[slot.id]}</p>
              )}
            </div>
          );
        })}
      </div>

      {!allFilled && (
        <button
          type="button"
          className="support-evidence-picker__open"
          disabled={disabled}
          onClick={() => openCamera(firstMissingSlot(files))}
        >
          <Camera size={20} aria-hidden />
          Add evidence
        </button>
      )}

      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={e => void handleGalleryPick(e.target.files)}
      />

      {cameraOpen && (
        <SupportEvidenceCamera
          initialSlot={cameraSlot}
          filledSlots={filledSlots}
          processing={processing}
          processingLabel={processingLabel}
          onClose={() => setCameraOpen(false)}
          onPickGallery={slot => {
            gallerySlotRef.current = slot;
            galleryRef.current?.click();
          }}
          onVideoFile={async file => {
            try {
              await handleVideoFile(file);
            } catch (err) {
              setSlotErrors(prev => ({
                ...prev,
                video: err instanceof Error ? err.message : 'Could not save video.',
              }));
              throw err;
            }
          }}
          onPhotoFile={async (slot, file) => {
            try {
              await handlePhotoFile(slot, file);
            } catch (err) {
              setSlotErrors(prev => ({
                ...prev,
                [slot]: err instanceof Error ? err.message : 'Could not save photo.',
              }));
              throw err;
            }
          }}
        />
      )}
    </div>
  );
};

export { pendingFilesToUpload, cleanupPendingFiles } from './SupportAttachmentPicker';
