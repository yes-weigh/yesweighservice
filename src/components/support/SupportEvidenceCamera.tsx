import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Circle,
  FlipHorizontal2,
  Image as ImageIcon,
  Loader2,
  X,
} from 'lucide-react';
import {
  capturePhotoFromVideo,
  createVideoFileFromBlob,
  createVideoMediaRecorder,
  finalizeMediaRecorder,
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
const LONG_PRESS_MS = 380;

interface SupportEvidenceCameraProps {
  initialSlot: EvidenceSlotId;
  filledSlots: EvidenceSlotId[];
  processing?: boolean;
  processingLabel?: string;
  onClose: () => void;
  onPickGallery: (slot: EvidenceSlotId) => void;
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
  onPickGallery,
  onVideoFile,
  onPhotoFile,
}: SupportEvidenceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pointerDownAtRef = useRef(0);
  const longPressStartedRef = useRef(false);
  const stopOnUpRef = useRef(false);
  const recordingRef = useRef(false);

  const [activeSlot, setActiveSlot] = useState<EvidenceSlotId>(initialSlot);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recentMedia = useRecentMedia();

  const isPhotoSlot = activeSlot === 'serial' || activeSlot === 'label';
  const filledSet = new Set(filledSlots);
  recordingRef.current = recording;

  const clearTimers = () => {
    if (tickRef.current != null) window.clearInterval(tickRef.current);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
    tickRef.current = null;
    timeoutRef.current = null;
    holdTimerRef.current = null;
  };

  const stopStream = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
  };

  const cleanup = () => {
    clearTimers();
    recorderRef.current = null;
    chunksRef.current = [];
    longPressStartedRef.current = false;
    stopOnUpRef.current = false;
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
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not open camera. Use gallery from the strip below.');
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

  const capturePhoto = async () => {
    if (!isPhotoSlot || processing) return;
    const video = videoRef.current;
    if (!video || loading || error || recordingRef.current) return;
    setLoading(true);
    try {
      const file = await capturePhotoFromVideo(video);
      await pushRecentMedia(file);
      await onPhotoFile(activeSlot, file);
      advanceAfterCapture(activeSlot);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture photo.');
      setLoading(false);
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
      longPressStartedRef.current = false;
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

    tickRef.current = window.setInterval(() => {
      setRecordSeconds(prev => prev + 1);
    }, 1000);

    timeoutRef.current = window.setTimeout(() => {
      void stopRecording(true);
    }, MAX_RECORD_SECONDS * 1000);
  };

  const onShutterPointerDown = () => {
    if (loading || error || processing) return;
    pointerDownAtRef.current = Date.now();
    longPressStartedRef.current = false;
    stopOnUpRef.current = false;

    if (activeSlot === 'video') {
      if (recordingRef.current) {
        stopOnUpRef.current = true;
        return;
      }
      holdTimerRef.current = window.setTimeout(() => {
        if (recordingRef.current) return;
        longPressStartedRef.current = true;
        startRecording();
      }, LONG_PRESS_MS);
      return;
    }

    // Photo slots: tap only — no hold-to-record
  };

  const onShutterPointerUp = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (activeSlot === 'video') {
      if (recordingRef.current) {
        if (stopOnUpRef.current) void stopRecording(true);
        stopOnUpRef.current = false;
        return;
      }
      if (longPressStartedRef.current) {
        longPressStartedRef.current = false;
        return;
      }
      return;
    }

    if (!recordingRef.current) {
      void capturePhoto();
    }
  };

  const useRecentFile = async (file: File) => {
    const err = validateSupportFile(file);
    if (err) {
      window.alert(err);
      return;
    }
    try {
      const retained = await retainFileCopy(file);
      if (activeSlot === 'video') {
        if (!isVideoFile(retained)) {
          window.alert('Choose a video for the video evidence slot.');
          return;
        }
        await onVideoFile(retained);
        advanceAfterCapture('video');
      } else if (isImageFile(retained)) {
        await onPhotoFile(activeSlot, retained);
        advanceAfterCapture(activeSlot);
      } else {
        window.alert('Choose a photo for this slot.');
      }
    } catch (pickErr) {
      window.alert(pickErr instanceof Error ? pickErr.message : 'Could not use file.');
    }
  };

  const filteredRecent = recentMedia.filter(item =>
    activeSlot === 'video' ? item.kind === 'video' : item.kind === 'image',
  );

  const shutterLabel = activeSlot === 'video'
    ? (recording ? 'Stop recording' : 'Hold to record video')
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
              className="support-chat__camera-preview"
              muted
              playsInline
              autoPlay
            />
            {recording && (
              <span className="support-chat__camera-rec-badge">
                <Circle size={10} fill="currentColor" />
                {formatRecordTime(recordSeconds)}
              </span>
            )}
            {processing && (
              <div className="support-evidence-camera__processing" aria-live="polite">
                <Loader2 size={28} className="spin-icon" aria-hidden />
                <span>{processingLabel}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="support-chat__camera-bottom">
        <div className="support-chat__camera-recent">
          <div className="support-chat__camera-recent-scroll">
            <button
              type="button"
              className="support-chat__camera-recent-thumb support-chat__camera-recent-thumb--gallery"
              aria-label="Open gallery"
              disabled={processing}
              onClick={() => onPickGallery(activeSlot)}
            >
              <ImageIcon size={22} />
            </button>
            {filteredRecent.map(item => (
              <button
                key={item.id}
                type="button"
                className="support-chat__camera-recent-thumb"
                disabled={processing}
                onClick={() => void useRecentFile(item.file)}
              >
                {item.kind === 'video' ? (
                  <video src={item.previewUrl} muted playsInline preload="metadata" />
                ) : (
                  <img src={item.previewUrl} alt="" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="support-chat__camera-controls">
          <span className="support-chat__camera-controls-spacer" aria-hidden />

          <button
            type="button"
            className={`support-chat__camera-shutter${recording ? ' support-chat__camera-shutter--recording support-chat__camera-shutter--stop' : ''}`}
            disabled={loading || Boolean(error) || processing}
            aria-label={shutterLabel}
            onPointerDown={onShutterPointerDown}
            onPointerUp={onShutterPointerUp}
            onPointerCancel={onShutterPointerUp}
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
