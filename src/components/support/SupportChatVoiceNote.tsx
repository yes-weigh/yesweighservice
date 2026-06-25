import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

function formatVoiceTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface SupportChatVoiceNoteProps {
  src: string;
  onLayout?: () => void;
}

export const SupportChatVoiceNote: React.FC<SupportChatVoiceNoteProps> = ({ src, onLayout }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

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

  return (
    <div className="support-chat__voice-note">
      <button
        type="button"
        className="support-chat__voice-note-play"
        onClick={togglePlayback}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="support-chat__voice-note-track" aria-hidden>
        <div className="support-chat__voice-note-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="support-chat__voice-note-time">{formatVoiceTime(timeLabel)}</span>
      <audio ref={audioRef} src={src} preload="metadata" className="support-chat__voice-note-audio" />
    </div>
  );
};
