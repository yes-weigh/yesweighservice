import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Circle,
  FlipHorizontal2,
  Images,
  Loader2,
  X,
} from 'lucide-react';
import {
  createVideoFileFromBlob,
  createVideoMediaRecorder,
  finalizeMediaRecorder,
  freezeVideoFrame,
  prepareVideoFileForUpload,
  recommendedRecorderTimeslice,
  stopMediaStream,
} from '../../lib/captureMedia';
import { cameraPermissionErrorMessage, getEvidenceCameraStream } from '../../lib/mediaPermissions';
import { pushRecentMedia } from '../../lib/recentMediaCache';
import { isImageFile, isVideoFile, retainFileCopy, validateSupportFile } from '../../lib/supportAttachments';
import type { EvidencePhotoSlot } from '../../lib/supportAttachments';

export type EvidenceSlotId = 'video' | EvidencePhotoSlot;

export const EVIDENCE_SLOT_ORDER: EvidenceSlotId[] = ['video', 'serial', 'label'];

const SLOT_TABS: Array<{ id: EvidenceSlotId; label: string; prompt: string; hint: string }> = [
  { id: 'video', label: 'Video', prompt: 'Step 1 of 3 · Record video', hint: '30 seconds to 2 minutes' },
  { id: 'serial', label: 'Serial', prompt: 'Step 2 of 3 · Serial / MAC ID', hint: 'Photo of the identification label' },
  { id: 'label', label: 'Product', prompt: 'Step 3 of 3 · Product photo', hint: 'Photo of the product' },
];

const VIDEO_ONLY_TAB: (typeof SLOT_TABS)[number] = {
  id: 'video',
  label: 'Video',
  prompt: 'Record complaint video',
  hint: '30 seconds to 2 minutes',
};

const MAX_RECORD_SECONDS = 120;

interface SupportEvidenceCameraProps {
  initialSlot: EvidenceSlotId;
  filledSlots: EvidenceSlotId[];
  processing?: boolean;
  processingLabel?: string;
  videoOnly?: boolean;
  onClose: () => void;
  onVideoFile: (file: File) => Promise<void>;
  onPhotoFile: (slot: EvidencePhotoSlot, file: File) => Promise<void>;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SupportEvidenceCamera({
  initialSlot,
  filledSlots,
  processing = false,
  processingLabel = 'Processing…',
  videoOnly = false,
  onClose,
  onVideoFile,
  onPhotoFile,
}: SupportEvidenceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);

  const [activeSlot, setActiveSlot] = useState<EvidenceSlotId>(initialSlot);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [frozenFrameUrl, setFrozenFrameUrl] = useState<string | null>(null);
  const [photoFlash, setPhotoFlash] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [pickError, setPickError] = useState('');

  const isPhotoSlot = activeSlot === 'serial' || activeSlot === 'label';
  const filledSet = new Set(filledSlots);
  const visibleTabs = videoOnly ? [VIDEO_ONLY_TAB] : SLOT_TABS;
  const activeTab = visibleTabs.find(tab => tab.id === activeSlot) ?? visibleTabs[0];
  recordingRef.current = recording;

  const clearTimers = () => {
    if (tickRef.current != null) window.clearInterval(tickRef.current);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
    tickRef.current = null;
    timeoutRef.current = null;
    flashTimerRef.current = null;
  };

  const stopStream = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
  };

  const cleanup = () => {
    clearTimers();
    recorderRef.current = null;
    chunksRef.current = [];
    stopStream();
    setRecording(false);
    setRecordSeconds(0);
  };

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    stopStream();

    void getEvidenceCameraStream(facingMode, activeSlot === 'video')
      .then(stream => {
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          void video.play().catch(() => undefined);
        }
        setFrozenFrameUrl(null);
        setPhotoSaved(false);
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) {
          setError(cameraPermissionErrorMessage(
            err,
            'Could not open camera. Tap the gallery button to choose a file.',
          ));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, activeSlot]);

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const advanceAfterCapture = (capturedSlot: EvidenceSlotId) => {
    if (videoOnly) return;
    const nowFilled = new Set([...filledSlots, capturedSlot]);
    const nextEmpty = EVIDENCE_SLOT_ORDER.find(slot => !nowFilled.has(slot));
    if (nextEmpty) {
      setFrozenFrameUrl(null);
      setPhotoSaved(false);
      setActiveSlot(nextEmpty);
    }
  };

  const capturePhoto = () => {
    if (!isPhotoSlot || processing || capturingPhoto) return;
    const video = videoRef.current;
    if (!video || loading || error || recordingRef.current) return;

    setCapturingPhoto(true);
    const slot = activeSlot as EvidencePhotoSlot;

    try {
      const frame = freezeVideoFrame(video);
      setFrozenFrameUrl(frame.dataUrl);
      setPhotoFlash(true);
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setPhotoFlash(false), 200);
      setPhotoSaved(true);

      void frame.toFile()
        .then(file => {
          void pushRecentMedia(file);
          return onPhotoFile(slot, file);
        })
        .then(() => {
          window.setTimeout(() => advanceAfterCapture(slot), 450);
        })
        .catch(err => {
          setFrozenFrameUrl(null);
          setPhotoSaved(false);
          setError(err instanceof Error ? err.message : 'Could not capture photo.');
        })
        .finally(() => {
          setCapturingPhoto(false);
        });
    } catch (err) {
      setCapturingPhoto(false);
      setFrozenFrameUrl(null);
      setPhotoSaved(false);
      setError(err instanceof Error ? err.message : 'Could not capture photo.');
    }
  };

  const stopRecording = async (send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    try {
      const durationMs = Math.max(recordSeconds, 1) * 1000;
      const blob = await finalizeMediaRecorder(recorder, chunksRef.current);
      clearTimers();
      chunksRef.current = [];
      recorderRef.current = null;
      setRecording(false);
      setRecordSeconds(0);

      if (send) {
        const mimeType = blob.type || recorder.mimeType || 'video/webm';
        const rawFile = createVideoFileFromBlob(blob, mimeType);
        const file = await prepareVideoFileForUpload(rawFile, durationMs);
        await pushRecentMedia(file);
        await onVideoFile(file);
        setPhotoSaved(true);
        window.setTimeout(() => advanceAfterCapture('video'), 450);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save video.');
      cleanup();
    }
  };

  const startRecording = () => {
    if (activeSlot !== 'video') return;
    const stream = streamRef.current;
    if (!stream || recordingRef.current) return;

    let recorder: MediaRecorder;
    try {
      recorder = createVideoMediaRecorder(stream);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video recording is not supported.');
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;
    const timeslice = recommendedRecorderTimeslice(recorder.mimeType);
    if (timeslice) recorder.start(timeslice);
    else recorder.start();
    setRecording(true);
    setPhotoSaved(false);
    setRecordSeconds(0);

    tickRef.current = window.setInterval(() => {
      setRecordSeconds(prev => prev + 1);
    }, 1000);

    timeoutRef.current = window.setTimeout(() => {
      void stopRecording(true);
    }, MAX_RECORD_SECONDS * 1000);
  };

  const onShutterClick = () => {
    if (loading || error || processing) return;

    if (activeSlot === 'video') {
      if (recordingRef.current) void stopRecording(true);
      else startRecording();
      return;
    }

    if (!recordingRef.current) capturePhoto();
  };

  useEffect(() => {
    setPickError('');
  }, [activeSlot]);

  const applySelectedFile = async (file: File) => {
    const err = validateSupportFile(file);
    if (err) {
      setPickError(err);
      return;
    }
    setPickError('');
    try {
      const retained = await retainFileCopy(file);
      if (activeSlot === 'video') {
        if (!isVideoFile(retained)) {
          setPickError('Choose a video for the video evidence slot.');
          return;
        }
        await onVideoFile(retained);
        setPhotoSaved(true);
        window.setTimeout(() => advanceAfterCapture('video'), 450);
      } else if (isImageFile(retained)) {
        await onPhotoFile(activeSlot, retained);
        setPhotoSaved(true);
        window.setTimeout(() => advanceAfterCapture(activeSlot), 450);
      } else {
        setPickError('Choose a photo for this slot.');
        return;
      }
      void pushRecentMedia(retained);
    } catch (pickErr) {
      setPickError(pickErr instanceof Error ? pickErr.message : 'Could not use file.');
    }
  };

  const handleGalleryInputChange = (picked: FileList | null) => {
    const file = picked?.[0];
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (!file) return;
    void applySelectedFile(file);
  };

  const openDeviceGallery = () => {
    if (loading || processing || recordingRef.current) return;
    setPickError('');
    galleryInputRef.current?.click();
  };

  const galleryAccept = activeSlot === 'video'
    ? 'video/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v'
    : 'image/*,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

  const shutterLabel = activeSlot === 'video'
    ? (recording ? 'Stop recording' : 'Start recording')
    : 'Take photo';

  return (
    <div className="support-chat__camera support-evidence-camera" role="dialog" aria-label="Evidence camera">
      <div className="support-chat__camera-top">
        <button type="button" className="support-chat__camera-top-btn" onClick={handleClose} aria-label="Close">
          <X size={22} />
        </button>
      </div>

      <div className="support-chat__camera-body">
        {error ? (
          <p className="support-chat__camera-error">{error}</p>
        ) : (
          <>
            <video
              ref={videoRef}
              className={`support-chat__camera-preview${frozenFrameUrl ? ' support-evidence-camera__preview--hidden' : ''}`}
              muted
              playsInline
              autoPlay
            />
            {frozenFrameUrl && (
              <img
                src={frozenFrameUrl}
                alt=""
                className="support-chat__camera-preview support-evidence-camera__frozen-frame"
              />
            )}
            {photoFlash && <div className="support-evidence-camera__flash" aria-hidden />}
            {recording && (
              <span className="support-chat__camera-rec-badge">
                <Circle size={10} fill="currentColor" />
                {formatRecordTime(recordSeconds)}
              </span>
            )}
            {photoSaved && !recording && (
              <span className="support-evidence-camera__saved-badge">
                <Check size={14} aria-hidden />
                {isPhotoSlot ? 'Photo saved' : 'Video saved'}
              </span>
            )}
            <div className="support-evidence-camera__prompt">
              <strong>{activeTab.prompt}</strong>
              <span>{activeTab.hint}</span>
            </div>
            {processing && (
              <div className="support-evidence-camera__processing" aria-live="polite">
                <Loader2 size={28} className="spin-icon" aria-hidden />
                <span>{processingLabel}</span>
              </div>
            )}
            {pickError && !processing && (
              <p className="support-evidence-camera__pick-error" role="alert">{pickError}</p>
            )}
          </>
        )}
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept={galleryAccept}
        hidden
        onChange={e => handleGalleryInputChange(e.target.files)}
      />

      <div className="support-chat__camera-bottom">
        <div className="support-chat__camera-controls">
          <button
            type="button"
            className="support-chat__camera-flip support-evidence-camera__gallery-btn"
            aria-label={activeSlot === 'video' ? 'Choose video from gallery' : 'Choose photo from gallery'}
            disabled={loading || recording || processing}
            onClick={openDeviceGallery}
          >
            <Images size={22} />
          </button>

          <button
            type="button"
            className={`support-chat__camera-shutter${recording ? ' support-chat__camera-shutter--recording support-chat__camera-shutter--stop' : ''}`}
            disabled={loading || Boolean(error) || processing || capturingPhoto}
            aria-label={shutterLabel}
            onClick={onShutterClick}
          />

          <button
            type="button"
            className="support-chat__camera-flip"
            aria-label="Switch camera"
            disabled={loading || recording || processing}
            onClick={() => setFacingMode(f => (f === 'environment' ? 'user' : 'environment'))}
          >
            <FlipHorizontal2 size={22} />
          </button>
        </div>

        {!videoOnly && (
        <div className="support-chat__camera-modes support-evidence-camera__slots" aria-label="Evidence steps">
          {visibleTabs.map(tab => {
            const done = filledSet.has(tab.id);
            const current = activeSlot === tab.id;
            return (
              <span
                key={tab.id}
                className={`support-chat__camera-mode-tab${current ? ' support-chat__camera-mode-tab--active' : ''}${done ? ' support-evidence-camera__slot--done' : ''}${!current && !done ? ' support-evidence-camera__slot--locked' : ''}`}
                aria-current={current ? 'step' : undefined}
              >
                {done && !current && <Check size={14} aria-hidden />}
                {tab.label}
              </span>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
