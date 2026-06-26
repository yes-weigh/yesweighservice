import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Circle,
  FlipHorizontal2,
  ImagePlus,
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
import { getRecentMedia, pushRecentMedia, subscribeRecentMedia } from '../../lib/recentMediaCache';
import { isImageFile, isVideoFile, retainFileCopy, validateSupportFile } from '../../lib/supportAttachments';
import type { EvidencePhotoSlot } from '../../lib/supportAttachments';

export type EvidenceSlotId = 'video' | EvidencePhotoSlot;

const SLOT_TABS: Array<{ id: EvidenceSlotId; label: string }> = [
  { id: 'video', label: 'Video' },
  { id: 'serial', label: 'Serial' },
  { id: 'label', label: 'Label' },
];

const MAX_RECORD_SECONDS = 120;

interface SupportEvidenceCameraProps {
  initialSlot: EvidenceSlotId;
  filledSlots: EvidenceSlotId[];
  processing?: boolean;
  processingLabel?: string;
  onClose: () => void;
  onVideoFile: (file: File) => Promise<void>;
  onPhotoFile: (slot: EvidencePhotoSlot, file: File) => Promise<void>;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function useRecentMedia() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeRecentMedia(() => setTick(t => t + 1)), []);
  return getRecentMedia();
}

export function SupportEvidenceCamera({
  initialSlot,
  filledSlots,
  processing = false,
  processingLabel = 'Processing…',
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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pickError, setPickError] = useState('');
  const recentMedia = useRecentMedia();

  const isPhotoSlot = activeSlot === 'serial' || activeSlot === 'label';
  const filledSet = new Set(filledSlots);
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

    const constraints: MediaStreamConstraints = {
      video: { facingMode: { ideal: facingMode } },
      audio: activeSlot === 'video',
    };

    void navigator.mediaDevices.getUserMedia(constraints)
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
      .catch(() => {
        if (!cancelled) {
          setError('Could not open camera. Tap the gallery button to choose a file.');
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
    const order: EvidenceSlotId[] = ['video', 'serial', 'label'];
    const nowFilled = new Set([...filledSlots, capturedSlot]);
    const nextEmpty = order.find(slot => !nowFilled.has(slot));
    if (nextEmpty) setActiveSlot(nextEmpty);
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
      advanceAfterCapture(slot);

      void frame.toFile()
        .then(file => {
          void pushRecentMedia(file);
          return onPhotoFile(slot, file);
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
        advanceAfterCapture('video');
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
    setRecordSeconds(0);
    setGalleryOpen(false);

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
    setGalleryOpen(false);
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
        advanceAfterCapture('video');
      } else if (isImageFile(retained)) {
        await onPhotoFile(activeSlot, retained);
        advanceAfterCapture(activeSlot);
      } else {
        setPickError('Choose a photo for this slot.');
        return;
      }
      void pushRecentMedia(retained);
      setGalleryOpen(false);
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
    if (processing || recordingRef.current) return;
    galleryInputRef.current?.click();
  };

  const filteredRecent = recentMedia.filter(item =>
    activeSlot === 'video' ? item.kind === 'video' : item.kind === 'image',
  );

  const galleryAccept = activeSlot === 'video'
    ? 'video/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v'
    : 'image/*,image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

  const galleryBrowseLabel = activeSlot === 'video' ? 'Choose video from gallery' : 'Choose photo from gallery';

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
                Photo saved
              </span>
            )}
            {processing && (
              <div className="support-evidence-camera__processing" aria-live="polite">
                <Loader2 size={28} className="spin-icon" aria-hidden />
                <span>{processingLabel}</span>
              </div>
            )}
            {galleryOpen && !processing && (
              <div className="support-evidence-camera__gallery" role="dialog" aria-label="Evidence gallery">
                <div className="support-evidence-camera__gallery-head">
                  <h3 className="support-evidence-camera__gallery-title">Gallery</h3>
                  <button
                    type="button"
                    className="support-chat__camera-top-btn"
                    aria-label="Close gallery"
                    disabled={processing}
                    onClick={() => setGalleryOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </div>
                <button
                  type="button"
                  className="support-evidence-camera__gallery-browse"
                  disabled={processing || recording}
                  onClick={openDeviceGallery}
                >
                  <ImagePlus size={22} aria-hidden />
                  {galleryBrowseLabel}
                </button>
                {pickError && (
                  <p className="support-evidence-camera__gallery-error" role="alert">{pickError}</p>
                )}
                {filteredRecent.length > 0 ? (
                  <div className="support-evidence-camera__gallery-grid">
                    {filteredRecent.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className="support-evidence-camera__gallery-item"
                        disabled={processing}
                        onClick={() => void applySelectedFile(item.file)}
                      >
                        {item.kind === 'video' ? (
                          <video src={item.previewUrl} muted playsInline preload="metadata" />
                        ) : (
                          <img src={item.previewUrl} alt="" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="support-evidence-camera__gallery-empty">
                    No recent {activeSlot === 'video' ? 'videos' : 'photos'} yet. Browse your gallery to add one.
                  </p>
                )}
              </div>
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
            className={`support-chat__camera-flip support-evidence-camera__gallery-btn${galleryOpen ? ' support-evidence-camera__gallery-btn--active' : ''}`}
            aria-label="Open gallery"
            aria-pressed={galleryOpen}
            disabled={loading || recording || processing}
            onClick={() => {
              setPickError('');
              setGalleryOpen(open => !open);
            }}
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

        <div className="support-chat__camera-modes support-evidence-camera__slots" role="tablist" aria-label="Evidence type">
          {SLOT_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeSlot === tab.id}
              className={`support-chat__camera-mode-tab${activeSlot === tab.id ? ' support-chat__camera-mode-tab--active' : ''}${filledSet.has(tab.id) ? ' support-evidence-camera__slot--done' : ''}`}
              disabled={recording || processing}
              onClick={() => setActiveSlot(tab.id)}
            >
              {filledSet.has(tab.id) && <Check size={14} aria-hidden />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
