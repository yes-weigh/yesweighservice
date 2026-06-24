import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, ImagePlus, Loader2, Square, X } from 'lucide-react';
import {
  createPendingEvidencePhoto,
  createPendingSupportFile,
  validateSupportFile,
  type EvidencePhotoSlot,
  type PendingSupportFile,
} from '../../lib/supportAttachments';

const MAX_VIDEO_SECONDS = 60;

type EvidenceSlotId = 'video' | EvidencePhotoSlot;

interface SupportEvidencePickerProps {
  files: PendingSupportFile[];
  onChange: (files: PendingSupportFile[]) => void;
  disabled?: boolean;
}

interface SlotConfig {
  id: EvidenceSlotId;
  label: string;
  hint: string;
  kind: 'video' | 'image';
  required?: boolean;
}

const EVIDENCE_SLOTS: SlotConfig[] = [
  {
    id: 'video',
    label: 'Video evidence',
    hint: '30 sec – 2 min · show product condition and issue',
    kind: 'video',
    required: true,
  },
  {
    id: 'serial',
    label: 'Serial number / MAC ID',
    hint: 'Serial, model, and identification label clearly visible',
    kind: 'image',
    required: true,
  },
  {
    id: 'label',
    label: 'Product label',
    hint: 'YESWEIGH label, model, and part number',
    kind: 'image',
    required: true,
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
  if (previous) URL.revokeObjectURL(previous.previewUrl);

  const without = slotId === 'video'
    ? files.filter(item => item.kind !== 'video')
    : files.filter(item => !(item.kind === 'image' && item.photoSlot === slotId));

  if (!file) return without;
  return [...without, file];
}

async function capturePhotoFromVideo(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('Could not capture photo.');

  return new File([blob], `evidence-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function freezeUrlFromFile(file: File): string {
  return URL.createObjectURL(file);
}

interface EvidenceMediaSlotProps {
  config: SlotConfig;
  file: PendingSupportFile | null;
  previewOpen: boolean;
  previewLoading: boolean;
  disabled?: boolean;
  processing: boolean;
  captureFreezeUrl: string | null;
  previewStream: MediaStream | null;
  recording: boolean;
  recordSeconds: number;
  error?: string;
  onOpenPreview: () => void;
  onRemove: () => void;
  onPickFile: (file: File) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCapturePhoto: () => void;
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
}

const EvidenceMediaSlot: React.FC<EvidenceMediaSlotProps> = ({
  config,
  file,
  previewOpen,
  previewLoading,
  disabled,
  processing,
  captureFreezeUrl,
  previewStream,
  recording,
  recordSeconds,
  error,
  onOpenPreview,
  onRemove,
  onPickFile,
  onStartRecording,
  onStopRecording,
  onCapturePhoto,
  previewVideoRef,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isVideo = config.kind === 'video';
  const showFrozenCapture = !file && Boolean(captureFreezeUrl);
  const showLivePreview = !file && previewOpen && previewStream && !showFrozenCapture;

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !showLivePreview) return;
    video.srcObject = previewStream;
    video.muted = true;
    void video.play().catch(() => undefined);
  }, [previewStream, showLivePreview, previewVideoRef]);

  return (
    <section
      className={`evidence-media-slot${previewOpen ? ' evidence-media-slot--active' : ''}${file ? ' evidence-media-slot--filled' : ''}`}
      role="group"
      aria-label={config.label}
    >
      <div className="evidence-media-slot__head">
        <h4 className="evidence-media-slot__label">
          {config.label}
          {config.required && <span className="form-label__required" aria-hidden> *</span>}
        </h4>
        <p className="evidence-media-slot__hint text-muted text-sm">{config.hint}</p>
      </div>

      <div className="evidence-media-slot__frame">
        {file ? (
          <>
            {file.kind === 'video' ? (
              <video src={file.previewUrl} className="evidence-media-slot__media" controls />
            ) : (
              <img src={file.previewUrl} alt="" className="evidence-media-slot__media" />
            )}
            {file.gpsLabel && (
              <span className="evidence-media-slot__gps">{file.gpsLabel}</span>
            )}
            <button
              type="button"
              className="evidence-media-slot__remove"
              aria-label={`Remove ${config.label}`}
              disabled={disabled}
              onClick={e => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X size={14} />
            </button>
          </>
        ) : showFrozenCapture ? (
          <>
            <img
              src={captureFreezeUrl!}
              alt=""
              className="evidence-media-slot__media evidence-media-slot__media--frozen"
            />
            <div className="evidence-media-slot__processing-overlay" aria-live="polite">
              <Loader2 size={22} className="spin-icon" aria-hidden />
              <span>Adding GPS tag…</span>
            </div>
          </>
        ) : showLivePreview ? (
          <>
            <video
              ref={previewVideoRef}
              className="evidence-media-slot__media"
              muted
              playsInline
              autoPlay
            />
            {recording && (
              <span className="evidence-media-slot__recording-badge">
                <Circle size={10} fill="currentColor" />
                {recordSeconds}s / {MAX_VIDEO_SECONDS}s
              </span>
            )}
            <div className="evidence-media-slot__toolbar">
              <button
                type="button"
                className="evidence-media-slot__pick"
                aria-label={`Choose ${isVideo ? 'video' : 'photo'} from gallery`}
                disabled={disabled || processing || recording}
                onClick={e => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <ImagePlus size={22} />
              </button>

              {isVideo ? (
                recording ? (
                  <button
                    type="button"
                    className="evidence-media-slot__shutter evidence-media-slot__shutter--stop"
                    aria-label="Stop recording"
                    disabled={disabled}
                    onClick={e => {
                      e.stopPropagation();
                      onStopRecording();
                    }}
                  >
                    <Square size={18} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="evidence-media-slot__shutter evidence-media-slot__shutter--record"
                    aria-label="Start recording"
                    disabled={disabled || processing}
                    onClick={e => {
                      e.stopPropagation();
                      onStartRecording();
                    }}
                  />
                )
              ) : (
                <button
                  type="button"
                  className="evidence-media-slot__shutter evidence-media-slot__shutter--photo"
                  aria-label="Take photo"
                  disabled={disabled || processing}
                  onClick={e => {
                    e.stopPropagation();
                    onCapturePhoto();
                  }}
                />
              )}
            </div>
          </>
        ) : previewOpen && previewLoading ? (
          <div className="evidence-media-slot__placeholder">
            <p className="text-muted text-sm">Starting camera…</p>
          </div>
        ) : (
          <div className="evidence-media-slot__placeholder">
            <button
              type="button"
              className="evidence-media-slot__open-camera"
              disabled={disabled || processing}
              onClick={onOpenPreview}
            >
              <Camera size={20} aria-hidden />
              Open camera
            </button>
            <button
              type="button"
              className="evidence-media-slot__pick evidence-media-slot__pick--solo"
              aria-label={`Choose ${isVideo ? 'video' : 'photo'} from gallery`}
              disabled={disabled || processing}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={22} />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={isVideo ? 'video/*' : 'image/*'}
          hidden
          onChange={e => {
            const picked = e.target.files?.[0];
            if (picked) onPickFile(picked);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {error && <p className="evidence-media-slot__error text-sm">{error}</p>}
      {processing && !captureFreezeUrl && (
        <p className="evidence-media-slot__status text-muted text-sm">Processing…</p>
      )}
    </section>
  );
};

export const SupportEvidencePicker: React.FC<SupportEvidencePickerProps> = ({
  files,
  onChange,
  disabled,
}) => {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<number | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordTickRef = useRef<number | null>(null);

  const [previewSlot, setPreviewSlot] = useState<EvidenceSlotId | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [processingSlot, setProcessingSlot] = useState<EvidenceSlotId | null>(null);
  const [captureFreeze, setCaptureFreeze] = useState<{ slotId: EvidenceSlotId; url: string } | null>(null);
  const captureFreezeRef = useRef(captureFreeze);
  captureFreezeRef.current = captureFreeze;
  const [slotErrors, setSlotErrors] = useState<Partial<Record<EvidenceSlotId, string>>>({});
  const [cameraError, setCameraError] = useState('');

  const previewConfig = previewSlot
    ? EVIDENCE_SLOTS.find(slot => slot.id === previewSlot) ?? null
    : null;

  const clearRecordTimers = useCallback(() => {
    if (recordTimeoutRef.current !== null) {
      window.clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    if (recordTickRef.current !== null) {
      window.clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    recordStartedAtRef.current = null;
    setRecordSeconds(0);
  }, []);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    setPreviewStream(null);
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearRecordTimers();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      setRecording(false);
    }
  }, [clearRecordTimers]);

  useEffect(() => () => {
    clearRecordTimers();
    stopMediaStream();
    if (captureFreezeRef.current) URL.revokeObjectURL(captureFreezeRef.current.url);
  }, [clearRecordTimers, stopMediaStream]);

  const clearCaptureFreeze = useCallback(() => {
    setCaptureFreeze(prev => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  useEffect(() => {
    if (disabled || !previewSlot || !previewConfig || recording) {
      if (!recording) stopMediaStream();
      setPreviewLoading(false);
      return undefined;
    }

    const slotFile = getSlotFile(files, previewSlot);
    if (slotFile) {
      stopMediaStream();
      setPreviewLoading(false);
      return undefined;
    }

    if (processingSlot === previewSlot || captureFreeze?.slotId === previewSlot) {
      return undefined;
    }

    let cancelled = false;
    setCameraError('');
    setPreviewLoading(true);

    const constraints: MediaStreamConstraints = previewConfig.kind === 'video'
      ? { video: { facingMode: { ideal: 'environment' } }, audio: true }
      : { video: { facingMode: { ideal: 'environment' } }, audio: false };

    void navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        stopMediaStream();
        mediaStreamRef.current = stream;
        setPreviewStream(stream);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError('Could not access camera. Use the gallery button to upload instead.');
          setPreviewSlot(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewConfig, previewSlot, disabled, recording, files, processingSlot, captureFreeze, stopMediaStream]);

  const closePreview = useCallback(() => {
    stopRecording();
    stopMediaStream();
    setPreviewSlot(null);
    setPreviewLoading(false);
  }, [stopMediaStream, stopRecording]);

  const updateSlotFile = useCallback((slotId: EvidenceSlotId, file: PendingSupportFile | null) => {
    onChange(setSlotFile(files, slotId, file));
  }, [files, onChange]);

  const handlePickFile = async (slotId: EvidenceSlotId, picked: File) => {
    const config = EVIDENCE_SLOTS.find(slot => slot.id === slotId)!;
    const err = validateSupportFile(picked);
    if (err) {
      setSlotErrors(prev => ({ ...prev, [slotId]: err }));
      return;
    }
    if (config.kind === 'video' && !picked.type.startsWith('video/')) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'Please choose a video file.' }));
      return;
    }
    if (config.kind === 'image' && !picked.type.startsWith('image/')) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'Please choose an image file.' }));
      return;
    }

    setSlotErrors(prev => ({ ...prev, [slotId]: undefined }));
    setProcessingSlot(slotId);
    try {
      if (config.kind === 'video') {
        stopRecording();
        closePreview();
        updateSlotFile(slotId, createPendingSupportFile(picked));
      } else {
        const pending = await createPendingEvidencePhoto(picked, slotId as EvidencePhotoSlot);
        updateSlotFile(slotId, pending);
        if (previewSlot === slotId) closePreview();
      }
    } catch (pickErr) {
      setSlotErrors(prev => ({
        ...prev,
        [slotId]: pickErr instanceof Error ? pickErr.message : 'Could not add file.',
      }));
    } finally {
      setProcessingSlot(null);
    }
  };

  const startRecording = () => {
    if (disabled || recording || previewSlot !== 'video' || getSlotFile(files, 'video')) return;
    const stream = mediaStreamRef.current;
    if (!stream) {
      setSlotErrors(prev => ({ ...prev, video: 'Camera is not ready yet.' }));
      return;
    }

    setSlotErrors(prev => ({ ...prev, video: undefined }));

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    chunksRef.current = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const file = new File([blob], `evidence-${Date.now()}.webm`, {
        type: blob.type || 'video/webm',
        lastModified: Date.now(),
      });
      updateSlotFile('video', createPendingSupportFile(file));
      clearRecordTimers();
      stopMediaStream();
      setPreviewSlot(null);
      setRecording(false);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    recordStartedAtRef.current = Date.now();
    recordTickRef.current = window.setInterval(() => {
      if (!recordStartedAtRef.current) return;
      setRecordSeconds(Math.min(
        MAX_VIDEO_SECONDS,
        Math.floor((Date.now() - recordStartedAtRef.current) / 1000),
      ));
    }, 250);
    recordTimeoutRef.current = window.setTimeout(() => stopRecording(), MAX_VIDEO_SECONDS * 1000);
  };

  const capturePhoto = async (slotId: EvidencePhotoSlot) => {
    if (disabled || processingSlot) return;
    const video = previewVideoRef.current;
    if (!video || !mediaStreamRef.current) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'Camera is not ready yet.' }));
      return;
    }

    setSlotErrors(prev => ({ ...prev, [slotId]: undefined }));

    let captured: File;
    try {
      captured = await capturePhotoFromVideo(video);
    } catch (err) {
      setSlotErrors(prev => ({
        ...prev,
        [slotId]: err instanceof Error ? err.message : 'Could not capture photo.',
      }));
      return;
    }

    clearCaptureFreeze();
    setCaptureFreeze({ slotId, url: freezeUrlFromFile(captured) });
    stopMediaStream();
    setProcessingSlot(slotId);

    try {
      const pending = await createPendingEvidencePhoto(captured, slotId);
      updateSlotFile(slotId, pending);
      clearCaptureFreeze();
      closePreview();
    } catch (err) {
      clearCaptureFreeze();
      setSlotErrors(prev => ({
        ...prev,
        [slotId]: err instanceof Error ? err.message : 'Could not capture photo.',
      }));
    } finally {
      setProcessingSlot(null);
    }
  };

  return (
    <div className="support-evidence-picker">
      {cameraError && !previewStream && (
        <p className="support-evidence-picker__camera-error text-sm">{cameraError}</p>
      )}

      {EVIDENCE_SLOTS.map(config => {
        const slotFile = getSlotFile(files, config.id);
        const isPreviewOpen = previewSlot === config.id && !slotFile;
        const freezeUrl = captureFreeze?.slotId === config.id ? captureFreeze.url : null;

        return (
          <EvidenceMediaSlot
            key={config.id}
            config={config}
            file={slotFile}
            previewOpen={isPreviewOpen || Boolean(freezeUrl)}
            previewLoading={isPreviewOpen && previewLoading && !freezeUrl}
            disabled={disabled}
            processing={processingSlot === config.id}
            captureFreezeUrl={freezeUrl}
            previewStream={isPreviewOpen ? previewStream : null}
            recording={recording && config.id === 'video' && isPreviewOpen}
            recordSeconds={recordSeconds}
            error={slotErrors[config.id]}
            onOpenPreview={() => {
              if (disabled || slotFile) return;
              if (previewSlot !== config.id) {
                stopRecording();
                stopMediaStream();
              }
              setPreviewSlot(config.id);
            }}
            onRemove={() => {
              if (config.id === 'video') stopRecording();
              if (captureFreeze?.slotId === config.id) clearCaptureFreeze();
              if (previewSlot === config.id) closePreview();
              updateSlotFile(config.id, null);
              setSlotErrors(prev => ({ ...prev, [config.id]: undefined }));
            }}
            onPickFile={file => void handlePickFile(config.id, file)}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onCapturePhoto={
              config.kind === 'image'
                ? () => void capturePhoto(config.id as EvidencePhotoSlot)
                : () => undefined
            }
            previewVideoRef={previewVideoRef}
          />
        );
      })}
    </div>
  );
};

export { pendingFilesToUpload, cleanupPendingFiles } from './SupportAttachmentPicker';
