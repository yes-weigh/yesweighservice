import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';

const WAVEFORM_BARS = 35;

function formatVoiceTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildWaveformPattern(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Array.from({ length: WAVEFORM_BARS }, (_, index) => {
    const value = Math.abs(Math.sin((hash + index) * 0.85) * 0.55 + Math.cos(index * 0.42) * 0.35);
    return 0.18 + value * 0.82;
  });
}

interface SupportChatVoiceNoteProps {
  src: string;
  isOwn?: boolean;
  avatarLabel?: string;
  messageTime?: string;
  receipt?: React.ReactNode;
  onLayout?: () => void;
}

export const SupportChatVoiceNote: React.FC<SupportChatVoiceNoteProps> = ({
  src,
  isOwn = false,
  avatarLabel = '?',
  messageTime,
  receipt,
  onLayout,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const waveform = useMemo(() => buildWaveformPattern(src), [src]);

  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setCurrent(0);
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onTimeUpdate = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      setDuration(audio.duration);
      onLayout?.();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onMeta);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, [onLayout, src]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const timeLabel = playing || current > 0 ? current : duration;
  const playedBars = Math.round((progress / 100) * WAVEFORM_BARS);

  return (
    <div className={`support-chat__voice-note ${isOwn ? 'support-chat__voice-note--own' : 'support-chat__voice-note--other'}`}>
      {isOwn && (
        <div className="support-chat__voice-avatar" aria-hidden>
          <span className="support-chat__voice-avatar-label">{avatarLabel}</span>
          <span className="support-chat__voice-avatar-mic">
            <Mic size={10} strokeWidth={2.5} />
          </span>
        </div>
      )}

      <div className="support-chat__voice-main">
        <div className="support-chat__voice-controls">
          <button
            type="button"
            className="support-chat__voice-play"
            onClick={togglePlayback}
            aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>

          <div className="support-chat__voice-wave" aria-hidden>
            <div className="support-chat__voice-wave-bars">
              {waveform.map((level, index) => (
                <span
                  key={index}
                  className={`support-chat__voice-wave-bar${index < playedBars ? ' is-played' : ''}`}
                  style={{ transform: `scaleY(${level})` }}
                />
              ))}
            </div>
            <span
              className="support-chat__voice-scrubber"
              style={{ left: `calc(${progress}% - 0.28rem)` }}
            />
          </div>
        </div>

        <div className="support-chat__voice-footer">
          <span className="support-chat__voice-duration">{formatVoiceTime(timeLabel)}</span>
          {(messageTime || receipt) && (
            <span className="support-chat__voice-meta">
              {messageTime && <time>{messageTime}</time>}
              {receipt}
            </span>
          )}
        </div>
      </div>

      <audio ref={audioRef} src={src} preload="metadata" className="support-chat__voice-note-audio" />
    </div>
  );
};
