import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, X } from 'lucide-react';
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
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement>(null);
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setPlaybackSrc(src);
    setStatus('idle');
    setErrorMessage('');
    setViewerOpen(false);
  }, [src]);

  const resolvePlaybackUrl = useCallback(async (): Promise<string> => {
    if (storagePath?.trim()) {
      try {
        return await getSupportAttachmentUrl(storagePath);
      } catch {
        // fall back to stored url
      }
    }
    return src;
  }, [src, storagePath]);

  const bindVideoEvents = useCallback((video: HTMLVideoElement) => {
    const markReady = () => {
      setStatus(current => (current === 'error' ? current : 'ready'));
      onLayout?.();
    };

    const onLoadedMetadata = () => markReady();
    const onCanPlay = () => markReady();
    const onError = () => {
      setStatus('error');
      setErrorMessage('This video could not be played in the chat.');
      onLayout?.();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [onLayout]);

  useEffect(() => {
    const video = inlineVideoRef.current;
    if (!video || posterUrl) return undefined;
    return bindVideoEvents(video);
  }, [bindVideoEvents, playbackSrc, posterUrl]);

  useEffect(() => {
    const video = lightboxVideoRef.current;
    if (!video || !viewerOpen) return undefined;
    return bindVideoEvents(video);
  }, [bindVideoEvents, playbackSrc, viewerOpen]);

  useEffect(() => {
    if (!viewerOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [viewerOpen]);

  const openViewer = useCallback(async () => {
    setStatus('loading');
    setErrorMessage('');
    setViewerOpen(true);

    try {
      const url = await resolvePlaybackUrl();
      setPlaybackSrc(url);
    } catch {
      setPlaybackSrc(src);
    }

    requestAnimationFrame(() => {
      const video = lightboxVideoRef.current;
      if (!video) return;
      video.load();
      void video.play().catch(() => {
        // Controls still allow manual play if autoplay is blocked.
      });
    });
  }, [resolvePlaybackUrl, src]);

  const closeViewer = useCallback(() => {
    const video = lightboxVideoRef.current;
    if (video) {
      video.pause();
    }
    setViewerOpen(false);
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const type = mimeType?.split(';')[0].trim() || undefined;
  const hasPoster = Boolean(posterUrl);
  const showInlinePlayer = !hasPoster;

  return (
    <>
      <div className="support-chat__video-wrap">
        {hasPoster ? (
          <button
            type="button"
            className="support-chat__video-poster-btn"
            onClick={() => void openViewer()}
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
          <>
            <video
              ref={inlineVideoRef}
              src={playbackSrc}
              controls
              playsInline
              preload="metadata"
              className={className}
              onClick={() => void openViewer()}
            >
              {type && <source src={playbackSrc} type={type} />}
            </video>
            {status === 'loading' && showInlinePlayer && (
              <span className="support-chat__video-placeholder" aria-hidden>
                <Play size={28} />
              </span>
            )}
            {status === 'error' && (
              <button
                type="button"
                className="support-chat__video-fallback"
                onClick={() => void openViewer()}
              >
                Tap to play video
              </button>
            )}
          </>
        )}

        {fileName && <span className="support-chat__attachment-name">{fileName}</span>}
      </div>

      {viewerOpen && createPortal(
        <div className="support-chat__video-lightbox" role="dialog" aria-modal="true" aria-label="Video player">
          <button
            type="button"
            className="support-chat__video-lightbox-backdrop"
            aria-label="Close video"
            onClick={closeViewer}
          />
          <div className="support-chat__video-lightbox-panel">
            <button
              type="button"
              className="support-chat__video-lightbox-close"
              aria-label="Close"
              onClick={closeViewer}
            >
              <X size={22} />
            </button>

            <video
              ref={lightboxVideoRef}
              key={playbackSrc}
              src={playbackSrc}
              poster={posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              preload="auto"
              className="support-chat__video-lightbox-player"
            >
              {type && <source src={playbackSrc} type={type} />}
            </video>

            {status === 'loading' && (
              <div className="support-chat__video-lightbox-status">Loading video…</div>
            )}

            {status === 'error' && (
              <div className="support-chat__video-lightbox-status support-chat__video-lightbox-status--error">
                <p>{errorMessage}</p>
                <a href={playbackSrc} target="_blank" rel="noopener noreferrer">
                  Open video in browser
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
