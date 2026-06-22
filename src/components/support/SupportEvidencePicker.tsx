import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Info, Plus, Square, Video, X } from 'lucide-react';
import {
  MAX_EVIDENCE_PHOTOS,
  countEvidencePhotos,
  createPendingEvidencePhoto,
  createPendingSupportFile,
  validateSupportFile,
  type PendingSupportFile,
} from '../../lib/supportAttachments';

const MAX_VIDEO_SECONDS = 60;

interface SupportEvidencePickerProps {
  files: PendingSupportFile[];
  onChange: (files: PendingSupportFile[]) => void;
  disabled?: boolean;
}

export const SupportEvidencePicker: React.FC<SupportEvidencePickerProps> = ({
  files,
  onChange,
  disabled,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoFallbackRef = useRef<HTMLInputElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<number | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordTickRef = useRef<number | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [recorderError, setRecorderError] = useState('');

  const videoFile = useMemo(() => files.find(file => file.kind === 'video') ?? null, [files]);
  const photoFiles = useMemo(() => files.filter(file => file.kind === 'image'), [files]);
  const photosFull = photoFiles.length >= MAX_EVIDENCE_PHOTOS;

  useEffect(() => () => {
    clearRecordTimers();
    stopMediaStream();
  }, []);

  const clearRecordTimers = () => {
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
  };

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
  };

  const replaceVideo = (file: File) => {
    const err = validateSupportFile(file);
    if (err) {
      window.alert(err);
      return;
    }
    if (!file.type.startsWith('video/')) {
      window.alert('Please record or choose a video file.');
      return;
    }

    const withoutVideo = files.filter(item => item.kind !== 'video');
    if (videoFile) URL.revokeObjectURL(videoFile.previewUrl);
    onChange([...withoutVideo, createPendingSupportFile(file)]);
  };

  const addPhoto = async (picked: FileList | null) => {
    if (!picked?.length || disabled || processingPhoto) return;

    setProcessingPhoto(true);
    try {
      const next = [...files];
      for (const file of Array.from(picked)) {
        if (countEvidencePhotos(next) >= MAX_EVIDENCE_PHOTOS) break;
        const pending = await createPendingEvidencePhoto(file);
        next.push(pending);
      }
      onChange(next);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not add photo.');
    } finally {
      setProcessingPhoto(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    const target = files.find(file => file.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter(file => file.id !== id));
    if (target?.kind === 'video') {
      setRecorderError('');
    }
  };

  const startRecording = async () => {
    if (disabled || recording || videoFile) return;
    setRecorderError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
      mediaStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }

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
        replaceVideo(file);
        clearRecordTimers();
        stopMediaStream();
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
    } catch {
      setRecorderError('Could not access camera. Try uploading a video instead.');
      clearRecordTimers();
      stopMediaStream();
      setRecording(false);
    }
  };

  const stopRecording = () => {
    clearRecordTimers();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      stopMediaStream();
      setRecording(false);
    }
  };

  return (
    <div className="support-evidence-picker">
      <section className="support-evidence-picker__block">
        <h4 className="support-evidence-picker__label">
          Upload Evidence - Video (Mandatory)
          <span className="support-evidence-picker__asterisk" aria-hidden>*</span>
        </h4>

        {videoFile ? (
          <div className="support-evidence-picker__drop support-evidence-picker__drop--filled">
            <video
              src={videoFile.previewUrl}
              className="support-evidence-picker__drop-media"
              controls
            />
            <button
              type="button"
              className="support-evidence-picker__remove"
              aria-label="Remove video"
              onClick={() => removeFile(videoFile.id)}
            >
              <X size={14} />
            </button>
          </div>
        ) : recording ? (
          <div className="support-evidence-picker__drop support-evidence-picker__drop--recording">
            <video
              ref={liveVideoRef}
              className="support-evidence-picker__drop-media"
              muted
              playsInline
              autoPlay
            />
            <span className="support-evidence-picker__recording-badge">
              <Circle size={10} fill="currentColor" />
              {recordSeconds}s / {MAX_VIDEO_SECONDS}s
            </span>
            <button
              type="button"
              className="support-evidence-picker__stop"
              disabled={disabled}
              onClick={stopRecording}
            >
              <Square size={14} />
              Stop recording
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="support-evidence-picker__drop"
            disabled={disabled}
            onClick={() => void startRecording()}
          >
            <Video size={28} strokeWidth={1.75} className="support-evidence-picker__drop-icon" />
            <span className="support-evidence-picker__drop-action">Record Video</span>
            <span className="support-evidence-picker__drop-hint">Max 60 seconds with sound</span>
          </button>
        )}

        <p className="support-evidence-picker__tip">
          <span>Show product label and issue clearly</span>
          <Info size={14} className="support-evidence-picker__tip-icon" aria-hidden />
        </p>

        {recorderError && (
          <p className="support-evidence-picker__error text-sm">{recorderError}</p>
        )}

        {!videoFile && !recording && (
          <button
            type="button"
            className="support-evidence-picker__alt"
            disabled={disabled}
            onClick={() => videoFallbackRef.current?.click()}
          >
            Upload video instead
          </button>
        )}

        <input
          ref={videoFallbackRef}
          type="file"
          accept="video/*"
          capture="environment"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) replaceVideo(file);
            if (videoFallbackRef.current) videoFallbackRef.current.value = '';
          }}
        />
      </section>

      <section className="support-evidence-picker__block">
        <h4 className="support-evidence-picker__label">Upload Photos (Optional)</h4>

        <button
          type="button"
          className="support-evidence-picker__drop"
          disabled={disabled || processingPhoto || photosFull}
          onClick={() => galleryInputRef.current?.click()}
        >
          <Plus size={24} strokeWidth={2} className="support-evidence-picker__drop-icon" />
          <span className="support-evidence-picker__drop-action">Add Photos</span>
        </button>

        <button
          type="button"
          className="support-evidence-picker__alt"
          disabled={disabled || processingPhoto || photosFull}
          onClick={() => cameraInputRef.current?.click()}
        >
          Take photo with camera
        </button>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={e => void addPhoto(e.target.files)}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => void addPhoto(e.target.files)}
        />

        {processingPhoto && (
          <p className="support-evidence-picker__status text-muted text-sm">Adding GPS tag…</p>
        )}

        {photoFiles.length > 0 && (
          <ul className="support-evidence-picker__photos">
            {photoFiles.map(item => (
              <li key={item.id} className="support-evidence-picker__photo">
                <img src={item.previewUrl} alt="" className="support-evidence-picker__photo-media" />
                {item.gpsLabel && (
                  <span className="support-evidence-picker__gps-tag">{item.gpsLabel}</span>
                )}
                <button
                  type="button"
                  className="support-evidence-picker__remove"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeFile(item.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export { pendingFilesToUpload, cleanupPendingFiles } from './SupportAttachmentPicker';
