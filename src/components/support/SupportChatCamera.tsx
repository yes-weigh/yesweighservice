import { useEffect, useRef, useState } from 'react';
import {
  Circle,
  FlipHorizontal2,
  Image as ImageIcon,
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
import { validateSupportFile } from '../../lib/supportAttachments';

type CameraMode = 'photo' | 'video';

interface SupportChatCameraProps {
  onClose: () => void;
  onSendFiles: (files: File[]) => void | Promise<void>;
  onPickGallery: () => void;
}

const MAX_RECORD_SECONDS = 120;
const HOLD_THRESHOLD_MS = 380;

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

export function SupportChatCamera({ onClose, onSendFiles, onPickGallery }: SupportChatCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pointerDownAtRef = useRef(0);
  const holdRecordingRef = useRef(false);
  const shutterPressedRef = useRef(false);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [mode, setMode] = useState<CameraMode>('photo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recentMedia = useRecentMedia();

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
    holdRecordingRef.current = false;
    shutterPressedRef.current = false;
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
      audio: true,
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
          setError('Could not open camera. Check permissions and try again.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode]);

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || loading || error) return;
    setLoading(true);
    try {
      const file = await capturePhotoFromVideo(video);
      await pushRecentMedia(file);
      cleanup();
      onClose();
      await onSendFiles([file]);
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
      holdRecordingRef.current = false;
      setRecording(false);
      setRecordSeconds(0);

      if (send) {
        const mimeType = blob.type || recorder.mimeType || 'video/webm';
        const rawFile = createVideoFileFromBlob(blob, mimeType);
        const file = await prepareVideoFileForUpload(rawFile, durationMs);
        await pushRecentMedia(file);
        cleanup();
        onClose();
        await onSendFiles([file]);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save video.');
      cleanup();
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || recording) return;

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
    if (loading || error) return;
    shutterPressedRef.current = true;
    pointerDownAtRef.current = Date.now();

    if (mode === 'video') {
      if (!recording) startRecording();
      return;
    }

    holdTimerRef.current = window.setTimeout(() => {
      if (!shutterPressedRef.current || recording) return;
      holdRecordingRef.current = true;
      startRecording();
    }, HOLD_THRESHOLD_MS);
  };

  const onShutterPointerUp = () => {
    shutterPressedRef.current = false;

    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (mode === 'video') {
      if (recording) void stopRecording(true);
      return;
    }

    if (recording && holdRecordingRef.current) {
      void stopRecording(true);
      return;
    }

    if (!recording && Date.now() - pointerDownAtRef.current < HOLD_THRESHOLD_MS) {
      void capturePhoto();
    }
  };

  const sendRecent = async (file: File) => {
    const err = validateSupportFile(file);
    if (err) {
      window.alert(err);
      return;
    }
    cleanup();
    onClose();
    await onSendFiles([file]);
  };

  const modeTabs: { id: CameraMode; label: string }[] = [
    { id: 'video', label: 'Video' },
    { id: 'photo', label: 'Photo' },
  ];

  return (
    <div className="support-chat__camera" role="dialog" aria-label="Camera">
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
          </>
        )}
      </div>

      <div className="support-chat__camera-bottom">
        {recentMedia.length > 0 && (
          <div className="support-chat__camera-recent">
            <div className="support-chat__camera-recent-scroll">
              <button
                type="button"
                className="support-chat__camera-recent-thumb support-chat__camera-recent-thumb--gallery"
                aria-label="Open gallery"
                onClick={() => {
                  cleanup();
                  onClose();
                  onPickGallery();
                }}
              >
                <ImageIcon size={22} />
              </button>
              {recentMedia.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="support-chat__camera-recent-thumb"
                  onClick={() => void sendRecent(item.file)}
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
        )}

        <div className="support-chat__camera-controls">
          <span className="support-chat__camera-controls-spacer" aria-hidden />

          <button
            type="button"
            className={`support-chat__camera-shutter${recording ? ' support-chat__camera-shutter--recording' : ''}${mode === 'video' && recording ? ' support-chat__camera-shutter--stop' : ''}`}
            disabled={loading || Boolean(error)}
            aria-label={mode === 'photo' ? 'Take photo or hold to record video' : 'Record video'}
            onPointerDown={onShutterPointerDown}
            onPointerUp={onShutterPointerUp}
            onPointerLeave={onShutterPointerUp}
            onPointerCancel={onShutterPointerUp}
          />

          <button
            type="button"
            className="support-chat__camera-flip"
            aria-label="Switch camera"
            disabled={loading || recording}
            onClick={() => setFacingMode(f => (f === 'environment' ? 'user' : 'environment'))}
          >
            <FlipHorizontal2 size={22} />
          </button>
        </div>

        <div className="support-chat__camera-modes" role="tablist" aria-label="Camera mode">
          {modeTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              className={`support-chat__camera-mode-tab${mode === tab.id ? ' support-chat__camera-mode-tab--active' : ''}`}
              disabled={recording}
              onClick={() => setMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
