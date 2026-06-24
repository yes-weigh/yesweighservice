import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Camera,
  Circle,
  Film,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Send,
  Smile,
  X,
} from 'lucide-react';
import {
  capturePhotoFromVideo,
  createVideoFileFromBlob,
  createVideoMediaRecorder,
  finalizeMediaRecorder,
  pickAudioMimeType,
  stopMediaStream,
  validateVideoBlob,
} from '../../lib/captureMedia';
import {
  MAX_SUPPORT_ATTACHMENTS,
  createPendingSupportFile,
  validateSupportFile,
  type PendingSupportFile,
} from '../../lib/supportAttachments';

export interface SupportChatComposerHandle {
  focusInput: () => void;
}

interface SupportChatComposerProps {
  text: string;
  onTextChange: (text: string) => void;
  pendingFiles: PendingSupportFile[];
  onPendingFilesChange: (files: PendingSupportFile[]) => void;
  onSend: () => void;
  onSendFiles: (files: File[]) => void;
  placeholder: string;
}

const MAX_VOICE_SECONDS = 120;
const MIN_VOICE_MS = 400;

function resizeComposer(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const SupportChatComposer = forwardRef<SupportChatComposerHandle, SupportChatComposerProps>(
  function SupportChatComposer(
    {
      text,
      onTextChange,
      pendingFiles,
      onPendingFilesChange,
      onSend,
      onSendFiles,
      placeholder,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const galleryRef = useRef<HTMLInputElement>(null);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const voiceChunksRef = useRef<Blob[]>([]);
    const voiceStartedAtRef = useRef(0);
    const voiceTickRef = useRef<number | null>(null);
    const voiceTimeoutRef = useRef<number | null>(null);
    const videoChunksRef = useRef<Blob[]>([]);
    const videoRecordTickRef = useRef<number | null>(null);
    const videoRecordTimeoutRef = useRef<number | null>(null);
    const attachMenuRef = useRef<HTMLDivElement>(null);

    const [attachMenuOpen, setAttachMenuOpen] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo');
    const [cameraLoading, setCameraLoading] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [recordingVideo, setRecordingVideo] = useState(false);
    const [videoRecordSeconds, setVideoRecordSeconds] = useState(0);
    const [recordingVoice, setRecordingVoice] = useState(false);
    const [voiceSeconds, setVoiceSeconds] = useState(0);
    const [voiceCancelled, setVoiceCancelled] = useState(false);

    const canSend = Boolean(text.trim() || pendingFiles.length > 0);
    const busy = cameraLoading || recordingVoice || recordingVideo;

    useImperativeHandle(ref, () => ({
      focusInput: () => inputRef.current?.focus(),
    }));

    const clearVoiceTimers = () => {
      if (voiceTickRef.current != null) window.clearInterval(voiceTickRef.current);
      if (voiceTimeoutRef.current != null) window.clearTimeout(voiceTimeoutRef.current);
      voiceTickRef.current = null;
      voiceTimeoutRef.current = null;
    };

    const clearVideoTimers = () => {
      if (videoRecordTickRef.current != null) window.clearInterval(videoRecordTickRef.current);
      if (videoRecordTimeoutRef.current != null) window.clearTimeout(videoRecordTimeoutRef.current);
      videoRecordTickRef.current = null;
      videoRecordTimeoutRef.current = null;
    };

    const closeCamera = () => {
      clearVideoTimers();
      mediaRecorderRef.current = null;
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      setRecordingVideo(false);
      setVideoRecordSeconds(0);
      setCameraOpen(false);
      setCameraLoading(false);
      setCameraError('');
      videoChunksRef.current = [];
    };

    useEffect(() => () => {
      clearVoiceTimers();
      clearVideoTimers();
      stopMediaStream(mediaStreamRef.current);
    }, []);

    useEffect(() => {
      if (!attachMenuOpen) return undefined;
      const onDocClick = (e: MouseEvent) => {
        if (!attachMenuRef.current?.contains(e.target as Node)) {
          setAttachMenuOpen(false);
        }
      };
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }, [attachMenuOpen]);

    useEffect(() => {
      if (!cameraOpen) return undefined;

      let cancelled = false;
      setCameraLoading(true);
      setCameraError('');

      const constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: 'environment' } },
        audio: cameraMode === 'video',
      };

      void navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          if (cancelled) {
            stopMediaStream(stream);
            return;
          }
          mediaStreamRef.current = stream;
          const video = cameraVideoRef.current;
          if (video) {
            video.srcObject = stream;
            video.muted = true;
            void video.play().catch(() => undefined);
          }
          setCameraLoading(false);
        })
        .catch(() => {
          if (!cancelled) {
            setCameraError('Could not open camera. Check permissions and try again.');
            setCameraLoading(false);
          }
        });

      return () => {
        cancelled = true;
        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
      };
    }, [cameraOpen, cameraMode]);

    const addPickedFiles = (picked: FileList | null) => {
      if (!picked?.length) return;
      const next = [...pendingFiles];
      for (const file of Array.from(picked)) {
        if (next.length >= MAX_SUPPORT_ATTACHMENTS) break;
        const err = validateSupportFile(file);
        if (err) {
          window.alert(err);
          continue;
        }
        next.push(createPendingSupportFile(file));
      }
      onPendingFilesChange(next);
    };

    const removePendingFile = (id: string) => {
      const target = pendingFiles.find(f => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      onPendingFilesChange(pendingFiles.filter(f => f.id !== id));
    };

    const openCamera = (mode: 'photo' | 'video') => {
      setAttachMenuOpen(false);
      setCameraMode(mode);
      setCameraOpen(true);
    };

    const capturePhoto = async () => {
      const video = cameraVideoRef.current;
      if (!video) return;
      setCameraLoading(true);
      try {
        const file = await capturePhotoFromVideo(video);
        closeCamera();
        await onSendFiles([file]);
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Could not capture photo.');
        setCameraLoading(false);
      }
    };

    const stopVideoRecording = async (send: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;

      try {
        const blob = await finalizeMediaRecorder(recorder, videoChunksRef.current);
        clearVideoTimers();
        videoChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecordingVideo(false);
        setVideoRecordSeconds(0);

        if (send) {
          const mimeType = blob.type || recorder.mimeType || 'video/webm';
          const playable = await validateVideoBlob(blob);
          if (!playable) {
            setCameraError('Could not save this video. Try recording again.');
            closeCamera();
            return;
          }

          const file = createVideoFileFromBlob(blob, mimeType);
          closeCamera();
          onSendFiles([file]);
          return;
        }

        closeCamera();
      } catch (err) {
        clearVideoTimers();
        videoChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecordingVideo(false);
        setVideoRecordSeconds(0);
        setCameraError(err instanceof Error ? err.message : 'Could not save video.');
        closeCamera();
      }
    };

    const startVideoRecording = () => {
      const stream = mediaStreamRef.current;
      if (!stream || recordingVideo) return;

      let recorder: MediaRecorder;
      try {
        recorder = createVideoMediaRecorder(stream);
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Video recording is not supported.');
        return;
      }

      videoChunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) videoChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecordingVideo(true);
      setVideoRecordSeconds(0);

      videoRecordTickRef.current = window.setInterval(() => {
        setVideoRecordSeconds(prev => prev + 1);
      }, 1000);

      videoRecordTimeoutRef.current = window.setTimeout(() => {
        void stopVideoRecording(true);
      }, MAX_VOICE_SECONDS * 1000);
    };

    const startVoiceRecording = async () => {
      if (busy || canSend) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        const mimeType = pickAudioMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        voiceChunksRef.current = [];
        recorder.ondataavailable = event => {
          if (event.data.size > 0) voiceChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        voiceStartedAtRef.current = Date.now();
        setRecordingVoice(true);
        setVoiceSeconds(0);
        setVoiceCancelled(false);

        voiceTickRef.current = window.setInterval(() => {
          setVoiceSeconds(Math.floor((Date.now() - voiceStartedAtRef.current) / 1000));
        }, 250);

        voiceTimeoutRef.current = window.setTimeout(() => {
          void finishVoiceRecording(false);
        }, MAX_VOICE_SECONDS * 1000);
      } catch {
        setVoiceCancelled(true);
        setRecordingVoice(false);
        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
      }
    };

    const finishVoiceRecording = async (cancelled: boolean) => {
      const recorder = mediaRecorderRef.current;
      clearVoiceTimers();

      if (!recorder || recorder.state === 'inactive') {
        setRecordingVoice(false);
        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        return;
      }

      const duration = Date.now() - voiceStartedAtRef.current;

      recorder.onstop = async () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        voiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        stopMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        setRecordingVoice(false);
        setVoiceSeconds(0);

        if (!cancelled && duration >= MIN_VOICE_MS && blob.size > 0) {
          const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
          const file = new File([blob], `voice-${Date.now()}.${ext}`, {
            type: blob.type || 'audio/webm',
            lastModified: Date.now(),
          });
          await onSendFiles([file]);
        }
      };

      recorder.stop();
    };

    return (
      <>
        <form
          className="support-chat__composer"
          onSubmit={e => {
            e.preventDefault();
            if (canSend) onSend();
          }}
        >
          {pendingFiles.length > 0 && (
            <ul className="support-attachment-picker__previews support-attachment-picker__previews--compact">
              {pendingFiles.map(item => (
                <li key={item.id} className="support-attachment-picker__preview">
                  {item.kind === 'video' ? (
                    <video src={item.previewUrl} className="support-attachment-picker__media" muted />
                  ) : item.kind === 'audio' ? (
                    <span className="support-attachment-picker__audio-thumb" aria-hidden>
                      <Mic size={18} />
                    </span>
                  ) : (
                    <img src={item.previewUrl} alt="" className="support-attachment-picker__media" />
                  )}
                  <span className="support-attachment-picker__badge" aria-hidden>
                    {item.kind === 'video' ? <Film size={12} /> : item.kind === 'audio' ? <Mic size={12} /> : <ImageIcon size={12} />}
                  </span>
                  <button
                    type="button"
                    className="support-attachment-picker__remove"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removePendingFile(item.id)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {recordingVoice ? (
            <div className="support-chat__voice-recording">
              <span className="support-chat__voice-dot" aria-hidden />
              <span className="support-chat__voice-time">{formatRecordTime(voiceSeconds)}</span>
              <span className="support-chat__voice-hint text-muted text-sm">
                {voiceCancelled ? 'Cancelled' : 'Release to send'}
              </span>
              <button
                type="button"
                className="support-chat__voice-cancel"
                onClick={() => void finishVoiceRecording(true)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="support-chat__composer-bar">
              <button
                type="button"
                className="support-chat__emoji-btn"
                aria-label="Emoji"
                disabled={busy}
                onClick={() => inputRef.current?.focus()}
              >
                <Smile size={22} />
              </button>

              <div className="support-chat__pill" ref={attachMenuRef}>
                <textarea
                  ref={inputRef}
                  className="support-chat__input"
                  rows={1}
                  placeholder={placeholder}
                  value={text}
                  onChange={e => {
                    onTextChange(e.target.value);
                    resizeComposer(e.currentTarget);
                  }}
                  disabled={busy}
                  aria-label="Message"
                />

                <div className="support-chat__pill-actions">
                  <button
                    type="button"
                    className="support-chat__pill-btn"
                    aria-label="Attach"
                    aria-expanded={attachMenuOpen}
                    disabled={busy}
                    onClick={() => setAttachMenuOpen(open => !open)}
                  >
                    <Paperclip size={20} />
                  </button>
                  <button
                    type="button"
                    className="support-chat__pill-btn"
                    aria-label="Camera"
                    disabled={busy}
                    onClick={() => openCamera('photo')}
                  >
                    <Camera size={20} />
                  </button>
                </div>

                {attachMenuOpen && (
                  <div className="support-chat__attach-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        galleryRef.current?.click();
                      }}
                    >
                      <ImageIcon size={18} />
                      Gallery
                    </button>
                    <button type="button" role="menuitem" onClick={() => openCamera('photo')}>
                      <Camera size={18} />
                      Camera
                    </button>
                    <button type="button" role="menuitem" onClick={() => openCamera('video')}>
                      <Film size={18} />
                      Video
                    </button>
                  </div>
                )}
              </div>

              {canSend ? (
                <button
                  type="submit"
                  className="support-chat__action support-chat__action--send"
                  disabled={busy}
                  aria-label="Send message"
                >
                  <Send size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  className="support-chat__action support-chat__action--mic"
                  disabled={busy}
                  aria-label="Record voice note"
                  onPointerDown={e => {
                    e.preventDefault();
                    void startVoiceRecording();
                  }}
                  onPointerUp={e => {
                    e.preventDefault();
                    void finishVoiceRecording(false);
                  }}
                  onPointerLeave={() => {
                    if (recordingVoice) void finishVoiceRecording(false);
                  }}
                  onContextMenu={e => e.preventDefault()}
                >
                  <Mic size={20} />
                </button>
              )}
            </div>
          )}
        </form>

        <input
          ref={galleryRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={e => {
            addPickedFiles(e.target.files);
            if (galleryRef.current) galleryRef.current.value = '';
          }}
        />

        {cameraOpen && (
          <div className="support-chat__camera" role="dialog" aria-label="Camera">
            <div className="support-chat__camera-body">
              {cameraError ? (
                <p className="support-chat__camera-error">{cameraError}</p>
              ) : (
                <>
                  <video
                    ref={cameraVideoRef}
                    className="support-chat__camera-preview"
                    muted
                    playsInline
                    autoPlay
                  />
                  {recordingVideo && (
                    <span className="support-chat__camera-rec-badge">
                      <Circle size={10} fill="currentColor" />
                      {formatRecordTime(videoRecordSeconds)}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="support-chat__camera-toolbar">
              <button type="button" className="support-chat__camera-close" onClick={closeCamera}>
                <X size={22} />
              </button>

              {cameraMode === 'photo' ? (
                <button
                  type="button"
                  className="support-chat__camera-shutter"
                  disabled={cameraLoading || Boolean(cameraError)}
                  aria-label="Take photo"
                  onClick={() => void capturePhoto()}
                />
              ) : recordingVideo ? (
                <button
                  type="button"
                  className="support-chat__camera-shutter support-chat__camera-shutter--stop"
                  aria-label="Stop recording"
                  onClick={() => void stopVideoRecording(true)}
                />
              ) : (
                <button
                  type="button"
                  className="support-chat__camera-shutter support-chat__camera-shutter--record"
                  disabled={cameraLoading || Boolean(cameraError)}
                  aria-label="Start recording"
                  onClick={startVideoRecording}
                />
              )}

              <button
                type="button"
                className="support-chat__camera-mode"
                disabled={recordingVideo}
                onClick={() => setCameraMode(mode => (mode === 'photo' ? 'video' : 'photo'))}
              >
                {cameraMode === 'photo' ? 'Video' : 'Photo'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  },
);
