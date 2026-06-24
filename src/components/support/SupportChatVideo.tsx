import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { getSupportAttachmentUrl } from '../../lib/supportAttachments';

interface SupportChatVideoProps {
  src: string;
  storagePath?: string;
  mimeType?: string;
  posterUrl?: string | null;
  className?: string;
  fileName?: string;
  onLayout?: () => void;
}

export const SupportChatVideo: React.FC<SupportChatVideoProps> = ({
  src,
  storagePath,
  mimeType,
  posterUrl,
  className,
  fileName,
  onLayout,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showPlayer, setShowPlayer] = useState(() => !posterUrl);
  const refreshedRef = useRef(false);

  useEffect(() => {
    setPlaybackSrc(src);
    refreshedRef.current = false;
    setStatus('loading');
    setShowPlayer(!posterUrl);
  }, [src, posterUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showPlayer) return undefined;

    const markReady = () => {
      setStatus(current => (current === 'error' ? current : 'ready'));
      onLayout?.();
    };

    const onLoadedMetadata = () => markReady();
    const onCanPlay = () => markReady();
    const onError = () => {
      void (async () => {
        if (!refreshedRef.current && storagePath?.trim()) {
          refreshedRef.current = true;
          try {
            const freshUrl = await getSupportAttachmentUrl(storagePath);
            if (freshUrl && freshUrl !== playbackSrc) {
              setPlaybackSrc(freshUrl);
              setStatus('loading');
              return;
            }
          } catch {
            // fall through to error UI
          }
        }
        setStatus('error');
        onLayout?.();
      })();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [playbackSrc, onLayout, showPlayer, storagePath]);

  const startPlayback = useCallback(() => {
    setShowPlayer(true);
    setStatus('loading');
  }, []);

  const type = mimeType?.split(';')[0].trim() || undefined;
  const hasPoster = Boolean(posterUrl);
  const showPosterPreview = hasPoster && !showPlayer;
  const showPlaceholder = status === 'loading' && !hasPoster && showPlayer;

  return (
    <div className="support-chat__video-wrap">
      {showPosterPreview ? (
        <button
          type="button"
          className="support-chat__video-poster-btn"
          onClick={startPlayback}
          aria-label={fileName ? `Play ${fileName}` : 'Play video'}
        >
          <img
            src={posterUrl!}
            alt=""
            className={`support-chat__attachment-media support-chat__video-poster${className ? ` ${className}` : ''}`}
            decoding="async"
            onLoad={onLayout}
          />
          <span className="support-chat__video-placeholder" aria-hidden>
            <Play size={28} />
          </span>
        </button>
      ) : (
        <video
          ref={videoRef}
          src={playbackSrc}
          poster={posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className={className}
          {...(type ? { 'data-mime-type': type } : {})}
        />
      )}

      {showPlaceholder && (
        <span className="support-chat__video-placeholder" aria-hidden>
          <Play size={28} />
        </span>
      )}

      {status === 'error' && showPlayer && (
        <a
          className="support-chat__video-fallback"
          href={playbackSrc}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open video
        </a>
      )}

      {fileName && <span className="support-chat__attachment-name">{fileName}</span>}
    </div>
  );
};
