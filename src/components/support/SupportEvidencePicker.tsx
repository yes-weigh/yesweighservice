import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Film, ImageIcon, Plus, X } from 'lucide-react';
import {
  createPendingEvidencePhoto,
  createPendingSupportFile,
  prepareSupportUploadFile,
  validateSupportFile,
  type EvidencePhotoSlot,
  type PendingSupportFile,
} from '../../lib/supportAttachments';
import {
  SupportEvidenceCamera,
  EVIDENCE_SLOT_ORDER,
  type EvidenceSlotId,
} from './SupportEvidenceCamera';

interface SupportEvidencePickerProps {
  files: PendingSupportFile[];
  onChange: React.Dispatch<React.SetStateAction<PendingSupportFile[]>>;
  disabled?: boolean;
  videoOnly?: boolean;
  onFileReady?: (file: PendingSupportFile) => void;
  onCaptureStart?: () => void;
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
    label: 'Product photo',
    hint: 'Real product',
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

function firstMissingSlot(
  files: PendingSupportFile[],
  order: EvidenceSlotId[] = EVIDENCE_SLOT_ORDER,
): EvidenceSlotId {
  for (const slotId of order) {
    if (!getSlotFile(files, slotId)) return slotId;
  }
  return order[0] ?? 'video';
}

function isSlotUnlocked(
  files: PendingSupportFile[],
  slotId: EvidenceSlotId,
  order: EvidenceSlotId[] = EVIDENCE_SLOT_ORDER,
): boolean {
  if (getSlotFile(files, slotId)) return true;
  for (const id of order) {
    if (id === slotId) return true;
    if (!getSlotFile(files, id)) return false;
  }
  return true;
}

const ADD_EVIDENCE_LABEL: Record<EvidenceSlotId, string> = {
  video: 'Record video',
  serial: 'Take serial / MAC photo',
  label: 'Take product photo',
};

export const SupportEvidencePicker: React.FC<SupportEvidencePickerProps> = ({
  files,
  onChange,
  disabled,
  videoOnly = false,
  onFileReady,
  onCaptureStart,
}) => {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSlot, setCameraSlot] = useState<EvidenceSlotId>('video');
  const [processing, setProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('Processing…');
  const [slotErrors, setSlotErrors] = useState<Partial<Record<EvidenceSlotId, string>>>({});
  const visibleSlots = videoOnly
    ? EVIDENCE_SLOTS.filter(slot => slot.id === 'video')
    : EVIDENCE_SLOTS;
  const slotOrder = visibleSlots.map(slot => slot.id);

  const filledSlots = visibleSlots
    .map(slot => slot.id)
    .filter(id => Boolean(getSlotFile(files, id)));

  const updateSlotFile = useCallback((slotId: EvidenceSlotId, file: PendingSupportFile | null) => {
    onChange(prev => setSlotFile(prev, slotId, file));
  }, [onChange]);

  const openCamera = (slotId: EvidenceSlotId) => {
    if (disabled) return;
    if (!getSlotFile(files, slotId) && !isSlotUnlocked(files, slotId, slotOrder)) return;
    onCaptureStart?.();
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
      const prepared = await prepareSupportUploadFile(raw);
      const pending = createPendingSupportFile(prepared);
      updateSlotFile('video', pending);
      onFileReady?.(pending);
    } finally {
      setProcessing(false);
    }
  };

  const handlePhotoFile = async (slot: EvidencePhotoSlot, raw: File) => {
    const err = validateSupportFile(raw);
    if (err) throw new Error(err);
    const prepared = await prepareSupportUploadFile(raw);
    const pending = createPendingEvidencePhoto(prepared, slot);
    updateSlotFile(slot, pending);
    onFileReady?.(pending);
  };

  const removeSlot = (slotId: EvidenceSlotId) => {
    updateSlotFile(slotId, null);
    setSlotErrors(prev => ({ ...prev, [slotId]: undefined }));
  };

  const allFilled = filledSlots.length === visibleSlots.length;
  const nextSlot = firstMissingSlot(files, slotOrder);

  useEffect(() => {
    if (cameraOpen && allFilled && !processing) {
      setCameraOpen(false);
    }
  }, [cameraOpen, allFilled, processing]);

  return (
    <div className="support-evidence-picker">
      <div className="support-evidence-picker__header">
        <h4 className="support-evidence-picker__title">
          {videoOnly ? 'Complaint video' : 'Evidence'}
          <span className="form-label__required" aria-hidden> *</span>
        </h4>
        <p className="support-evidence-picker__subtitle text-muted text-sm">
          {videoOnly
            ? 'Upload a complaint video showing the fault.'
            : 'One by one: video, then serial / MAC ID, then product photo.'}
        </p>
      </div>

      <div className="support-evidence-picker__grid">
        {visibleSlots.map(slot => {
          const file = getSlotFile(files, slot.id);
          const unlocked = isSlotUnlocked(files, slot.id, slotOrder);
          const locked = !file && !unlocked;
          const current = !file && unlocked;
          return (
            <div
              key={slot.id}
              className={[
                'support-evidence-picker__cell',
                file ? 'support-evidence-picker__cell--filled' : '',
                locked ? 'support-evidence-picker__cell--locked' : '',
                current ? 'support-evidence-picker__cell--current' : '',
              ].filter(Boolean).join(' ')}
            >
              <button
                type="button"
                className="support-evidence-picker__cell-main"
                disabled={disabled || locked}
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
          onClick={() => openCamera(nextSlot)}
        >
          <Camera size={20} aria-hidden />
          {videoOnly ? 'Record complaint video' : ADD_EVIDENCE_LABEL[nextSlot]}
        </button>
      )}

      {cameraOpen && (
        <SupportEvidenceCamera
          initialSlot={cameraSlot}
          filledSlots={filledSlots}
          videoOnly={videoOnly}
          processing={processing}
          processingLabel={processingLabel}
          onClose={() => setCameraOpen(false)}
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
